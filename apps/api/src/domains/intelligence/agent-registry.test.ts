import { describe, expect, it } from 'vitest';
import { AGENT_REGISTRY, resolveSpecialist, stripSpecialistMention } from './agent-registry';
import { agentRuntimePolicyViolations, buildAgentRuntimePolicy } from './agent-runtime';
import { composeFinancingPacket, packetToMarkdown } from './specialists/capital-agent';

describe('agent registry', () => {
  it('every registered specialist scope passes the runtime policy with zero violations', () => {
    for (const specialist of Object.values(AGENT_REGISTRY)) {
      const policy = buildAgentRuntimePolicy({
        objective: specialist.objective({ tradeId: '00000000-0000-0000-0000-0000000000cc' }),
        permittedTools: specialist.scope.permittedTools,
        dataAccess: specialist.scope.dataAccess,
        writePermissions: specialist.scope.writePermissions,
        approvalGates: specialist.scope.approvalGates,
        timeBudgetSeconds: specialist.scope.timeBudgetSeconds
      });
      expect(agentRuntimePolicyViolations(policy), `${specialist.id} scope must normalize cleanly`).toEqual([]);
      expect(policy.denied_tools).toEqual([]);
      expect(policy.denied_data_access).toEqual([]);
      expect(policy.denied_write_permissions).toEqual([]);
      expect(policy.can_execute_protected_actions).toBe(false);
    }
  });

  it('capital agent objective infers only the funding gate (wording is load-bearing)', () => {
    const specialist = AGENT_REGISTRY.capital_agent!;
    const policy = buildAgentRuntimePolicy({
      objective: specialist.objective({ tradeId: 'abc' }),
      approvalGates: specialist.scope.approvalGates
    });
    // "financing" must infer submit_funding_request; the wording must NOT
    // contain "payment", which would silently add a send_payment gate.
    expect(policy.approval_gates).toEqual(['submit_funding_request']);
    expect(specialist.objective({ tradeId: 'abc' }).toLowerCase()).not.toContain('payment');
  });

  it('resolves a specialist by id, case-insensitively', () => {
    expect(resolveSpecialist('capital_agent', null)?.id).toBe('capital_agent');
    expect(resolveSpecialist('Capital_Agent', null)?.id).toBe('capital_agent');
    expect(resolveSpecialist('unknown_agent', null)).toBeNull();
  });

  it('falls back to a leading @-mention in the message', () => {
    expect(resolveSpecialist(null, '@Capital Agent fund my export order')?.id).toBe('capital_agent');
    expect(resolveSpecialist(null, '  @capital agent lowercase mention')?.id).toBe('capital_agent');
    expect(resolveSpecialist(null, 'no mention here')).toBeNull();
    expect(resolveSpecialist(null, 'mid-sentence @Capital Agent is not a call')).toBeNull();
  });

  it('strips the mention so the model sees the real request', () => {
    const specialist = AGENT_REGISTRY.capital_agent!;
    expect(stripSpecialistMention('@Capital Agent fund my export order', specialist)).toBe('fund my export order');
    expect(stripSpecialistMention('fund my export order', specialist)).toBe('fund my export order');
  });
});

describe('capital agent packet composition (pure)', () => {
  const fundingObject = {
    object_id: 'f1',
    org_id: 'o1',
    type: 'funding_request',
    status: 'draft',
    origin_workspace: 'intelligence',
    owner_id: 'u1',
    trade_id: null,
    title: 'Standalone funding request: working capital',
    summary: null,
    payload_json: { amount: 42000, currency: 'EUR', tenor_days: 90, missing: ['purchase_order'] },
    permissions_json: {},
    evidence_refs_json: [],
    audit_refs_json: [],
    trace_id: 't',
    created_at: '',
    updated_at: ''
  } as never;

  it('composes an org-level packet without a trade in focus', () => {
    const packet = composeFinancingPacket({ tradeDetail: null, fundingObjects: [fundingObject], offerObjects: [] });
    expect(packet.kind).toBe('financing_packet');
    expect(packet.trade).toBeNull();
    expect(packet.funding_requests).toHaveLength(1);
    expect(packet.funding_requests[0]!.amount).toBe(42000);
    // The payload's missing list must flow into the checklist as absent.
    expect(packet.evidence_checklist.find((entry) => entry.item === 'purchase_order')?.present).toBe(false);
    expect(packet.readiness_gaps.some((gap) => gap.includes('No trade in focus'))).toBe(true);
    expect(packet.indicative?.amount).toBe(42000);
  });

  it('normalizes pg numeric strings from the relational layer', () => {
    const tradeDetail = {
      trade: { trade_id: 't1', title: 'Wine to Norway', corridor: 'PT-NO', amount: '18000.00', currency: 'EUR', status: 'draft', created_at: '' },
      plan: null,
      compliance: null,
      offer_request: null,
      offers: [{ offer_id: 'of1', financier_name: 'Sandbox Capital', apr_bps: '680', tenor_days: '90', currency: 'EUR', sustainability_grade: 'eligible' }],
      allocation: null,
      reservation: null,
      payments: [],
      proofs: null
    } as never;
    const packet = composeFinancingPacket({ tradeDetail, fundingObjects: [], offerObjects: [] });
    expect(packet.trade?.amount).toBe(18000);
    expect(packet.offers[0]!.apr_bps).toBe(680);
    expect(packet.indicative).toEqual({ amount: 18000, currency: 'EUR', tenor_days: 90 });
  });

  it('renders a deterministic markdown fallback narrative', () => {
    const packet = composeFinancingPacket({ tradeDetail: null, fundingObjects: [fundingObject], offerObjects: [] });
    const markdown = packetToMarkdown(packet);
    expect(markdown).toContain('# Financing Packet');
    expect(markdown).toContain('Evidence checklist');
    expect(markdown).toContain('protected action');
  });
});
