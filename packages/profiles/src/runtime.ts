import type { Profile } from './schema.js';

export type RuntimeTarget = 'api' | 'worker' | 'web' | 'ci';
export type RuntimeCheckSeverity = 'pass' | 'warn' | 'fail';

export interface RuntimeCheck {
  key: string;
  severity: RuntimeCheckSeverity;
  message: string;
  env_vars?: string[];
  degraded_mode?: boolean;
}

export interface RuntimeReadinessReport {
  status: RuntimeCheckSeverity;
  profile_id: string;
  region: string;
  target: RuntimeTarget;
  generated_at: string;
  checks: RuntimeCheck[];
  missing_required_env: string[];
  warnings: string[];
  degraded_mode: boolean;
  pilot: {
    controlled_rollout: boolean;
    target_smes: number;
    required_smoke_scenarios: string[];
  };
}

export function validateRuntimeEnvironment(input: {
  profile: Profile;
  target: RuntimeTarget;
  env?: Record<string, string | undefined>;
  generatedAt?: string;
}): RuntimeReadinessReport {
  const env = input.env ?? process.env;
  const checks: RuntimeCheck[] = [];

  addEnvCheck(checks, env, {
    key: 'database.url',
    envVars: ['DATABASE_URL'],
    required: ['api', 'worker', 'ci'].includes(input.target),
    message: 'Canonical Postgres connection is configured.'
  });

  addAuthChecks(checks, env, input.profile);
  addIntegrationChecks(checks, env, input.profile, input.target);
  addPrivacyChecks(checks, input.profile);
  addPilotPolicyChecks(checks, input.profile);

  const missingRequired = checks.filter((check) => check.severity === 'fail').flatMap((check) => check.env_vars ?? []);
  const warnings = checks.filter((check) => check.severity === 'warn').map((check) => check.message);
  const status: RuntimeCheckSeverity = checks.some((check) => check.severity === 'fail') ? 'fail' : warnings.length ? 'warn' : 'pass';

  return {
    status,
    profile_id: input.profile.profile_id,
    region: input.profile.region,
    target: input.target,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    checks,
    missing_required_env: Array.from(new Set(missingRequired)),
    warnings,
    degraded_mode: checks.some((check) => check.degraded_mode),
    pilot: {
      controlled_rollout: input.profile.pilot.controlled_rollout,
      target_smes: input.profile.pilot.target_smes,
      required_smoke_scenarios: input.profile.pilot.required_smoke_scenarios
    }
  };
}

export function assertRuntimeReady(report: RuntimeReadinessReport): void {
  if (report.status !== 'fail') return;
  const missing = report.missing_required_env.length ? ` Missing env: ${report.missing_required_env.join(', ')}.` : '';
  throw new Error(`TRAIBOX runtime is not pilot-ready for ${report.target} (${report.profile_id}).${missing}`);
}

function addAuthChecks(checks: RuntimeCheck[], env: Record<string, string | undefined>, profile: Profile) {
  const authMode = (env.AUTH_MODE ?? 'dev').toLowerCase();
  if (profile.pilot.controlled_rollout && authMode === 'dev') {
    checks.push({
      key: 'auth.mode',
      severity: 'fail',
      message: 'Controlled pilot profiles must not run with AUTH_MODE=dev.',
      env_vars: ['AUTH_MODE']
    });
    return;
  }
  if (authMode === 'dev') {
    addEnvCheck(checks, env, {
      key: 'auth.dev_user',
      envVars: ['DEV_USER_ID'],
      required: true,
      message: 'Dev auth user is configured.'
    });
    return;
  }
  if (authMode === 'supabase') {
    const hasLocalJwt = hasEnv(env, 'SUPABASE_JWT_SECRET');
    const hasRemoteAuth = hasEnv(env, 'SUPABASE_URL') && hasEnv(env, 'SUPABASE_ANON_KEY');
    checks.push({
      key: 'auth.supabase',
      severity: hasLocalJwt || hasRemoteAuth ? 'pass' : 'fail',
      message: hasLocalJwt || hasRemoteAuth ? 'Supabase auth verification is configured.' : 'Supabase auth requires SUPABASE_JWT_SECRET or SUPABASE_URL + SUPABASE_ANON_KEY.',
      env_vars: hasLocalJwt || hasRemoteAuth ? [] : ['SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']
    });
    return;
  }
  checks.push({
    key: 'auth.mode',
    severity: 'fail',
    message: `Unsupported AUTH_MODE=${authMode}.`,
    env_vars: ['AUTH_MODE']
  });
}

