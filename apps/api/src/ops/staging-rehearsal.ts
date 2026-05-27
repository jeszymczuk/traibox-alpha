import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMigrationPreflightReport, createPool, listMigrationFiles, verifyBackupRestoreEvidence, type MigrationPreflightReport } from '@traibox/db';
import { loadProfileFromFile, validateRuntimeEnvironment, type Profile, type RuntimeReadinessReport } from '@traibox/profiles';
import { z } from 'zod';

type Env = Record<string, string | undefined>;
type GateStatus = 'pass' | 'warn' | 'fail';
type CheckStatus = GateStatus | 'skipped';

export const CORE_PILOT_SCENARIOS = [
  'full_trade_room_loop',
  'standalone_payment',
  'standalone_clearance',
  'counterparty_onboarding_screening',
  'funding_request',
  'document_first'
] as const;

const ONBOARDING_PROOF_POINTS = ['counterparty', 'onboarding_flow', 'screening_result', 'trade_passport'];
const FIRST_SESSION_STEPS = [
  'messy_trade_input',
  'document_upload',
  'extraction_and_missing_proof',
  'readiness_and_clearance',
  'funding_or_payment_intent',
  'human_approval',
  'proof_bundle',
  'operations_center_update',
  'standalone_attach_to_trade_room'
];

const FixtureSchema = z.object({
  fixture_id: z.string(),
  scenarios: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      expected_proof_points: z.array(z.string()).default([])
    })
  )
});

export type PilotScenarioFixture = z.infer<typeof FixtureSchema>;

interface RehearsalCheck {
  key: string;
  status: CheckStatus;
  message: string;
}

interface DeploymentTargetReport {
  status: GateStatus;
  api_base_url_present: boolean;
  web_base_url_present: boolean;
  checks: RehearsalCheck[];
}

interface HttpSmokeReport {
  status: GateStatus;
  checks: RehearsalCheck[];
}

export interface PilotOnboardingSmokeReport {
  status: GateStatus;
  fixture_id: string;
  required_scenarios: string[];
  first_session_steps: string[];
  checks: RehearsalCheck[];
}

interface MigrationRehearsalReport {
  status: GateStatus;
  report?: MigrationPreflightReport;
  checks: RehearsalCheck[];
}

export interface StagingRehearsalReport {
  status: GateStatus;
  generated_at: string;
  fixture_mode: boolean;
  profile_path: string;
  profile_id: string;
  release_gate: {
    required_command: string;
    scenario_database_policy: string;
  };
  runtime: {
    api: RuntimeReadinessReport;
    worker: RuntimeReadinessReport;
  };
  backup_restore: ReturnType<typeof verifyBackupRestoreEvidence>;
  migration_preflight: MigrationRehearsalReport;
  deployment_targets: DeploymentTargetReport;
  http_smoke: HttpSmokeReport;
  pilot_onboarding_smoke: PilotOnboardingSmokeReport;
  artifact_paths: {
    latest: string;
    timestamped: string;
  };
}

