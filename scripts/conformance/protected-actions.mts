import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { loadGovernanceDocuments, PILOT_GATES, RELEASE_GATES } from './governance-schema.mts';
import { parseTypeScript, stringArrayFromVariable } from './shared/typescript.mts';
import { pathExists, readText, walkFiles } from './shared/repo.mts';

const CRITICAL_ACTIONS = ['send_payment', 'accept_funding_offer'] as const;
const CRITICAL_DISCREPANCIES: Record<(typeof CRITICAL_ACTIONS)[number], string> = {
  send_payment: 'PA-001',
  accept_funding_offer: 'PA-002'
};

const COMMON_IMPLEMENTATION_EVIDENCE = [
  'packages/contracts/src/index.ts',
  'apps/api/src/server.ts',
  'apps/api/src/domains/approvals/protected-execution.ts',
  'apps/api/src/domains/approvals/protected-execution-consumption.ts',
  'apps/api/src/services/protected-denial-audit.ts'
] as const;

const ACTION_IMPLEMENTATION_EVIDENCE: Record<(typeof CRITICAL_ACTIONS)[number], readonly string[]> = {
  send_payment: [
    'apps/api/src/services/payments.ts',
    'apps/api/src/services/payment-policy.ts',
    'apps/api/src/services/payment-adapters.ts',
    'apps/api/src/services/payment-provider-capability.ts'
  ],
  accept_funding_offer: ['apps/api/src/services/finance.ts']
};

const ACTION_TEST_EVIDENCE: Record<(typeof CRITICAL_ACTIONS)[number], readonly string[]> = {
  send_payment: [
    'apps/api/src/services/rails.scenario.test.ts',
    'apps/api/src/domains/approvals/protected-execution.test.ts',
    'apps/api/src/services/payments.test.ts'
  ],
  accept_funding_offer: [
    'apps/api/src/services/rails.scenario.test.ts',
    'apps/api/src/domains/approvals/protected-execution.test.ts'
  ]
};

function add(findings: ConformanceFinding[], rule: string, message: string, source = 'docs/governance/protected-actions.yaml', severity: ConformanceFinding['severity'] = 'high'): void {
  findings.push({ check: 'protected-actions', rule, message, source, severity });
}

export function compareProtectedActions(contractActions: string[], manifestActions: Array<{ identifier: string }>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const contractCounts = new Map<string, number>();
  const manifestCounts = new Map<string, number>();
  for (const action of contractActions) contractCounts.set(action, (contractCounts.get(action) ?? 0) + 1);
  for (const action of manifestActions) manifestCounts.set(action.identifier, (manifestCounts.get(action.identifier) ?? 0) + 1);
  for (const [identifier, count] of contractCounts) if (count > 1) add(findings, 'ACTION_CONTRACT_DUPLICATE', `${identifier} appears ${count} times in PROTECTED_ACTIONS`, 'packages/contracts/src/index.ts');
  for (const [identifier, count] of manifestCounts) if (count > 1) add(findings, 'ACTION_MANIFEST_DUPLICATE', `${identifier} appears ${count} times in protected-actions.yaml`);
  for (const identifier of contractCounts.keys()) if (!manifestCounts.has(identifier)) add(findings, 'ACTION_CONTRACT_MISSING_MANIFEST', `${identifier} is in PROTECTED_ACTIONS but absent from the manifest`, 'packages/contracts/src/index.ts');
  for (const identifier of manifestCounts.keys()) if (!contractCounts.has(identifier)) add(findings, 'ACTION_MANIFEST_MISSING_CONTRACT', `${identifier} is in the manifest but absent from PROTECTED_ACTIONS`);
  return findings;
}