function addIntegrationChecks(checks: RuntimeCheck[], env: Record<string, string | undefined>, profile: Profile, target: RuntimeTarget) {
  if (target === 'api' && hasEnv(env, 'TRADE_BRAIN_URL')) {
    addEnvCheck(checks, env, {
      key: 'trade_brain.service_auth',
      envVars: ['TRADE_BRAIN_SERVICE_TOKEN'],
      required: true,
      message: 'Trade Brain service-to-service authentication is configured.'
    });
  }

  const activePaymentProvider = profile.payments.active_provider;
  checks.push({
    key: 'payments.provider_strategy',
    severity: 'pass',
    message: `Payment execution rails are provider-neutral; active provider is ${activePaymentProvider}. Manual fallback is ${profile.payments.manual.enabled ? 'enabled' : 'disabled'}.`,
    degraded_mode: profile.payments.manual.enabled
  });

  if (activePaymentProvider === 'manual') {
    checks.push({
      key: 'payments.manual.active',
      severity: profile.payments.manual.enabled ? 'pass' : 'fail',
      message: profile.payments.manual.enabled
        ? 'Manual payment execution is the intentional active staging rail.'
        : 'Manual payment execution is selected but disabled in the deployment profile.'
    });
  }

  if (activePaymentProvider === 'truelayer' && !profile.payments.truelayer.enabled) {
    checks.push({
      key: 'payments.truelayer.configuration',
      severity: 'fail',
      message: 'TrueLayer is selected as the active payment provider but its adapter is disabled.'
    });
  } else if (activePaymentProvider === 'truelayer') {
    addEnvCheck(checks, env, {
      key: 'payments.truelayer.credentials',
      envVars: ['TRUELAYER_CLIENT_ID', 'TRUELAYER_CLIENT_SECRET'],
      required: true,
      message: 'TrueLayer credentials are configured.'
    });
    if (profile.payments.truelayer.webhooks.verify_signatures && target === 'api') {
      addEnvCheck(checks, env, {
        key: 'payments.truelayer.webhook_secret',
        envVars: ['TRUELAYER_WEBHOOK_SECRET'],
        required: true,
        message: 'TrueLayer webhook signature verification secret is configured.'
      });
    }
  } else {
    checks.push({
      key: 'payments.truelayer.disabled',
      severity: 'pass',
      message: profile.payments.truelayer.enabled
        ? 'TrueLayer is configured as a standby adapter but is not the selected payment rail.'
        : 'TrueLayer is intentionally disabled for the selected deployment profile.'
    });
  }

  if (activePaymentProvider === 'ibanfirst' && !profile.payments.ibanfirst.enabled) {
    checks.push({
      key: 'payments.ibanfirst.configuration',
      severity: 'fail',
      message: 'iBanFirst is selected as the active payment provider but its adapter is disabled.'
    });
  } else if (activePaymentProvider === 'ibanfirst') {
    addEnvCheck(checks, env, {
      key: 'payments.ibanfirst.credentials',
      envVars: ['IBANFIRST_API_KEY'],
      required: true,
      message: 'iBanFirst credentials are configured.'
    });
    if (profile.payments.ibanfirst.webhooks.verify_signatures && target === 'api') {
      addEnvCheck(checks, env, {
        key: 'payments.ibanfirst.webhook_secret',
        envVars: ['IBANFIRST_WEBHOOK_SECRET'],
        required: true,
        message: 'iBanFirst webhook signature verification secret is configured.'
      });
    }
  }

  if (profile.compliance.complyadvantage.enabled) {
    addEnvCheck(checks, env, {
      key: 'compliance.complyadvantage',
      envVars: ['COMPLYADVANTAGE_API_KEY'],
      required: true,
      message: 'ComplyAdvantage credentials are configured.'
    });
  }

  if (profile.ledger.anchoring.enabled && target !== 'web') {
    addEnvCheck(checks, env, {
      key: 'ledger.anchoring',
      envVars: ['EVM_RPC_URL', 'EVM_ANCHOR_REGISTRY_ADDRESS', 'EVM_ANCHOR_WALLET_PRIVATE_KEY'],
      required: true,
      message: `Ledger anchoring credentials are configured for ${profile.ledger.anchoring.adapter} on ${profile.ledger.anchoring.network}.`
    });
  }

  if (profile.pilot.controlled_rollout) {
    addEnvCheck(checks, env, {
      key: 'partners.jwt',
      envVars: ['PARTNER_JWT_SECRET'],
      required: target === 'api',
      message: 'Partner JWT secret is configured for finance offer submissions.'
    });
    addEnvCheck(checks, env, {
      key: 'storage.service_role',
      envVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      required: target === 'api',
      message: 'Object storage service credentials are configured.'
    });
  }
}