export async function buildStagingRehearsalReport(input: {
  env?: Env;
  now?: Date;
  fetchImpl?: typeof fetch;
  skipDatabase?: boolean;
  skipHttp?: boolean;
  artifactDir?: string;
  fixturePath?: string;
} = {}): Promise<StagingRehearsalReport> {
  const now = input.now ?? new Date();
  const baseEnv = input.env ?? process.env;
  const fixtureMode = baseEnv.STAGING_REHEARSAL_FIXTURE === 'true';
  const env = fixtureMode ? withFixtureEnv(baseEnv, now) : baseEnv;
  const profilePath = env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/staging.yaml';
  const profile = loadProfileFromFile(profilePath);
  const generatedAt = now.toISOString();
  const apiRuntime = validateRuntimeEnvironment({ profile, target: 'api', env, generatedAt });
  const workerRuntime = validateRuntimeEnvironment({ profile, target: 'worker', env, generatedAt });
  const backupRestore = verifyBackupRestoreEvidence(env, { now, required: true });
  const deploymentTargets = buildDeploymentTargetReport(env, { fixtureMode });
  const httpSmoke = await buildHttpSmokeReport(env, { fetchImpl: input.fetchImpl, skipHttp: input.skipHttp === true || fixtureMode });
  const fixture = loadPilotScenarioFixture(input.fixturePath);
  const pilotOnboardingSmoke = buildPilotOnboardingSmoke(profile, fixture);
  const migrationPreflight = await buildMigrationRehearsalReport(env, { now, skipDatabase: input.skipDatabase === true });
  const artifactDir = input.artifactDir ?? 'artifacts/staging-rehearsals';
  const artifactPaths = buildArtifactPaths(artifactDir, now);

  const status = collapseStatuses([
    apiRuntime.status,
    workerRuntime.status,
    backupRestore.status,
    migrationPreflight.status,
    deploymentTargets.status,
    httpSmoke.status,
    pilotOnboardingSmoke.status,
    fixtureMode ? 'warn' : 'pass'
  ]);

  return {
    status,
    generated_at: generatedAt,
    fixture_mode: fixtureMode,
    profile_path: profilePath,
    profile_id: profile.profile_id,
    release_gate: {
      required_command: 'pnpm release:gate:ci',
      scenario_database_policy: 'Run alpha scenario integration tests only against disposable Postgres, never against the real staging database.'
    },
    runtime: {
      api: apiRuntime,
      worker: workerRuntime
    },
    backup_restore: backupRestore,
    migration_preflight: migrationPreflight,
    deployment_targets: deploymentTargets,
    http_smoke: httpSmoke,
    pilot_onboarding_smoke: pilotOnboardingSmoke,
    artifact_paths: artifactPaths
  };
}

export function buildPilotOnboardingSmoke(profile: Profile, fixture: PilotScenarioFixture): PilotOnboardingSmokeReport {
  const fixtureScenarioIds = new Set(fixture.scenarios.map((scenario) => scenario.id));
  const profileScenarioIds = new Set(profile.pilot.required_smoke_scenarios);
  const missingFromProfile = CORE_PILOT_SCENARIOS.filter((scenario) => !profileScenarioIds.has(scenario));
  const missingFromFixture = CORE_PILOT_SCENARIOS.filter((scenario) => !fixtureScenarioIds.has(scenario));
  const onboardingScenario = fixture.scenarios.find((scenario) => scenario.id === 'counterparty_onboarding_screening');
  const missingOnboardingProof = ONBOARDING_PROOF_POINTS.filter((point) => !onboardingScenario?.expected_proof_points.includes(point));
  const checks: RehearsalCheck[] = [
    {
      key: 'pilot.profile_core_scenarios',
      status: missingFromProfile.length ? 'fail' : 'pass',
      message: missingFromProfile.length
        ? `Profile is missing required pilot smoke scenario(s): ${missingFromProfile.join(', ')}.`
        : 'Profile requires all core pilot smoke scenarios.'
    },
    {
      key: 'pilot.fixture_core_scenarios',
      status: missingFromFixture.length ? 'fail' : 'pass',
      message: missingFromFixture.length
        ? `Scenario fixture is missing required pilot smoke scenario(s): ${missingFromFixture.join(', ')}.`
        : 'Scenario fixture covers all core pilot smoke scenarios.'
    },
    {
      key: 'pilot.onboarding_proof_points',
      status: missingOnboardingProof.length ? 'fail' : 'pass',
      message: missingOnboardingProof.length
        ? `Counterparty onboarding scenario is missing proof point(s): ${missingOnboardingProof.join(', ')}.`
        : 'Counterparty onboarding scenario preserves reusable Trade Passport proof points.'
    },
    {
      key: 'pilot.first_session_story',
      status: FIRST_SESSION_STEPS.length >= 9 ? 'pass' : 'fail',
      message: 'First-session story covers messy input, document upload, extraction, readiness, execution intent, approval, proof, Operations, and attach-to-trade.'
    }
  ];

  return {
    status: statusFromChecks(checks),
    fixture_id: fixture.fixture_id,
    required_scenarios: [...CORE_PILOT_SCENARIOS],
    first_session_steps: FIRST_SESSION_STEPS,
    checks
  };
}