export function checkCriticalProtectedActionMetadata(
  actions: Array<{
    identifier: string;
    severity?: string;
    release_gate?: string;
    pilot_gate?: string;
    required_remediation?: string;
    unresolved_questions?: string[];
    implementation_locations?: string[];
    test_coverage?: string[];
  }>,
  discrepancyIds: ReadonlySet<string> = new Set(Object.values(CRITICAL_DISCREPANCIES)),
  root?: string
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const identifier of CRITICAL_ACTIONS) {
    const action = actions.find((entry) => entry.identifier === identifier);
    if (!action) continue;
    if (action.severity !== 'critical') add(findings, 'ACTION_CRITICAL_SEVERITY_WEAKENED', `${identifier} must remain severity: critical`, undefined, 'critical');
    if (action.release_gate !== RELEASE_GATES[0]) add(findings, 'ACTION_CRITICAL_RELEASE_GATE_WEAKENED', `${identifier} must remain release_gate: ${RELEASE_GATES[0]}`, undefined, 'critical');
    if (action.pilot_gate !== PILOT_GATES[0]) add(findings, 'ACTION_CRITICAL_PILOT_GATE_WEAKENED', `${identifier} must remain pilot_gate: ${PILOT_GATES[0]}`, undefined, 'critical');
    if (!action.required_remediation) add(findings, 'ACTION_CRITICAL_REMEDIATION_HIDDEN', `${identifier} must retain its required remediation`, undefined, 'critical');
    const discrepancyOpen = discrepancyIds.has(CRITICAL_DISCREPANCIES[identifier]);
    if (discrepancyOpen && !action.unresolved_questions?.length) {
      add(findings, 'ACTION_CRITICAL_DEBT_HIDDEN', `${identifier} must retain unresolved evidence while ${CRITICAL_DISCREPANCIES[identifier]} is open`, undefined, 'critical');
    }
    if (!discrepancyOpen) {
      if (!action.implementation_locations?.length || !action.test_coverage?.length) {
        add(findings, 'ACTION_CRITICAL_CLOSURE_EVIDENCE_MISSING', `${identifier} must retain implementation and test evidence after ${CRITICAL_DISCREPANCIES[identifier]} closes`, undefined, 'critical');
      }
      if (action.unresolved_questions?.length) {
        add(findings, 'ACTION_CRITICAL_CLOSURE_REOPENED', `${identifier} cannot remain closed while unresolved critical questions are recorded`, undefined, 'critical');
      }
      const implementationLocations = new Set(action.implementation_locations ?? []);
      const testCoverage = new Set(action.test_coverage ?? []);
      for (const required of [...COMMON_IMPLEMENTATION_EVIDENCE, ...ACTION_IMPLEMENTATION_EVIDENCE[identifier]]) {
        if (!implementationLocations.has(required)) {
          add(findings, implementationRule(required, identifier), `${identifier} closure must cite ${required}`, undefined, 'critical');
        }
      }
      for (const required of ACTION_TEST_EVIDENCE[identifier]) {
        if (!testCoverage.has(required)) {
          add(findings, required.endsWith('rails.scenario.test.ts') ? 'ACTION_CRITICAL_DB_TEST_EVIDENCE_MISSING' : 'ACTION_CRITICAL_TEST_EVIDENCE_MISSING', `${identifier} closure must cite ${required}`, undefined, 'critical');
        }
      }
      if (root) {
        for (const evidencePath of [...implementationLocations, ...testCoverage]) {
          if (!pathExists(root, evidencePath)) {
            add(findings, 'ACTION_CRITICAL_EVIDENCE_PATH_MISSING', `${identifier} cites nonexistent evidence path ${evidencePath}`, evidencePath, 'critical');
          }
        }
        const dbTestPath = 'apps/api/src/services/rails.scenario.test.ts';
        if (testCoverage.has(dbTestPath) && pathExists(root, dbTestPath)) {
          const dbTest = readText(root, dbTestPath);
          const requiredTokens =
            identifier === 'send_payment'
              ? ['send_payment', 'approvalReuse', 'Promise.all', 'protected_execution_consumption']
              : ['accept_funding_offer', 'approvalReuse', 'Promise.all', 'finance.reservation.expired'];
          if (requiredTokens.some((token) => !dbTest.includes(token))) {
            add(findings, 'ACTION_CRITICAL_REPLAY_CONCURRENCY_EVIDENCE_MISSING', `${identifier} DB evidence must exercise action-specific replay, immutable consumption, expiry where applicable, and concurrency`, dbTestPath, 'critical');
          }
        }
      }
    }
  }
  return findings;
}

