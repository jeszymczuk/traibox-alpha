import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProfileFromFile, type Profile } from '@traibox/profiles';

type ReadinessStatus = 'pass' | 'fail';

interface PresenceCheck {
  name: string;
  type: 'secret' | 'variable' | 'workflow_input';
  status: ReadinessStatus;
  message: string;
}

export interface GitHubStagingReadinessReport {
  status: ReadinessStatus;
  generated_at: string;
  repository: string;
  checks: PresenceCheck[];
  missing_secrets: string[];
  missing_variables: string[];
  required_workflow_inputs: string[];
  artifact_paths: {
    latest: string;
    timestamped: string;
  };
}

export const BASE_STAGING_GITHUB_SECRETS = [
  'STAGING_DATABASE_URL',
  'STAGING_SUPABASE_JWT_SECRET',
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_PARTNER_JWT_SECRET'
] as const;

export const REQUIRED_STAGING_WORKFLOW_INPUTS = [
  'api_base_url',
  'web_base_url',
  'backup_restore_checked_at',
  'backup_restore_drill_id',
  'backup_location',
  'allow_pending_migrations'
] as const;

export function buildGitHubStagingReadinessReport(input: {
  repository: string;
  secretNames: string[];
  variableNames?: string[];
  profile?: Profile;
  now?: Date;
  artifactDir?: string;
}): GitHubStagingReadinessReport {
  const now = input.now ?? new Date();
  const profile = input.profile ?? loadProfileForReadiness();
  const requiredSecrets = getRequiredStagingGitHubSecrets(profile);
  const secretSet = new Set(input.secretNames);
  const secretChecks: PresenceCheck[] = requiredSecrets.map((name) => ({
    name,
    type: 'secret',
    status: secretSet.has(name) ? 'pass' : 'fail',
    message: secretSet.has(name)
      ? `${name} is configured in GitHub Actions.`
      : `${name} is missing from GitHub Actions secrets.`
  }));
  const variableChecks: PresenceCheck[] = [];
  const inputChecks: PresenceCheck[] = REQUIRED_STAGING_WORKFLOW_INPUTS.map((name) => ({
    name,
    type: 'workflow_input',
    status: 'pass',
    message: `${name} is supplied when manually running .github/workflows/staging-rehearsal.yml.`
  }));
  const checks = [...secretChecks, ...variableChecks, ...inputChecks];
  const missingSecrets = secretChecks.filter((check) => check.status === 'fail').map((check) => check.name);
  const missingVariables = variableChecks.filter((check) => check.status === 'fail').map((check) => check.name);
  const artifactPaths = buildArtifactPaths(input.artifactDir ?? 'artifacts/github-staging-readiness', now);

  return {
    status: missingSecrets.length || missingVariables.length ? 'fail' : 'pass',
    generated_at: now.toISOString(),
    repository: input.repository,
    checks,
    missing_secrets: missingSecrets,
    missing_variables: missingVariables,
    required_workflow_inputs: [...REQUIRED_STAGING_WORKFLOW_INPUTS],
    artifact_paths: artifactPaths
  };
}

export function getRequiredStagingGitHubSecrets(profile: Profile): string[] {
  const required: string[] = [...BASE_STAGING_GITHUB_SECRETS];

  if (profile.compliance.complyadvantage.enabled) {
    required.push('STAGING_COMPLYADVANTAGE_API_KEY');
  }

  if (profile.payments.active_provider === 'truelayer' && profile.payments.truelayer.enabled) {
    required.push('STAGING_TRUELAYER_CLIENT_ID', 'STAGING_TRUELAYER_CLIENT_SECRET');
    if (profile.payments.truelayer.webhooks.verify_signatures) required.push('STAGING_TRUELAYER_WEBHOOK_SECRET');
  }

  if (profile.payments.active_provider === 'ibanfirst' && profile.payments.ibanfirst.enabled) {
    required.push('STAGING_IBANFIRST_API_KEY', 'STAGING_IBANFIRST_WEBHOOK_SECRET');
  }

  if (profile.ledger.anchoring.enabled && profile.ledger.anchoring.adapter === 'evm_event') {
    required.push('STAGING_EVM_RPC_URL', 'STAGING_EVM_ANCHOR_REGISTRY_ADDRESS', 'STAGING_EVM_ANCHOR_WALLET_PRIVATE_KEY');
  }

  return required;
}

function loadProfileForReadiness(): Profile {
  return loadProfileFromFile(process.env.DEPLOYMENT_PROFILE_PATH ?? defaultProfilePath());
}

function defaultProfilePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/profiles/profiles/staging.yaml');
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY || 'jeszymczuk/traibox-alpha';
  const secretNames = listGitHubNames(['secret', 'list', '--repo', repository, '--json', 'name']);
  const variableNames = listGitHubNames(['variable', 'list', '--repo', repository, '--json', 'name']);
  const report = buildGitHubStagingReadinessReport({ repository, secretNames, variableNames });
  mkdirSync(path.dirname(report.artifact_paths.latest), { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(report.artifact_paths.latest, json);
  writeFileSync(report.artifact_paths.timestamped, json);
  process.stdout.write(json);
  if (report.status === 'fail') process.exitCode = 1;
}

function listGitHubNames(args: string[]): string[] {
  const output = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(output || '[]') as Array<{ name?: string }>;
  return parsed.map((item) => item.name).filter((name): name is string => Boolean(name));
}

function buildArtifactPaths(artifactDir: string, now: Date) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    latest: path.join(artifactDir, 'latest.json'),
    timestamped: path.join(artifactDir, `${stamp}.json`)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