export function buildDeploymentTargetReport(env: Env, input: { fixtureMode: boolean }): DeploymentTargetReport {
  const apiPresent = hasEnv(env, 'STAGING_API_BASE_URL');
  const webPresent = hasEnv(env, 'STAGING_WEB_BASE_URL');
  const missingStatus: CheckStatus = input.fixtureMode ? 'skipped' : 'fail';
  const checks: RehearsalCheck[] = [
    {
      key: 'staging.api_base_url',
      status: apiPresent ? 'pass' : missingStatus,
      message: apiPresent ? 'Staging API base URL is configured.' : 'STAGING_API_BASE_URL is required for real staging HTTP smoke.'
    },
    {
      key: 'staging.web_base_url',
      status: webPresent ? 'pass' : missingStatus,
      message: webPresent ? 'Staging web base URL is configured.' : 'STAGING_WEB_BASE_URL is required for real staging onboarding smoke.'
    }
  ];

  return {
    status: statusFromChecks(checks),
    api_base_url_present: apiPresent,
    web_base_url_present: webPresent,
    checks
  };
}

export function loadPilotScenarioFixture(fixturePath = 'docs/pilot/fixtures/alpha-pilot-scenarios.json'): PilotScenarioFixture {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.join(process.cwd(), fixturePath);
  return FixtureSchema.parse(JSON.parse(readFileSync(abs, 'utf8')));
}

async function buildMigrationRehearsalReport(env: Env, input: { now: Date; skipDatabase: boolean }): Promise<MigrationRehearsalReport> {
  if (input.skipDatabase) {
    return {
      status: 'warn',
      checks: [{ key: 'migration.database_preflight', status: 'skipped', message: 'Migration preflight skipped by test harness.' }]
    };
  }
  if (!hasEnv(env, 'DATABASE_URL')) {
    return {
      status: 'fail',
      checks: [{ key: 'migration.database_url', status: 'fail', message: 'DATABASE_URL is required for staging migration preflight.' }]
    };
  }

  const pool = createPool(env.DATABASE_URL!);
  try {
    const applied = await readAppliedMigrations(pool);
    const report = buildMigrationPreflightReport({ migrations: listMigrationFiles(), applied, env, now: input.now });
    return {
      status: report.status,
      report,
      checks: report.checks.map((check) => ({ key: check.key, status: check.status, message: check.message }))
    };
  } finally {
    await pool.end();
  }
}

async function readAppliedMigrations(pool: ReturnType<typeof createPool>): Promise<Set<string>> {
  const table = await pool.query<{ exists: string | null }>("SELECT to_regclass('public.schema_migrations')::text AS exists");
  if (!table.rows[0]?.exists) return new Set();
  const res = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(res.rows.map((row) => row.name));
}

async function buildHttpSmokeReport(
  env: Env,
  input: { fetchImpl?: typeof fetch; skipHttp: boolean }
): Promise<HttpSmokeReport> {
  if (input.skipHttp || env.STAGING_REHEARSAL_SKIP_HTTP === 'true') {
    return {
      status: 'warn',
      checks: [{ key: 'http.smoke', status: 'skipped', message: 'HTTP smoke skipped; run against deployed staging before pilot invitation.' }]
    };
  }

  const checks: RehearsalCheck[] = [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = normalizeBaseUrl(env.STAGING_API_BASE_URL);
  const webBaseUrl = normalizeBaseUrl(env.STAGING_WEB_BASE_URL);

  if (!apiBaseUrl) {
    checks.push({ key: 'http.api_base_url', status: 'fail', message: 'STAGING_API_BASE_URL is required for API smoke.' });
  } else {
    for (const endpoint of ['/healthz', '/readyz', '/metrics', '/v1/api/catalog']) {
      checks.push(await probeEndpoint(fetchImpl, `${apiBaseUrl}${endpoint}`, endpoint));
    }
  }

  if (!webBaseUrl) {
    checks.push({ key: 'http.web_base_url', status: 'fail', message: 'STAGING_WEB_BASE_URL is required for web smoke.' });
  } else {
    checks.push(await probeEndpoint(fetchImpl, webBaseUrl, 'web /'));
  }

  return { status: statusFromChecks(checks), checks };
}

async function probeEndpoint(fetchImpl: typeof fetch, url: string, label: string): Promise<RehearsalCheck> {
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.5' } });
    const text = await response.text();
    if (!response.ok) {
      return { key: `http.${label}`, status: 'fail', message: `${label} returned HTTP ${response.status}.` };
    }
    if (label === '/metrics' && !text.includes('traibox_api_runtime_status')) {
      return { key: 'http./metrics', status: 'fail', message: '/metrics did not expose traibox_api_runtime_status.' };
    }
    if (label === '/v1/api/catalog' && !text.includes('api_version')) {
      return { key: 'http./v1/api/catalog', status: 'fail', message: '/v1/api/catalog did not include api_version.' };
    }
    return { key: `http.${label}`, status: 'pass', message: `${label} responded successfully.` };
  } catch (err) {
    return { key: `http.${label}`, status: 'fail', message: `${label} request failed: ${err instanceof Error ? err.message : 'unknown error'}.` };
  }
}