function addPilotPolicyChecks(checks: RuntimeCheck[], profile: Profile) {
  if (profile.pilot.degraded_mode.manual_payment_fallback_required && !profile.payments.manual.enabled) {
    checks.push({
      key: 'pilot.manual_payment_fallback',
      severity: 'fail',
      message: 'Pilot profile requires manual payment fallback to keep demos moving when AIS/PIS is unavailable.'
    });
  } else if (profile.payments.manual.enabled) {
    checks.push({
      key: 'pilot.manual_payment_fallback',
      severity: 'pass',
      message: 'Manual payment fallback is available for degraded pilot operation.'
    });
  }

  if (profile.pilot.controlled_rollout && profile.pilot.degraded_mode.partner_offer_fallback_required && profile.finance.demo_offers_enabled) {
    checks.push({
      key: 'pilot.partner_offer_mode',
      severity: 'fail',
      message: 'Controlled pilot profiles should use partner-submitted finance offers instead of demo offers.'
    });
  }

  if (!profile.features.tradebrain_llm_enabled && profile.pilot.degraded_mode.allow_llm_disabled) {
    checks.push({
      key: 'pilot.trade_brain_mode',
      severity: 'warn',
      message: 'Trade Brain LLM mode is disabled; deterministic alpha intelligence remains available.',
      degraded_mode: true
    });
  }
}

function addPrivacyChecks(checks: RuntimeCheck[], profile: Profile) {
  const dataRegion = profile.privacy.data_region.toLowerCase();
  if (profile.pilot.controlled_rollout && !dataRegion.startsWith('eu')) {
    checks.push({
      key: 'privacy.data_region',
      severity: 'fail',
      message: 'Controlled EU pilot profiles must keep data residency in an EU region.'
    });
  } else {
    checks.push({
      key: 'privacy.data_region',
      severity: 'pass',
      message: `Data residency is configured for ${profile.privacy.data_region}.`
    });
  }

  checks.push({
    key: 'privacy.pii_on_chain',
    severity: profile.privacy.pii_on_chain ? 'fail' : 'pass',
    message: profile.privacy.pii_on_chain ? 'PII must never be written on-chain.' : 'PII-on-chain is disabled.'
  });

  if (profile.privacy.retention.audit_days < 365) {
    checks.push({
      key: 'privacy.audit_retention',
      severity: 'fail',
      message: 'Audit retention must be at least 365 days for pilot and production readiness.'
    });
  } else {
    checks.push({
      key: 'privacy.audit_retention',
      severity: 'pass',
      message: `Audit retention is ${profile.privacy.retention.audit_days} day(s).`
    });
  }

  if (profile.privacy.retention.external_access_token_days > 90) {
    checks.push({
      key: 'privacy.external_access_retention',
      severity: 'warn',
      message: 'External access token retention is longer than 90 days; confirm this is intentional before production.'
    });
  }
}

function addEnvCheck(
  checks: RuntimeCheck[],
  env: Record<string, string | undefined>,
  input: { key: string; envVars: string[]; required: boolean; message: string }
) {
  const missing = input.envVars.filter((name) => !hasEnv(env, name));
  checks.push({
    key: input.key,
    severity: missing.length && input.required ? 'fail' : missing.length ? 'warn' : 'pass',
    message: missing.length ? `${input.message} Missing: ${missing.join(', ')}.` : input.message,
    env_vars: missing
  });
}

function hasEnv(env: Record<string, string | undefined>, key: string) {
  return typeof env[key] === 'string' && env[key]!.trim().length > 0;
}
