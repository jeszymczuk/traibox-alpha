import { describe, expect, it } from 'vitest';
import {
  CAPITAL_ARTIFACT_TYPES,
  CAPITAL_AUTHORITY_LEVELS,
  CAPITAL_OUTCOME_STATUSES,
  CAPITAL_OUTCOME_TYPES,
  CAPITAL_TASK_CONTRACT_VERSION,
  CLAIM_TYPES,
  MEMORY_SCOPES,
  PRINCIPAL_TYPES,
  PROHIBITED_AGENT_AUTHORITIES,
  PROPOSAL_STATUSES,
  SPECIALIST_AGENT_CLASSES,
  glassBoxFromClaims,
  isWorkflowRunKind,
  workflowRuntimeCommandFor,
  workflowTypeForKind,
  type CanonicalObjectRef,
  type CapitalAgentTaskRequest,
  type CapitalArtifactVersion,
  type CapitalMonitoringState,
  type EvidenceClaim,
  type FinancialCalculationRun,
  type ProtectedActionProposal,
  type SpecialistTaskRequest
} from './index';

describe('capital v1.1 foundation contracts', () => {
  it('reserves exactly the three principal types; only company is activated by policy', () => {
    expect(PRINCIPAL_TYPES).toEqual(['company', 'financier', 'platform_internal']);
  });

  it('authority levels stop at propose_protected_action and never include execution powers', () => {
    expect(CAPITAL_AUTHORITY_LEVELS).toEqual(['observe', 'calculate', 'analyse', 'recommend', 'draft', 'monitor', 'propose_protected_action']);
    for (const prohibited of PROHIBITED_AGENT_AUTHORITIES) {
      expect(CAPITAL_AUTHORITY_LEVELS as readonly string[]).not.toContain(prohibited);
    }
    // The prohibited list itself must cover the non-negotiables.
    for (const power of ['approve', 'bind', 'execute_payment', 'release_funds', 'accept_offer', 'sign', 'lend', 'underwrite_of_record']) {
      expect(PROHIBITED_AGENT_AUTHORITIES as readonly string[]).toContain(power);
    }
  });

  it('keeps the canonical seven-class specialist taxonomy', () => {
    expect(SPECIALIST_AGENT_CLASSES).toHaveLength(7);
    expect(SPECIALIST_AGENT_CLASSES).toContain('capital_agent');
    expect(SPECIALIST_AGENT_CLASSES).toContain('concierge_coordinator');
  });

  it('canonical object references force a source-layer distinction', () => {
    const relational: CanonicalObjectRef = {
      source_layer: 'relational',
      domain: 'finance',
      object_type: 'finance_offers',
      object_id: 'of-1',
      organization_id: 'org-1'
    };
    const alpha: CanonicalObjectRef = { ...relational, source_layer: 'alpha_object', object_type: 'funding_request' };
    // Same id text in different layers is NOT the same object.
    expect(relational.source_layer).not.toBe(alpha.source_layer);
  });

  it('task requests bind principal + exact mandate version + contract version + idempotency', () => {
    const request: CapitalAgentTaskRequest = {
      contract_version: CAPITAL_TASK_CONTRACT_VERSION,
      objective: 'Diagnose trade financials',
      principal: { principal_id: 'p-1', principal_type: 'company', organization_id: 'org-1' },
      mandate: { mandate_id: 'm-1', mandate_version: 3 },
      input_object_refs: [],
      trace_id: 'trc',
      idempotency_key: 'idem-1'
    };
    expect(request.contract_version).toBe('capital-task-v1');
    expect(request.mandate.mandate_version).toBe(3);
  });

  it('outcome taxonomy carries the complete v1.1 set and lifecycle includes needs_information/abstained', () => {
    expect(CAPITAL_OUTCOME_TYPES).toHaveLength(23);
    for (const required of ['capital_diagnosis', 'transaction_pnl', 'cashflow_forecast', 'working_capital_analysis', 'financing_need_classification', 'financing_option_comparison', 'funding_packet', 'term_sheet_review', 'instrument_blueprint', 'underwriting_pre_read']) {
      expect(CAPITAL_OUTCOME_TYPES as readonly string[]).toContain(required);
    }
    for (const status of ['needs_information', 'specialist_reads_pending', 'abstained', 'finalised']) {
      expect(CAPITAL_OUTCOME_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('calculation runs demand deterministic hashes, versions, and lineage', () => {
    const run: FinancialCalculationRun = {
      run_id: 'r-1',
      calculator_id: 'capital.calculate_working_capital',
      calculator_version: '1.0.0',
      formula_version: 'wc-gap-v1',
      organization_id: 'org-1',
      principal_id: 'p-1',
      principal_type: 'company',
      mandate: { mandate_id: 'm-1', mandate_version: 1 },
      input_snapshot: { receivables: '10000.00' },
      input_provenance: [{ input_key: 'receivables', claim_id: 'c-1' }],
      assumption_claim_ids: [],
      result: { gap: '2500.00' },
      currency_policy: { base_currency: 'EUR' },
      rounding_policy: { mode: 'half_even', scale: 2 },
      input_hash: 'sha256:abc',
      result_hash: 'sha256:def',
      warnings: [],
      validation_results: [{ check: 'inputs_present', status: 'pass' }],
      status: 'completed',
      executed_by: 'workbench',
      trace_id: 'trc',
      created_at: '2026-07-12T00:00:00Z'
    };
    // The executor is the deterministic workbench by type — an LLM cannot be named authoritative.
    expect(run.executed_by).toBe('workbench');
    expect(run.input_hash).toBeTruthy();
    expect(run.result_hash).toBeTruthy();
  });

  it('claim taxonomy has all eight types and contradictions stay linked, not erased', () => {
    expect(CLAIM_TYPES).toEqual([
      'verified_fact',
      'inference',
      'assumption',
      'estimate',
      'calculation',
      'recommendation',
      'unresolved_question',
      'contradiction'
    ]);
    const claim: EvidenceClaim = {
      claim_id: 'c-2',
      claim_type: 'contradiction',
      statement: 'Invoice total conflicts with PO total',
      source_refs: [{ source_type: 'document', document_id: 'd-1' }],
      principal_id: 'p-1',
      principal_type: 'company',
      visibility_scope: 'principal',
      confidence: 'high',
      verification_status: 'conflicting',
      materiality: 'critical',
      contradicts_claim_ids: ['c-1']
    };
    expect(claim.contradicts_claim_ids).toContain('c-1');
  });

  it('artifact versions are separate immutable records keyed by (artifact_id, version)', () => {
    const version: CapitalArtifactVersion = {
      artifact_version_id: 'av-1',
      artifact_id: 'a-1',
      organization_id: 'org-1',
      principal_id: 'org-1',
      principal_type: 'company',
      version: 2,
      schema_version: 'capital-artifact-v1',
      content: { summary: 'v2' },
      evidence_bundle_id: 'b-1',
      calculation_run_ids: ['r-1'],
      unresolved_questions: [],
      generated_by: { agent_class: 'capital_agent', agent_definition_version: '1.1.0', trace_id: 'trc' },
      created_at: '2026-07-12T00:00:00Z'
    };
    expect(version.version).toBe(2);
    expect(CAPITAL_ARTIFACT_TYPES as readonly string[]).toContain('financing_packet');
  });

  it('proposals carry payload hash, expiry, SoD, idempotency — and only propose, never execute', () => {
    const proposal: ProtectedActionProposal = {
      proposal_id: 'pr-1',
      proposal_type: 'submit_funding_request',
      organization_id: 'org-1',
      principal_id: 'p-1',
      principal_type: 'company',
      mandate: { mandate_id: 'm-1', mandate_version: 1 },
      target_domain: 'finance',
      target_command: 'finance.create_funding_request',
      draft_payload: { amount: '10000.00', currency: 'EUR' },
      payload_hash: 'sha256:payload',
      rationale: 'Working-capital gap of 2,500 EUR over 60 days.',
      rationale_claim_ids: ['c-1'],
      source_outcome_id: 'o-1',
      evidence_refs: ['c-1'],
      calculation_run_ids: ['r-1'],
      unresolved_issue_ids: [],
      proposed_by_task_id: 't-1',
      proposed_by_agent_class: 'capital_agent',
      separation_of_duties: { policy_id: 'sod-v1', proposer_cannot_approve: true, required_approver_roles: ['finance'], step_up_required: true },
      expires_at: '2026-07-19T00:00:00Z',
      idempotency_key: 'idem-pr-1',
      status: 'pending_approval',
      policy_version: 'capital-actions-v1',
      trace_id: 'trc',
      created_at: '2026-07-12T00:00:00Z',
      updated_at: '2026-07-12T00:00:00Z'
    };
    expect(proposal.payload_hash).toMatch(/^sha256:/);
    expect(proposal.separation_of_duties.proposer_cannot_approve).toBe(true);
    expect(PROPOSAL_STATUSES as readonly string[]).not.toContain('executed');
  });

  it('memory is scoped and governed; hidden chain-of-thought has no field to live in', () => {
    expect(MEMORY_SCOPES).toContain('user');
    expect(MEMORY_SCOPES).toContain('org');
  });

  it('specialist requests carry permitted AND excluded context — no free-form access', () => {
    const request: SpecialistTaskRequest = {
      request_id: 'sr-1',
      parent_task_id: 't-1',
      requesting_agent_class: 'capital_agent',
      target_agent_class: 'risk_agent',
      principal: { principal_id: 'p-1', principal_type: 'company', organization_id: 'org-1' },
      question: 'Counterparty credit read for buyer X',
      requested_read_type: 'risk.counterparty_credit_read',
      permitted_context_refs: [],
      disclosed_evidence_claim_ids: [],
      permitted_data_classes: ['counterparty_public'],
      excluded_context: ['company_private_memory'],
      expected_schema: 'risk-read-v1',
      authority_requested: 'read',
      status: 'requested',
      trace_id: 'trc',
      created_at: '2026-07-12T00:00:00Z'
    };
    expect(request.authority_requested).toBe('read');
    expect(request.excluded_context).toContain('company_private_memory');
  });

  it('monitoring outputs recommendations/outcomes only — no execution fields exist', () => {
    const monitoring: CapitalMonitoringState = {
      monitoring_id: 'mon-1',
      organization_id: 'org-1',
      principal_id: 'p-1',
      principal_type: 'company',
      mandate: { mandate_id: 'm-1', mandate_version: 1 },
      monitored_object_ref: { source_layer: 'alpha_object', domain: 'finance', object_type: 'funding_request', object_id: 'f-1', organization_id: 'org-1' },
      conditions: [{ condition_id: 'cond-1', description: 'evidence received', evaluator_id: 'capital.evaluate_instrument_conditions' }],
      status: 'active',
      generated_outcome_ids: [],
      generated_recommendation_ids: [],
      trace_id: 'trc',
      created_at: '2026-07-12T00:00:00Z',
      updated_at: '2026-07-12T00:00:00Z'
    };
    expect(monitoring.generated_recommendation_ids).toEqual([]);
    expect('execute' in monitoring).toBe(false);
  });

  it('glassBox adapter renders claims for legacy consumers without replacing them', () => {
    const box = glassBoxFromClaims([
      { claim_type: 'verified_fact', statement: 'Invoice INV-9 total is 12,000 EUR', verification_status: 'verified' },
      { claim_type: 'assumption', statement: 'Payment term assumed 60 days', verification_status: 'unverified' }
    ]);
    expect(box.reasons).toHaveLength(2);
    expect(box.reasons[0]).toBe('[verified_fact:verified] Invoice INV-9 total is 12,000 EUR');
  });

  it('workflow runtime accepts the five new capital kinds and pauses proposals for human approval', () => {
    for (const kind of ['agent_outcome', 'specialist_read', 'protected_action_proposal', 'capital_artifact_review', 'instrument_monitoring']) {
      expect(isWorkflowRunKind(kind)).toBe(true);
    }
    expect(isWorkflowRunKind('not_a_kind')).toBe(false);
    expect(workflowTypeForKind('agent_outcome')).toBe('AgentOutcomeWorkflow');
    const command = workflowRuntimeCommandFor({ kind: 'protected_action_proposal', status: 'pending_approval' });
    expect(command.command).toBe('await_signal');
    expect(command.awaitingSignal).toBe('approval_decision');
  });
});
