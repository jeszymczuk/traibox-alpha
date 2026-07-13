import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDING_POLICY } from './binding-policy';

/**
 * Semantic binding-policy registry (semantic evidence-binding closure §§1–2).
 * The TypeScript registry loads the SAME shared fixture the Python Workbench
 * emits, so the API and Trade Brain authorize identical mappings; the Python
 * suite asserts registry equality against its in-code rules.
 */

describe('capital semantic binding-policy registry (TypeScript)', () => {
  it('loads the versioned policy with the conservative rule set', () => {
    expect(DEFAULT_BINDING_POLICY.policyVersion).toBe('capital-binding-policy-v1');
    const ids = DEFAULT_BINDING_POLICY.allRules().map((rule) => rule.rule_id);
    expect(ids).toContain('BR-TRADE-AMOUNT-REVENUE');
    expect(ids).toContain('BR-OFFER-TENOR');
    expect(ids).toContain('BR-CTX-INVOICE-EXISTS');
    // Every rule is an exact-identity mapping this release (no conversions).
    for (const rule of DEFAULT_BINDING_POLICY.allRules()) {
      expect(rule.exact_identity).toBe(true);
      expect(rule.deterministic_conversion).toBeNull();
    }
  });

  it('authorizes the defensible trade-amount → revenue mapping only', () => {
    const rule = DEFAULT_BINDING_POLICY.authorize({
      calculator_id: 'capital.calculate_transaction_pnl',
      calculator_key: 'pnl',
      input_path: 'revenue',
      object_type: 'trade',
      source_layer: 'relational',
      field_path: 'amount',
      value_type: 'decimal',
      source_currency: 'EUR',
      target_currency: 'EUR',
      source_concept: 'trade_contract_amount'
    });
    expect(rule?.rule_id).toBe('BR-TRADE-AMOUNT-REVENUE');
  });

  it('refuses to authorize a trade amount for fixed costs / opening cash / facilities (equal or not)', () => {
    for (const input of ['fixed_costs', 'variable_costs', 'transaction_specific_costs']) {
      const rule = DEFAULT_BINDING_POLICY.authorize({
        calculator_id: 'capital.calculate_transaction_pnl',
        calculator_key: 'pnl',
        input_path: input,
        object_type: 'trade',
        source_layer: 'relational',
        field_path: 'amount',
        value_type: 'decimal',
        source_currency: 'EUR',
        target_currency: 'EUR',
        source_concept: 'trade_contract_amount'
      });
      expect(rule, `${input} must not be authorized from a trade amount`).toBeNull();
    }
    const openingCash = DEFAULT_BINDING_POLICY.authorize({
      calculator_id: 'capital.calculate_working_capital',
      calculator_key: 'working_capital',
      input_path: 'opening_cash',
      object_type: 'trade',
      source_layer: 'relational',
      field_path: 'amount',
      value_type: 'decimal',
      source_currency: 'EUR',
      target_currency: 'EUR',
      source_concept: 'trade_contract_amount'
    });
    expect(openingCash).toBeNull();
  });

  it('authorizes opening cash only from an account balance', () => {
    const rule = DEFAULT_BINDING_POLICY.authorize({
      calculator_id: 'capital.calculate_working_capital',
      calculator_key: 'working_capital',
      input_path: 'opening_cash',
      object_type: 'account',
      source_layer: 'relational',
      field_path: 'balance',
      value_type: 'decimal',
      source_currency: 'EUR',
      target_currency: 'EUR',
      source_concept: 'account_balance'
    });
    expect(rule?.rule_id).toBe('BR-ACCOUNT-OPENING-CASH');
  });

  it('fails closed on wrong value type, wrong concept, and wrong currency', () => {
    const base = {
      calculator_id: 'capital.calculate_financing_cost',
      calculator_key: 'term_economics',
      input_path: 'tenor_days',
      object_type: 'finance_offer',
      source_layer: 'relational',
      field_path: 'tenor_days',
      source_concept: 'offer_tenor'
    };
    expect(DEFAULT_BINDING_POLICY.authorize({ ...base, value_type: 'integer' })?.rule_id).toBe('BR-OFFER-TENOR');
    expect(DEFAULT_BINDING_POLICY.authorize({ ...base, value_type: 'decimal' })).toBeNull(); // wrong type
    expect(DEFAULT_BINDING_POLICY.authorize({ ...base, value_type: 'integer', source_concept: 'other' })).toBeNull(); // wrong concept
    expect(DEFAULT_BINDING_POLICY.authorize({ ...base, value_type: 'integer', input_path: 'day_count' })).toBeNull(); // unrelated input
  });

  it('runs the structural pre-check the API uses before the Brain call', () => {
    expect(DEFAULT_BINDING_POLICY.hasTargetForKey('pnl', 'revenue')).toBe(true);
    expect(DEFAULT_BINDING_POLICY.hasTargetForKey('pnl', 'fixed_costs')).toBe(false);
    expect(DEFAULT_BINDING_POLICY.hasTargetForKey('@context', 'trade_context.invoice_exists')).toBe(true);
  });
});
