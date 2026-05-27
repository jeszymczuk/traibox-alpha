import { describe, expect, it } from 'vitest';
import { buildMigrationPreflightReport, verifyBackupRestoreEvidence, type MigrationFile } from './migration-guardrails.js';

const migration = (name: string, sql: string): MigrationFile => ({ name, fullPath: `/tmp/${name}`, sql });

describe('migration guardrails', () => {
  it('allows local pending migrations without production approval', () => {
    const report = buildMigrationPreflightReport({
      migrations: [migration('V001__core.sql', 'CREATE TABLE demo(id uuid primary key);')],
      applied: new Set(),
      env: { NODE_ENV: 'development' },
      now: new Date('2026-05-27T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.pending_migrations).toEqual(['V001__core.sql']);
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'migration.approval', status: 'pass' })]));
  });

  it('blocks production-like migrations without approval and restore evidence', () => {
    const report = buildMigrationPreflightReport({
      migrations: [migration('V011__prod.sql', 'CREATE TABLE pilot(id uuid primary key);')],
      applied: new Set(),
      env: { NODE_ENV: 'production' },
      now: new Date('2026-05-27T10:00:00.000Z')
    });

    expect(report.status).toBe('fail');
    expect(report.backup_restore.status).toBe('fail');
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'migration.approval', status: 'fail' })]));
  });

  it('passes production preflight with approval and fresh backup restore drill evidence', () => {
    const report = buildMigrationPreflightReport({
      migrations: [migration('V011__prod.sql', 'CREATE TABLE pilot(id uuid primary key);')],
      applied: new Set(),
      env: {
        NODE_ENV: 'production',
        ALLOW_PRODUCTION_MIGRATIONS: 'true',
        MIGRATION_APPROVED_BY: 'cto@traibox.test',
        BACKUP_RESTORE_CHECKED_AT: '2026-05-26T10:00:00.000Z',
        BACKUP_RESTORE_DRILL_ID: 'restore-drill-001',
        BACKUP_LOCATION: 'supabase:pitr:eu'
      },
      now: new Date('2026-05-27T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.backup_restore.status).toBe('pass');
  });

  it('warns on destructive pending migration patterns', () => {
    const report = buildMigrationPreflightReport({
      migrations: [migration('V012__drop.sql', 'DROP TABLE old_data;')],
      applied: new Set(),
      env: { NODE_ENV: 'development' }
    });

    expect(report.status).toBe('warn');
    expect(report.destructive_warnings).toEqual(expect.arrayContaining([expect.objectContaining({ warning: 'DROP TABLE detected' })]));
  });

  it('fails stale backup restore evidence when required', () => {
    const evidence = verifyBackupRestoreEvidence(
      {
        BACKUP_RESTORE_CHECKED_AT: '2026-05-01T10:00:00.000Z',
        BACKUP_RESTORE_DRILL_ID: 'restore-drill-001',
        BACKUP_LOCATION: 'supabase:pitr:eu'
      },
      { required: true, now: new Date('2026-05-27T10:00:00.000Z') }
    );

    expect(evidence.status).toBe('fail');
    expect(evidence.messages.join(' ')).toContain('max allowed is 7');
  });
});
