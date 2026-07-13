import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { loadGovernanceDocuments, PILOT_GATES, RELEASE_GATES } from './governance-schema.mts';
import { parseTypeScript, stringArrayFromVariable } from './shared/typescript.mts';

const CRITICAL_ACTIONS = ['send_payment', 'accept_funding_offer'] as const;

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

export function checkCriticalProtectedActionMetadata(actions: Array<{ identifier: string; severity?: string; release_gate?: string; pilot_gate?: string; required_remediation?: string; unresolved_questions?: string[] }>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const identifier of CRITICAL_ACTIONS) {
    const action = actions.find((entry) => entry.identifier === identifier);
    if (!action) continue;
    if (action.severity !== 'critical') add(findings, 'ACTION_CRITICAL_SEVERITY_WEAKENED', `${identifier} must remain severity: critical`, undefined, 'critical');
    if (action.release_gate !== RELEASE_GATES[0]) add(findings, 'ACTION_CRITICAL_RELEASE_GATE_WEAKENED', `${identifier} must remain release_gate: ${RELEASE_GATES[0]}`, undefined, 'critical');
    if (action.pilot_gate !== PILOT_GATES[0]) add(findings, 'ACTION_CRITICAL_PILOT_GATE_WEAKENED', `${identifier} must remain pilot_gate: ${PILOT_GATES[0]}`, undefined, 'critical');
    if (!action.unresolved_questions?.length || !action.required_remediation) add(findings, 'ACTION_CRITICAL_DEBT_HIDDEN', `${identifier} must retain unresolved evidence and required remediation`, undefined, 'critical');
  }
  return findings;
}

export function checkProtectedActions(context: CheckContext): ConformanceFinding[] {
  const { protectedActions } = loadGovernanceDocuments(context.root);
  const contractActions = stringArrayFromVariable(parseTypeScript(context.root, 'packages/contracts/src/index.ts'), 'PROTECTED_ACTIONS');
  const findings = compareProtectedActions(contractActions, protectedActions.actions);
  findings.push(...checkCriticalProtectedActionMetadata(protectedActions.actions));
  return findings;
}

export async function runProtectedActionsCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'protected-actions', findings: checkProtectedActions(context), baselined: [] };
}