function implementationRule(path: string, identifier: (typeof CRITICAL_ACTIONS)[number]): string {
  if (path.endsWith('/protected-execution.ts')) return 'ACTION_CRITICAL_AUTHORIZATION_EVIDENCE_MISSING';
  if (path.endsWith('/protected-execution-consumption.ts')) return 'ACTION_CRITICAL_CONSUMPTION_EVIDENCE_MISSING';
  if (path.endsWith('/server.ts')) return 'ACTION_CRITICAL_ROUTE_EVIDENCE_MISSING';
  if (path === 'packages/contracts/src/index.ts') return 'ACTION_CRITICAL_CONTRACT_EVIDENCE_MISSING';
  if (path.endsWith('/protected-denial-audit.ts')) return 'ACTION_CRITICAL_DENIAL_EVIDENCE_MISSING';
  if ((identifier === 'send_payment' && path.endsWith('/payments.ts')) || (identifier === 'accept_funding_offer' && path.endsWith('/finance.ts'))) {
    return 'ACTION_CRITICAL_GUARDED_SERVICE_EVIDENCE_MISSING';
  }
  return 'ACTION_CRITICAL_ACTION_IMPLEMENTATION_EVIDENCE_MISSING';
}

export function checkLivePaymentProviderBoundaries(root: string): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const productionFiles = walkFiles(root, 'apps/api/src', (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'));
  const restrictions: Array<{ token: RegExp; allowed: ReadonlySet<string>; capability: string }> = [
    {
      token: /import\s*\{[^}]*\bgetPaymentAdapter\b[^}]*\}\s*from\s*['"][^'"]*payment-adapters\.js['"];/s,
      allowed: new Set(['apps/api/src/services/payments.ts']),
      capability: 'payment adapter selection'
    },
    {
      token: /import\s*\{[^}]*\bissueLivePaymentExecutionCapability\b[^}]*\}\s*from\s*['"][^'"]*payment-provider-capability\.js['"];/s,
      allowed: new Set(['apps/api/src/services/payments.ts']),
      capability: 'live capability issuance'
    },
    {
      token: /import\s*\{[^}]*(?:\bclientCredentialsToken\b|\bcreatePayment\b)[^}]*\}\s*from\s*['"][^'"]*truelayer\.js['"];/s,
      allowed: new Set(['apps/api/src/services/payment-adapters.ts']),
      capability: 'TrueLayer payment credentials or network access'
    },
    {
      token: /import\s*\{[^}]*\bassertLivePaymentExecutionCapability\b[^}]*\}\s*from\s*['"][^'"]*payment-provider-capability\.js['"];/s,
      allowed: new Set(['apps/api/src/services/payment-adapters.ts']),
      capability: 'live capability validation'
    }
  ];
  for (const path of productionFiles) {
    const source = readText(root, path);
    for (const restriction of restrictions) {
      if (restriction.token.test(source) && !restriction.allowed.has(path)) {
        add(findings, 'LIVE_PAYMENT_PROVIDER_BOUNDARY_BYPASS', `${path} imports ${restriction.capability} outside the guarded payment execution boundary`, path, 'critical');
      }
    }
  }
  return findings;
}

export function checkProtectedActions(context: CheckContext): ConformanceFinding[] {
  const { protectedActions } = loadGovernanceDocuments(context.root);
  const contractActions = stringArrayFromVariable(parseTypeScript(context.root, 'packages/contracts/src/index.ts'), 'PROTECTED_ACTIONS');
  const findings = compareProtectedActions(contractActions, protectedActions.actions);
  findings.push(...checkCriticalProtectedActionMetadata(protectedActions.actions, new Set(protectedActions.discrepancies.map((entry) => entry.id)), context.root));
  findings.push(...checkLivePaymentProviderBoundaries(context.root));
  return findings;
}

export async function runProtectedActionsCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'protected-actions', findings: checkProtectedActions(context), baselined: [] };
}
