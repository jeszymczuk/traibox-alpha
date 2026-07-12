import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEDGER_RAIL_PROVIDER_CATALOG, PAYMENT_RAIL_PROVIDER_CATALOG } from '@traibox/contracts';
import { loadProfileFromFile, type Profile } from '@traibox/profiles';

type ReadinessStatus = 'pass' | 'fail';
type ProviderReadinessStatus = 'ready' | 'blocked' | 'fallback_ready' | 'planned' | 'disabled';

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
  provider_readiness: ProviderRailReadiness[];
  missing_secrets: string[];
  missing_variables: string[];
  required_workflow_inputs: string[];
  artifact_paths: {
    latest: string;
    timestamped: string;
  };
}

export interface ProviderRailReadiness {
  rail_id: string;
  category: 'payments' | 'proof_anchoring';
  provider: string;
  display_name: string;
  status: ProviderReadinessStatus;
  active: boolean;
  enabled: boolean;
  fallback_provider?: string;
  required_secrets: string[];
  missing_secrets: string[];
  operator_action: string;
}

export const BASE_STAGING_GITHUB_SECRETS = [
  'STAGING_DATABASE_URL',
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_PARTNER_JWT_SECRET',
  'STAGING_TRADE_BRAIN_SERVICE_TOKEN'
] as const;

