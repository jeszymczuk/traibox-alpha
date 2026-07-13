import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Versioned semantic binding-policy registry — TypeScript mirror (semantic
 * evidence-binding closure §§1–2).
 *
 * The rule content is loaded from the SAME shared fixture the Python Workbench
 * emits (packages/contracts/fixtures/capital-binding-policy.v1.json), so the
 * API and the Trade Brain authorize identical mappings by construction; a
 * parity test asserts the loaded rules match the Python registry exactly. The
 * authenticated API validates every proposed evidence binding against this
 * registry BEFORE passing it to the Trade Brain, which independently
 * revalidates. Equal numbers are never sufficient — only a policy-authorized
 * semantic mapping may verify a financial input.
 */

export const CONTEXT_CALCULATOR_ID = '@context';

export interface BindingRule {
  rule_id: string;
  source_concept: string;
  permitted_object_types: string[];
  permitted_source_layers: string[];
  permitted_field_paths: string[];
  required_value_type: string;
  currency_relationship: string;
  source_evidence_category: string;
  calculator_id: string;
  calculator_key: string;
  input_path: string;
  target_evidence_category: string;
  target_semantic_concept: string;
  exact_identity: boolean;
  deterministic_conversion: string | null;
  outcome_type: string | null;
  outcome_definition_version: string | null;
}

interface PolicyFile {
  policy_version: string;
  rules: BindingRule[];
}

const POLICY_PATH = path.resolve(__dirname, '../../../../../../packages/contracts/fixtures/capital-binding-policy.v1.json');

export interface BindingAuthorizationQuery {
  calculator_id: string;
  calculator_key: string;
  input_path: string;
  object_type: string;
  source_layer: string;
  field_path: string;
  value_type?: string | null;
  source_currency?: string | null;
  target_currency?: string | null;
  source_concept?: string | null;
  outcome_type?: string | null;
  outcome_definition_version?: string | null;
}

export class BindingPolicyRegistry {
  readonly policyVersion: string;
  private readonly rules: BindingRule[];
  private readonly byId: Map<string, BindingRule>;

  constructor(file: PolicyFile) {
    this.policyVersion = file.policy_version;
    this.rules = file.rules;
    this.byId = new Map(file.rules.map((rule) => [rule.rule_id, rule]));
  }

  static load(): BindingPolicyRegistry {
    return new BindingPolicyRegistry(JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as PolicyFile);
  }

  get(ruleId: string): BindingRule | undefined {
    return this.byId.get(ruleId);
  }

  allRules(): readonly BindingRule[] {
    return this.rules;
  }

  authorize(query: BindingAuthorizationQuery): BindingRule | null {
    for (const rule of this.rules) {
      if (rule.calculator_id !== query.calculator_id) continue;
      if (rule.calculator_key !== '*' && rule.calculator_key !== query.calculator_key) continue;
      if (rule.input_path !== query.input_path) continue;
      if (!rule.permitted_object_types.includes(query.object_type)) continue;
      if (!rule.permitted_source_layers.includes(query.source_layer)) continue;
      if (!rule.permitted_field_paths.includes(query.field_path)) continue;
      if (query.value_type != null && rule.required_value_type !== query.value_type) continue;
      if (query.source_concept != null && query.source_concept !== rule.source_concept) continue;
      if (rule.currency_relationship === 'same' && query.source_currency && query.target_currency && query.source_currency.toUpperCase() !== query.target_currency.toUpperCase()) continue;
      if (rule.outcome_type != null && rule.outcome_type !== query.outcome_type) continue;
      if (rule.outcome_definition_version != null && rule.outcome_definition_version !== query.outcome_definition_version) continue;
      return rule;
    }
    return null;
  }

  /** Structural pre-check the API runs before calling the Brain: a proposed
   * (calculator_key, input_path) must be a possible target of SOME rule. The
   * API does not hold the outcome→calculator map, so it gates on key + input
   * path; the Brain performs the full (calculator id + object + concept +
   * value) verification. */
  hasTargetForKey(calculatorKey: string, inputPath: string): boolean {
    return this.rules.some((rule) => (rule.calculator_key === '*' || rule.calculator_key === calculatorKey) && rule.input_path === inputPath);
  }
}

export const DEFAULT_BINDING_POLICY = BindingPolicyRegistry.load();