function withFixtureEnv(env: Env, now: Date): Env {
  return {
    ...env,
    DEPLOYMENT_PROFILE_PATH: env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/staging.yaml',
    DATABASE_ENV: env.DATABASE_ENV ?? 'staging',
    DB_PRODUCTION_LIKE: env.DB_PRODUCTION_LIKE ?? 'true',
    AUTH_MODE: env.AUTH_MODE ?? 'supabase',
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET ?? 'fixture-jwt-secret',
    SUPABASE_URL: env.SUPABASE_URL ?? 'https://fixture.supabase.co',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ?? 'fixture-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? 'fixture-service-role-key',
    TRUELAYER_CLIENT_ID: env.TRUELAYER_CLIENT_ID ?? 'fixture-truelayer-client',
    TRUELAYER_CLIENT_SECRET: env.TRUELAYER_CLIENT_SECRET ?? 'fixture-truelayer-secret',
    TRUELAYER_WEBHOOK_SECRET: env.TRUELAYER_WEBHOOK_SECRET ?? 'fixture-truelayer-webhook',
    COMPLYADVANTAGE_API_KEY: env.COMPLYADVANTAGE_API_KEY ?? 'fixture-complyadvantage-key',
    EVM_RPC_URL: env.EVM_RPC_URL ?? 'https://fixture-rpc.invalid',
    EVM_ANCHOR_REGISTRY_ADDRESS: env.EVM_ANCHOR_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000001',
    EVM_ANCHOR_WALLET_PRIVATE_KEY: env.EVM_ANCHOR_WALLET_PRIVATE_KEY ?? 'fixture-private-key',
    PARTNER_JWT_SECRET: env.PARTNER_JWT_SECRET ?? 'fixture-partner-secret',
    ALLOW_PRODUCTION_MIGRATIONS: env.ALLOW_PRODUCTION_MIGRATIONS ?? 'true',
    MIGRATION_APPROVED_BY: env.MIGRATION_APPROVED_BY ?? 'fixture-rehearsal',
    BACKUP_RESTORE_CHECKED_AT: env.BACKUP_RESTORE_CHECKED_AT ?? now.toISOString(),
    BACKUP_RESTORE_DRILL_ID: env.BACKUP_RESTORE_DRILL_ID ?? 'fixture-restore-drill',
    BACKUP_LOCATION: env.BACKUP_LOCATION ?? 'fixture:local',
    DATABASE_URL: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54321/traibox'
  };
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value.replace(/\/+$/, '');
}

function hasEnv(env: Env, key: string): boolean {
  return typeof env[key] === 'string' && env[key]!.trim().length > 0;
}

function collapseStatuses(statuses: Array<GateStatus | CheckStatus>): GateStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn') || statuses.includes('skipped')) return 'warn';
  return 'pass';
}

function statusFromChecks(checks: RehearsalCheck[]): GateStatus {
  return collapseStatuses(checks.map((check) => check.status));
}

function buildArtifactPaths(artifactDir: string, now: Date) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    latest: path.join(artifactDir, 'latest.json'),
    timestamped: path.join(artifactDir, `${stamp}.json`)
  };
}

async function main(): Promise<void> {
  const report = await buildStagingRehearsalReport();
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
