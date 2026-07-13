import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrationPreflightReport, listMigrationFiles, verifyBackupRestoreEvidence, type MigrationFile } from './migration-guardrails.js';

const migration = (name: string, sql: string): MigrationFile => ({ name, fullPath: `/tmp/${name}`, sql });

describe('migration guardrails', () => {
  it('sorts migration filenames so reserved versions precede V020', () => {
    const directory = mkdtempSync(join(tmpdir(), 'traibox-migrations-'));
    try {
      for (const name of ['V020__browser_security_sessions.sql', 'V011__existing.sql', 'V019__reserved.sql']) {
        writeFileSync(join(directory, name), 'SELECT 1;');
      }
      expect(listMigrationFiles(directory).map(({ name }) => name)).toEqual([
        'V011__existing.sql',
        'V019__reserved.sql',
        'V020__browser_security_sessions.sql'
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
      migrations: [migration('V999__drop.sql', 'DROP TABLE old_data;')],
      applied: new Set(),
      env: { NODE_ENV: 'development' }
    });

    expect(report.status).toBe('warn');
    expect(report.destructive_warnings).toEqual(expect.arrayContaining([expect.objectContaining({ warning: 'DROP TABLE detected' })]));
  });

  it('keeps reserved V012 through V019 pending after V020 is already applied', () => {
    const migrations = [
      migration('V011__existing.sql', 'SELECT 1;'),
      ...Array.from({ length: 8 }, (_, index) => migration(`V${String(index + 12).padStart(3, '0')}__reserved.sql`, 'SELECT 1;')),
      migration('V020__browser_security_sessions.sql', 'SELECT 1;')
    ];
    const report = buildMigrationPreflightReport({
      migrations,
      applied: new Set(['V011__existing.sql', 'V020__browser_security_sessions.sql']),
      env: { NODE_ENV: 'development' }
    });

    expect(report.pending_migrations).toEqual(
      Array.from({ length: 8 }, (_, index) => `V${String(index + 12).padStart(3, '0')}__reserved.sql`)
    );
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