export const BASE_STAGING_GITHUB_VARIABLES = [
  'STAGING_API_BASE_URL',
  'STAGING_WEB_BASE_URL',
  'STAGING_TRADE_BRAIN_URL'
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
  const variableSet = new Set(input.variableNames ?? []);
  const variableChecks: PresenceCheck[] = BASE_STAGING_GITHUB_VARIABLES.map((name) => ({
    name,
    type: 'variable',
    status: variableSet.has(name) ? 'pass' : 'fail',
    message: variableSet.has(name) ? `${name} is configured in GitHub Actions.` : `${name} is missing from GitHub Actions variables.`
  }));
  const inputChecks: PresenceCheck[] = REQUIRED_STAGING_WORKFLOW_INPUTS.map((name) => ({
    name,
    type: 'workflow_input',
    status: 'pass',
    message: `${name} is supplied when manually running .github/workflows/staging-rehearsal.yml.`
  }));
  const checks = [...secretChecks, ...variableChecks, ...inputChecks];
  const missingSecrets = secretChecks.filter((check) => check.status === 'fail').map((check) => check.name);
  const missingVariables = variableChecks.filter((check) => check.status === 'fail').map((check) => check.name);
  const providerReadiness = buildProviderReadiness(profile, missingSecrets);
  const artifactPaths = buildArtifactPaths(input.artifactDir ?? 'artifacts/github-staging-readiness', now);

  return {
    status: missingSecrets.length || missingVariables.length ? 'fail' : 'pass',
    generated_at: now.toISOString(),
    repository: input.repository,
    checks,
    provider_readiness: providerReadiness,
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

export function buildProviderReadiness(profile: Profile, missingSecrets: string[]): ProviderRailReadiness[] {
  const missingSet = new Set(missingSecrets);
  const manualEnabled = profile.payments.manual.enabled;

  const paymentReadiness: ProviderRailReadiness[] = PAYMENT_RAIL_PROVIDER_CATALOG.map((rail) => {
    const active = profile.payments.active_provider === rail.provider;
    const enabled =
      rail.provider === 'manual'
        ? profile.payments.manual.enabled
        : rail.provider === 'truelayer'
          ? profile.payments.truelayer.enabled
          : rail.provider === 'ibanfirst'
            ? profile.payments.ibanfirst.enabled
            : false;
    const requiredSecrets = active && enabled ? requiredSecretsForPaymentRail(profile, String(rail.provider)) : [];
    const missing = requiredSecrets.filter((secret) => missingSet.has(secret));
    const status: ProviderReadinessStatus =
      rail.status === 'planned' && !active
        ? 'planned'
        : !enabled
          ? 'disabled'
          : missing.length === 0
            ? active || rail.provider === 'manual'
              ? 'ready'
              : 'planned'
            : manualEnabled
              ? 'fallback_ready'
              : 'blocked';
    return {
      rail_id: `payment:${rail.provider}`,
      category: 'payments',
      provider: String(rail.provider),
      display_name: rail.display_name,
      status,
      active,
      enabled,
      fallback_provider: 'fallback_provider' in rail ? String(rail.fallback_provider) : undefined,
      required_secrets: requiredSecrets,
      missing_secrets: missing,
      operator_action: operatorActionForPaymentRail({ provider: String(rail.provider), active, enabled, status, missing, manualEnabled })
    };
  });

  const ledgerReadiness: ProviderRailReadiness[] = LEDGER_RAIL_PROVIDER_CATALOG.map((rail) => {
    const active = profile.ledger.anchoring.enabled && profile.ledger.anchoring.adapter === rail.provider;
    const enabled = active;
    const requiredSecrets = active ? requiredSecretsForLedgerRail(profile, String(rail.provider)) : [];
    const missing = requiredSecrets.filter((secret) => missingSet.has(secret));
    const status: ProviderReadinessStatus =
      rail.status === 'planned' && !active ? 'planned' : !enabled ? 'disabled' : missing.length ? 'blocked' : 'ready';
    return {
      rail_id: `ledger:${rail.provider}`,
      category: 'proof_anchoring',
      provider: String(rail.provider),
      display_name: rail.display_name,
      status,
      active,
      enabled,
      required_secrets: requiredSecrets,
      missing_secrets: missing,
      operator_action: operatorActionForLedgerRail({ provider: String(rail.provider), active, status, missing })
    };
  });

  return [...paymentReadiness, ...ledgerReadiness];
}

function requiredSecretsForPaymentRail(profile: Profile, provider: string): string[] {
  if (provider === 'truelayer' && profile.payments.truelayer.enabled) {
    const secrets = ['STAGING_TRUELAYER_CLIENT_ID', 'STAGING_TRUELAYER_CLIENT_SECRET'];
    if (profile.payments.truelayer.webhooks.verify_signatures) secrets.push('STAGING_TRUELAYER_WEBHOOK_SECRET');
    return secrets;
  }
  if (provider === 'ibanfirst' && profile.payments.ibanfirst.enabled) {
    return ['STAGING_IBANFIRST_API_KEY', 'STAGING_IBANFIRST_WEBHOOK_SECRET'];
  }
  return [];
}

function requiredSecretsForLedgerRail(profile: Profile, provider: string): string[] {
  if (provider === 'evm_event' && profile.ledger.anchoring.enabled) {
    return ['STAGING_EVM_RPC_URL', 'STAGING_EVM_ANCHOR_REGISTRY_ADDRESS', 'STAGING_EVM_ANCHOR_WALLET_PRIVATE_KEY'];
  }
  return [];
}

function operatorActionForPaymentRail(input: {
  provider: string;
  active: boolean;
  enabled: boolean;
  status: ProviderReadinessStatus;
  missing: string[];
  manualEnabled: boolean;
}): string {
  if (!input.enabled) return `${input.provider} is disabled in the deployment profile; no pilot action is required unless this rail becomes active.`;
  if (!input.active && input.status === 'planned') return `${input.provider} is catalogued for provider-neutral expansion, but is not selected for this staging profile.`;
  if (input.status === 'ready') return `${input.provider} is ready for the selected staging profile; protected payment execution still requires human approval.`;
  if (input.status === 'fallback_ready') return `${input.provider} is missing ${input.missing.join(', ')}; keep manual fallback enabled and do not demo live provider execution until configured.`;
  if (input.status === 'blocked') return `${input.provider} is blocked by missing ${input.missing.join(', ')} and no manual fallback is available.`;
  return `Review ${input.provider} profile configuration before pilot rehearsal.`;
}

function operatorActionForLedgerRail(input: { provider: string; active: boolean; status: ProviderReadinessStatus; missing: string[] }): string {
  if (!input.active) return `${input.provider} is not active for proof anchoring in this staging profile.`;
  if (input.status === 'ready') return `${input.provider} proof anchoring is ready; only hashes/manifests should be anchored, never PII or commercial document content.`;
  if (input.status === 'blocked') return `${input.provider} proof anchoring is blocked by missing ${input.missing.join(', ')}; run proof bundles without external anchoring until resolved.`;
  return `Review ${input.provider} anchoring configuration before pilot rehearsal.`;
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
