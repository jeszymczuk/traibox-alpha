import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyBackupRestoreEvidence } from '@traibox/db';

type AuditStatus = 'pass' | 'warn' | 'fail';
type Env = Record<string, string | undefined>;

interface SecretRequirement {
  key: string;
  description: string;
  sensitive: boolean;
  validate?: (value: string, env: Env) => string | null;
}

interface SecretAuditCheck {
  key: string;
  status: AuditStatus;
  message: string;
  sensitive: boolean;
}

export interface StagingSecretAuditReport {
  status: AuditStatus;
  generated_at: string;
  fixture_mode: boolean;
  checks: SecretAuditCheck[];
  missing_required_env: string[];
  artifact_paths: {
    latest: string;
    timestamped: string;
  };
}

export const STAGING_SECRET_REQUIREMENTS: SecretRequirement[] = [
  { key: 'DATABASE_URL', description: 'Canonical staging Postgres connection string.', sensitive: true, validate: validatePostgresUrl },
  { key: 'AUTH_MODE', description: 'Authentication mode, expected to be supabase for staging.', sensitive: false, validate: (value) => (value === 'supabase' ? null : 'AUTH_MODE must be supabase for staging.') },
  { key: 'SUPABASE_JWT_SECRET', description: 'JWT verifier secret for API auth.', sensitive: true },
  { key: 'SUPABASE_URL', description: 'Supabase project URL.', sensitive: false, validate: validateHttpsUrl },
  { key: 'SUPABASE_ANON_KEY', description: 'Supabase browser anon key for auth handshake.', sensitive: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', description: 'Server-side storage/service role key.', sensitive: true },
  { key: 'TRUELAYER_CLIENT_ID', description: 'TrueLayer sandbox or staging client id.', sensitive: true },
  { key: 'TRUELAYER_CLIENT_SECRET', description: 'TrueLayer sandbox or staging client secret.', sensitive: true },
  { key: 'TRUELAYER_WEBHOOK_SECRET', description: 'TrueLayer webhook signature secret.', sensitive: true },
  { key: 'COMPLYADVANTAGE_API_KEY', description: 'ComplyAdvantage screening API key.', sensitive: true },
  { key: 'EVM_RPC_URL', description: 'EVM-compatible RPC endpoint for proof anchoring.', sensitive: true, validate: validateHttpsUrl },
  { key: 'EVM_ANCHOR_REGISTRY_ADDRESS', description: 'Anchor registry smart contract address.', sensitive: false, validate: validateEvmAddress },
  { key: 'EVM_ANCHOR_WALLET_PRIVATE_KEY', description: 'Wallet key used by worker for staging anchor writes.', sensitive: true },
  { key: 'PARTNER_JWT_SECRET', description: 'Partner portal/API JWT secret.', sensitive: true },
  { key: 'ALLOW_PRODUCTION_MIGRATIONS', description: 'Explicit production-like migration approval toggle.', sensitive: false, validate: validateBoolean },
  { key: 'MIGRATION_APPROVED_BY', description: 'Named approver for migration preflight.', sensitive: false },
  { key: 'BACKUP_RESTORE_CHECKED_AT', description: 'ISO timestamp for latest restore drill.', sensitive: false, validate: validateIsoDate },
  { key: 'BACKUP_RESTORE_DRILL_ID', description: 'Restore drill evidence identifier.', sensitive: false },
  { key: 'BACKUP_LOCATION', description: 'Backup system and location evidence.', sensitive: false },
  { key: 'STAGING_API_BASE_URL', description: 'Deployed staging API base URL.', sensitive: false, validate: validateHttpsUrl },
  { key: 'STAGING_WEB_BASE_URL', description: 'Deployed staging web base URL.', sensitive: false, validate: validateHttpsUrl }
];

export function buildStagingSecretAuditReport(input: { env?: Env; now?: Date; artifactDir?: string } = {}): StagingSecretAuditReport {
  const now = input.now ?? new Date();
  const baseEnv = input.env ?? process.env;
  const fixtureMode = baseEnv.STAGING_SECRET_AUDIT_FIXTURE === 'true';
  const env = fixtureMode ? withFixtureEnv(baseEnv, now) : baseEnv;
  const checks: SecretAuditCheck[] = STAGING_SECRET_REQUIREMENTS.map((requirement) => auditRequirement(requirement, env));
  const backupEvidence = verifyBackupRestoreEvidence(env, { now, required: true });
  checks.push({
    key: 'BACKUP_RESTORE_EVIDENCE',
    status: backupEvidence.status,
    message: backupEvidence.messages.join(' '),
    sensitive: false
  });

  const artifactPaths = buildArtifactPaths(input.artifactDir ?? 'artifacts/staging-secret-audits', now);
  const status = collapseStatuses(checks.map((check) => check.status));

  return {
    status,
    generated_at: now.toISOString(),
    fixture_mode: fixtureMode,
    checks,
    missing_required_env: checks.filter((check) => check.status === 'fail' && check.message.includes('is required')).map((check) => check.key),
    artifact_paths: artifactPaths
  };
}

function auditRequirement(requirement: SecretRequirement, env: Env): SecretAuditCheck {
  const value = env[requirement.key]?.trim();
  if (!value) {
    return {
      key: requirement.key,
      status: 'fail',
      message: `${requirement.key} is required. ${requirement.description}`,
      sensitive: requirement.sensitive
    };
  }

  const validationMessage = requirement.validate?.(value, env);
  if (validationMessage) {
    return {
      key: requirement.key,
      status: 'fail',
      message: validationMessage,
      sensitive: requirement.sensitive
    };
  }

  return {
    key: requirement.key,
    status: 'pass',
    message: `${requirement.key} is present and passed shape checks.`,
    sensitive: requirement.sensitive
  };
}

function validatePostgresUrl(value: string, env: Env): string | null {
  if (!/^postgres(ql)?:\/\//.test(value)) return 'DATABASE_URL must be a postgres/postgresql connection string.';
  if (env.STAGING_SECRET_AUDIT_ALLOW_LOCAL === 'true') return null;
  if (/localhost|127\.0\.0\.1|example/i.test(value)) return 'DATABASE_URL must not point to localhost, 127.0.0.1, or example in real staging audit.';
  return null;
}

function validateHttpsUrl(value: string): string | null {
  if (!/^https:\/\//.test(value)) return 'URL must use https://.';
  if (/example|fixture|invalid/i.test(value)) return 'URL must not use example, fixture, or invalid placeholders.';
  return null;
}

function validateEvmAddress(value: string): string | null {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? null : 'EVM_ANCHOR_REGISTRY_ADDRESS must be a 20-byte hex address.';
}

function validateBoolean(value: string): string | null {
  return value === 'true' || value === 'false' ? null : 'ALLOW_PRODUCTION_MIGRATIONS must be true or false.';
}

function validateIsoDate(value: string): string | null {
  return Number.isNaN(new Date(value).getTime()) ? 'BACKUP_RESTORE_CHECKED_AT must be a valid ISO timestamp.' : null;
}

function withFixtureEnv(env: Env, now: Date): Env {
  return {
    ...env,
    STAGING_SECRET_AUDIT_ALLOW_LOCAL: env.STAGING_SECRET_AUDIT_ALLOW_LOCAL ?? 'true',
    DATABASE_URL: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54321/traibox',
    AUTH_MODE: env.AUTH_MODE ?? 'supabase',
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET ?? 'fixture-jwt-secret',
    SUPABASE_URL: env.SUPABASE_URL ?? 'https://staging.supabase.co',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ?? 'fixture-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? 'fixture-service-role-key',
    TRUELAYER_CLIENT_ID: env.TRUELAYER_CLIENT_ID ?? 'fixture-truelayer-client',
    TRUELAYER_CLIENT_SECRET: env.TRUELAYER_CLIENT_SECRET ?? 'fixture-truelayer-secret',
    TRUELAYER_WEBHOOK_SECRET: env.TRUELAYER_WEBHOOK_SECRET ?? 'fixture-truelayer-webhook',
    COMPLYADVANTAGE_API_KEY: env.COMPLYADVANTAGE_API_KEY ?? 'fixture-complyadvantage-key',
    EVM_RPC_URL: env.EVM_RPC_URL ?? 'https://staging-rpc.traibox.test',
    EVM_ANCHOR_REGISTRY_ADDRESS: env.EVM_ANCHOR_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000001',
    EVM_ANCHOR_WALLET_PRIVATE_KEY: env.EVM_ANCHOR_WALLET_PRIVATE_KEY ?? 'fixture-private-key',
    PARTNER_JWT_SECRET: env.PARTNER_JWT_SECRET ?? 'fixture-partner-secret',
    ALLOW_PRODUCTION_MIGRATIONS: env.ALLOW_PRODUCTION_MIGRATIONS ?? 'false',
    MIGRATION_APPROVED_BY: env.MIGRATION_APPROVED_BY ?? 'fixture-rehearsal',
    BACKUP_RESTORE_CHECKED_AT: env.BACKUP_RESTORE_CHECKED_AT ?? now.toISOString(),
    BACKUP_RESTORE_DRILL_ID: env.BACKUP_RESTORE_DRILL_ID ?? 'fixture-restore-drill',
    BACKUP_LOCATION: env.BACKUP_LOCATION ?? 'fixture:local',
    STAGING_API_BASE_URL: env.STAGING_API_BASE_URL ?? 'https://api.staging.traibox.test',
    STAGING_WEB_BASE_URL: env.STAGING_WEB_BASE_URL ?? 'https://app.staging.traibox.test'
  };
}

function collapseStatuses(statuses: AuditStatus[]): AuditStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

function buildArtifactPaths(artifactDir: string, now: Date) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    latest: path.join(artifactDir, 'latest.json'),
    timestamped: path.join(artifactDir, `${stamp}.json`)
  };
}

async function main(): Promise<void> {
  const report = buildStagingSecretAuditReport();
  mkdirSync(path.dirname(report.artifact_paths.latest), { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(report.artifact_paths.latest, json);
  writeFileSync(report.artifact_paths.timestamped, json);
  process.stdout.write(json);
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

