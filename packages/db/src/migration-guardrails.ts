import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface MigrationFile {
  name: string;
  fullPath: string;
  sql: string;
}

export interface BackupRestoreEvidence {
  status: 'pass' | 'warn' | 'fail';
  checked_at?: string;
  drill_id?: string;
  backup_location?: string;
  age_days?: number;
  messages: string[];
}

export interface MigrationPreflightReport {
  status: 'pass' | 'warn' | 'fail';
  environment: string;
  production_like: boolean;
  pending_migrations: string[];
  applied_migrations: string[];
  destructive_warnings: Array<{ migration: string; warning: string }>;
  backup_restore: BackupRestoreEvidence;
  checks: Array<{ key: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
}

export function listMigrationFiles(migrationsDir = path.join(process.cwd(), 'packages/db/migrations')): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const fullPath = path.join(migrationsDir, name);
      return { name, fullPath, sql: readFileSync(fullPath, 'utf8') };
    });
}

export function verifyBackupRestoreEvidence(
  env: Record<string, string | undefined>,
  input: { now?: Date; maxAgeDays?: number; required?: boolean } = {}
): BackupRestoreEvidence {
  if (input.required === false && !env.BACKUP_RESTORE_CHECKED_AT && !env.BACKUP_RESTORE_DRILL_ID && !env.BACKUP_LOCATION) {
    return { status: 'pass', messages: ['Backup/restore drill evidence is not required for this environment.'] };
  }

  const now = input.now ?? new Date();
  const maxAgeDays = input.maxAgeDays ?? 7;
  const checkedAt = env.BACKUP_RESTORE_CHECKED_AT;
  const drillId = env.BACKUP_RESTORE_DRILL_ID;
  const backupLocation = env.BACKUP_LOCATION;
  const messages: string[] = [];

  if (!checkedAt) messages.push('BACKUP_RESTORE_CHECKED_AT is not set.');
  if (!drillId) messages.push('BACKUP_RESTORE_DRILL_ID is not set.');
  if (!backupLocation) messages.push('BACKUP_LOCATION is not set.');

  let ageDays: number | undefined;
  if (checkedAt) {
    const parsed = new Date(checkedAt);
    if (Number.isNaN(parsed.getTime())) {
      messages.push('BACKUP_RESTORE_CHECKED_AT is not a valid date.');
    } else {
      ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
      if (ageDays > maxAgeDays) messages.push(`Latest backup/restore drill is ${ageDays} day(s) old; max allowed is ${maxAgeDays}.`);
    }
  }

  if (!messages.length) {
    return { status: 'pass', checked_at: checkedAt, drill_id: drillId, backup_location: backupLocation, age_days: ageDays, messages: ['Backup/restore drill evidence is current.'] };
  }

  return {
    status: input.required ? 'fail' : 'warn',
    checked_at: checkedAt,
    drill_id: drillId,
    backup_location: backupLocation,
    age_days: ageDays,
    messages
  };
}

export function buildMigrationPreflightReport(input: {
  migrations: MigrationFile[];
  applied: Set<string>;
  env?: Record<string, string | undefined>;
  now?: Date;
}): MigrationPreflightReport {
  const env = input.env ?? process.env;
  const environment = env.DATABASE_ENV ?? env.NODE_ENV ?? 'development';
  const productionLike = ['production', 'prod', 'staging'].includes(environment.toLowerCase()) || env.DB_PRODUCTION_LIKE === 'true';
  const pending = input.migrations.filter((migration) => !input.applied.has(migration.name));
  const destructiveWarnings = pending.flatMap((migration) => detectDestructiveSql(migration).map((warning) => ({ migration: migration.name, warning })));
  const backupRestore = verifyBackupRestoreEvidence(env, { now: input.now, required: productionLike && pending.length > 0 });
  const checks: MigrationPreflightReport['checks'] = [
    {
      key: 'migration.approval',
      status: !productionLike || !pending.length || env.ALLOW_PRODUCTION_MIGRATIONS === 'true' ? 'pass' : 'fail',
      message: productionLike && pending.length ? 'Production-like migration requires ALLOW_PRODUCTION_MIGRATIONS=true.' : 'Migration approval guard is satisfied.'
    },
    {
      key: 'migration.approved_by',
      status: !productionLike || !pending.length || Boolean(env.MIGRATION_APPROVED_BY) ? 'pass' : 'fail',
      message: productionLike && pending.length ? 'Production-like migration requires MIGRATION_APPROVED_BY.' : 'Migration approver guard is satisfied.'
    },
    {
      key: 'migration.backup_restore',
      status: backupRestore.status,
      message: backupRestore.messages.join(' ')
    },
    {
      key: 'migration.destructive_sql',
      status: destructiveWarnings.length ? 'warn' : 'pass',
      message: destructiveWarnings.length ? `${destructiveWarnings.length} potentially destructive SQL pattern(s) detected.` : 'No destructive SQL patterns detected in pending migrations.'
    }
  ];

  return {
    status: checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass',
    environment,
    production_like: productionLike,
    pending_migrations: pending.map((migration) => migration.name),
    applied_migrations: Array.from(input.applied).sort((a, b) => a.localeCompare(b)),
    destructive_warnings: destructiveWarnings,
    backup_restore: backupRestore,
    checks
  };
}

function detectDestructiveSql(migration: MigrationFile): string[] {
  const normalized = migration.sql.replace(/--.*$/gm, '').toLowerCase();
  const warnings: string[] = [];
  if (/\bdrop\s+table\b/.test(normalized)) warnings.push('DROP TABLE detected');
  if (/\bdrop\s+column\b/.test(normalized)) warnings.push('DROP COLUMN detected');
  if (/\btruncate\s+table\b/.test(normalized)) warnings.push('TRUNCATE TABLE detected');
  if (/\bdelete\s+from\b/.test(normalized) && !/\bwhere\b/.test(normalized)) warnings.push('DELETE without WHERE detected');
  return warnings;
}
