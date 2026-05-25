import { describe, expect, it } from 'vitest';

import {
  normalizeTradeBrainAgentScope,
  normalizeTradeBrainCopilotPlan,
  normalizeTradeBrainDocumentIntelligence,
  normalizeTradeBrainEvalReport,
  normalizeTradeBrainEvalPayload,
  normalizeTradeBrainMissingProof,
  requestTradeBrainDocumentIntelligence,
  requestTradeBrainEvalSuiteRun,
  requestTradeBrainEvalSuites,
  requestTradeBrainAgentScope,
  requestTradeBrainCopilotPlan,
  requestTradeBrainMissingProof,
  requestTradeBrainReplayLog
} from './trade-brain-client';

describe('trade brain client', () => {
  it('returns null when no service URL is configured', async () => {
    await expect(
      requestTradeBrainCopilotPlan({
        message: 'Prepare payment.',
        workspace: 'intelligence',
        traceId: 'trc_1',
        baseUrl: ''
      })
    ).resolves.toBeNull();
  });

  it('normalizes a valid Trade Brain copilot plan', () => {
    expect(
      normalizeTradeBrainCopilotPlan({
        service_version: 'trade-brain-alpha-v0',
        object_type: 'payment_intent',
        title: 'payment intent: supplier advance',
        status: 'draft',
        answer: 'Structured payment intent.',
        confidence: 0.82,
        classification_reason: 'Message refers to payment.',
        suggested_actions: [{ action: 'readiness.evaluate' }],
        ai_observability: { model: 'trade-brain' },
        eval_payload: { status: 'pass' },
        structured_output_schema: 'copilot-structured-output-alpha-v2'
      })
    ).toEqual(
      expect.objectContaining({
        serviceVersion: 'trade-brain-alpha-v0',
        objectType: 'payment_intent',
        status: 'draft',
        confidence: 0.82,
        structuredOutputSchema: 'copilot-structured-output-alpha-v2'
      })
    );
  });

  it('rejects unknown object types from the service boundary', () => {
    expect(normalizeTradeBrainCopilotPlan({ object_type: 'generic_chatbot_response' })).toBeNull();
  });

  it('posts to the configured service and returns a normalized plan', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          service_version: 'trade-brain-alpha-v0',
          object_type: 'funding_request',
          confidence: 0.8,
          suggested_actions: [],
          ai_observability: { prompt_version: 'trade-brain-copilot-alpha-v1' }
        })
      };
    };

    const plan = await requestTradeBrainCopilotPlan({
      message: 'Prepare a funding request.',
      workspace: 'finance',
      traceId: 'trc_2',
      baseUrl: 'http://trade-brain.test',
      fetchImpl
    });

    expect(calls[0]?.url).toBe('http://trade-brain.test/v1/copilot/structure');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(
      expect.objectContaining({
        message: 'Prepare a funding request.',
        workspace: 'finance',
        trace_id: 'trc_2'
      })
    );
    expect(plan).toEqual(expect.objectContaining({ objectType: 'funding_request' }));
  });

  it('normalizes document intelligence and missing-proof outputs', () => {
    expect(
      normalizeTradeBrainDocumentIntelligence({
        service_version: 'trade-brain-alpha-v0',
        trace_id: 'trc_doc',
        document_type: 'purchase_order',
        confidence: 0.88,
        extracted_fields: { seller: 'Lusitania Automation Lda', amount: { value: '48000', currency: 'EUR' } },
        missing_fields: ['buyer_tax_id'],
        required_fields: ['seller', 'buyer', 'buyer_tax_id'],
        provenance: [{ field: 'seller', source: 'text' }],
        quality_signals: { missing_field_count: 1 },
        recommendations: ['Request buyer tax ID.']
      })
    ).toEqual(
      expect.objectContaining({
        serviceVersion: 'trade-brain-alpha-v0',
        documentType: 'purchase_order',
        confidence: 0.88,
        missingFields: ['buyer_tax_id'],
        qualitySignals: expect.objectContaining({ missing_field_count: 1 })
      })
    );

    expect(
      normalizeTradeBrainMissingProof({
        service_version: 'trade-brain-alpha-v0',
        trace_id: 'trc_proof',
        object_type: 'proof_bundle',
        overall: 'missing',
        score: 76,
        required_proof: ['artifact_hashes', 'approval'],
        available_proof: ['artifact_hashes'],
        missing_items: ['approval'],
        risk_findings: ['Approval is missing.'],
        next_actions: ['Request approval.'],
        quality_signals: { missing_count: 1, proof_ready: false }
      })
    ).toEqual(
      expect.objectContaining({
        objectType: 'proof_bundle',
        overall: 'missing',
        missingItems: ['approval'],
        qualitySignals: expect.objectContaining({ proof_ready: false })
      })
    );
  });

  it('posts document intelligence and missing-proof requests to Trade Brain', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/documents/intelligence')) {
        return {
          ok: true,
          json: async () => ({
            document_type: 'invoice',
            confidence: 0.81,
            extracted_fields: { seller: 'Porto Robotics Lda' },
            missing_fields: ['payment_terms'],
            required_fields: ['seller', 'buyer', 'payment_terms'],
            provenance: [],
            quality_signals: { missing_field_count: 1 },
            recommendations: ['Request payment terms.']
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          object_type: 'proof_bundle',
          overall: 'ready',
          score: 100,
          required_proof: ['artifact_hashes'],
          available_proof: ['artifact_hashes'],
          missing_items: [],
          risk_findings: [],
          next_actions: [],
          quality_signals: { proof_ready: true }
        })
      };
    };

    const document = await requestTradeBrainDocumentIntelligence({
      filename: 'invoice.txt',
      text: 'Invoice. Seller Porto Robotics Lda.',
      traceId: 'trc_doc_post',
      baseUrl: 'http://trade-brain.test',
      fetchImpl
    });
    const proof = await requestTradeBrainMissingProof({
      objectType: 'proof_bundle',
      requiredProof: ['artifact_hashes'],
      availableProof: ['artifact_hashes'],
      traceId: 'trc_proof_post',
      baseUrl: 'http://trade-brain.test',
      fetchImpl
    });

    expect(calls.map((call) => call.url)).toEqual(['http://trade-brain.test/v1/documents/intelligence', 'http://trade-brain.test/v1/proofs/missing']);
    expect(document).toEqual(expect.objectContaining({ documentType: 'invoice', missingFields: ['payment_terms'] }));
    expect(proof).toEqual(expect.objectContaining({ objectType: 'proof_bundle', score: 100, missingItems: [] }));
  });

  it('normalizes scoped agent policy from Trade Brain', () => {
    const scope = normalizeTradeBrainAgentScope({
      service_version: 'trade-brain-alpha-v0',
      runtime_policy: {
        runtime: 'trade_brain_scoped_agent_alpha',
        scope_version: 'agent-scope-alpha-v2',
        objective: 'Review payment.',
        effective_tools: ['memory.query', 'payment.prepare'],
        denied_tools: [],
        effective_data_access: ['selected_objects'],
        denied_data_access: [],
        effective_write_permissions: ['create_agent_task', 'create_agent_work_result'],
        denied_write_permissions: [],
        approval_gates: ['send_payment'],
        inferred_approval_gates: ['send_payment'],
        time_budget_seconds: 120,
        max_time_budget_seconds: 120,
        protected_actions_blocked: true,
        policy_constraints: ['Protected actions require approval.']
      },
      violations: [],
      replay_preview: [{ step: 'scope.normalized' }]
    });

    expect(scope?.runtimePolicy.runtime).toBe('trade_brain_scoped_agent_alpha');
    expect(scope?.runtimePolicy.approval_gates).toEqual(['send_payment']);
    expect(scope?.replayPreview).toEqual([expect.objectContaining({ step: 'scope.normalized' })]);
  });

  it('posts agent scope and replay requests to the service', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/replay/build')) {
        return { ok: true, json: async () => ({ replay_log: [{ step: 'runtime.ready' }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          runtime_policy: {
            runtime: 'trade_brain_scoped_agent_alpha',
            scope_version: 'agent-scope-alpha-v2',
            effective_tools: ['readiness.evaluate'],
            effective_data_access: ['selected_objects'],
            effective_write_permissions: ['create_agent_task', 'create_agent_work_result'],
            approval_gates: ['send_payment'],
            inferred_approval_gates: ['send_payment'],
            time_budget_seconds: 60,
            max_time_budget_seconds: 120,
            protected_actions_blocked: true,
            policy_constraints: ['Protected actions require approval.']
          },
          violations: []
        })
      };
    };

    const scope = await requestTradeBrainAgentScope({
      objective: 'Review payment.',
      inputObjectTypes: ['payment_intent'],
      inputObjects: [{ object_id: 'payment-1', type: 'payment_intent' }],
      traceId: 'trc_agent',
      baseUrl: 'http://trade-brain.test',
      fetchImpl
    });
    const replay = await requestTradeBrainReplayLog({
      objective: 'Review payment.',
      runtimePolicy: scope!.runtimePolicy,
      inputObjects: [{ object_id: 'payment-1', type: 'payment_intent' }],
      traceId: 'trc_agent',
      baseUrl: 'http://trade-brain.test',
      fetchImpl
    });

    expect(calls.map((call) => call.url)).toEqual(['http://trade-brain.test/v1/agents/scope', 'http://trade-brain.test/v1/replay/build']);
    expect(scope?.runtimePolicy.runtime).toBe('trade_brain_scoped_agent_alpha');
    expect(replay).toEqual([{ step: 'runtime.ready' }]);
  });

  it('normalizes eval payloads while preserving fallback fields', () => {
    const fallback = {
      suite: 'governed-agent-alpha-v1',
      status: 'pass' as const,
      score: 90,
      checks: [],
      model: 'local-agent',
      prompt_version: 'agent-task-alpha-v2',
      context_used: {},
      artifacts_used: [],
      sources_used: [],
      confidence: 0.8,
      policy_constraints: ['Protected actions require explicit human approval.'],
      generated_recommendation: 'Request approval.',
      human_decision: 'pending' as const,
      final_outcome: 'Local fallback.',
      replayable: true,
      trace_id: 'trc_eval'
    };

    expect(
      normalizeTradeBrainEvalPayload(
        {
          suite: 'trade-brain-alpha-eval-v1',
          status: 'warn',
          score: 88,
          checks: [{ case: 'deterministic_replay', status: 'pass', score: 96 }],
          model: 'trade-brain',
          prompt_version: 'trade-brain-eval-v1',
          trace_id: 'trc_eval'
        },
        fallback
      )
    ).toEqual(expect.objectContaining({ suite: 'trade-brain-alpha-eval-v1', status: 'warn', model: 'trade-brain' }));
  });

  it('normalizes durable eval reports without clamping scores to confidence range', () => {
    const report = normalizeTradeBrainEvalReport({
      run_id: '11111111-1111-4111-8111-111111111111',
      generated_at: '2026-05-25T10:00:00Z',
      harness_version: 'trade-brain-eval-harness-alpha-v1',
      service_version: 'trade-brain-alpha-v0',
      suite_id: 'all',
      case_count: 12,
      passed: 12,
      failed: 0,
      score: 100,
      status: 'pass',
      results: [
        {
          id: 'agent_scope',
          dataset: 'agent_scope_safety',
          kind: 'agent_scope',
          tags: ['safety'],
          status: 'pass',
          checks: [{ case: 'approval_gates', status: 'pass', finding: 'Protected gate present.' }],
          summary: { approval_gates: ['send_payment'] }
        }
      ]
    });

    expect(report).toEqual(
      expect.objectContaining({
        suite_id: 'all',
        score: 100,
        results: [expect.objectContaining({ id: 'agent_scope', checks: [expect.objectContaining({ case: 'approval_gates' })] })]
      })
    );
  });

  it('lists and runs Trade Brain eval suites through the service boundary', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/evals/suites')) {
        return {
          ok: true,
          json: async () => ({
            service_version: 'trade-brain-alpha-v0',
            suites: [{ suite_id: 'copilot_classification', case_count: 5, path: '/evals/copilot_classification.jsonl' }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          run_id: '11111111-1111-4111-8111-111111111111',
          generated_at: '2026-05-25T10:00:00Z',
          harness_version: 'trade-brain-eval-harness-alpha-v1',
          service_version: 'trade-brain-alpha-v0',
          suite_id: 'copilot_classification',
          case_count: 5,
          passed: 5,
          failed: 0,
          score: 100,
          status: 'pass',
          results: []
        })
      };
    };

    const suites = await requestTradeBrainEvalSuites({ baseUrl: 'http://trade-brain.test', fetchImpl });
    const report = await requestTradeBrainEvalSuiteRun({ suiteId: 'copilot_classification', baseUrl: 'http://trade-brain.test', fetchImpl });

    expect(calls.map((call) => `${call.init?.method} ${call.url}`)).toEqual([
      'GET http://trade-brain.test/v1/evals/suites',
      'POST http://trade-brain.test/v1/evals/suites/run'
    ]);
    expect(suites?.suites[0]).toEqual(expect.objectContaining({ suite_id: 'copilot_classification', case_count: 5 }));
    expect(report).toEqual(expect.objectContaining({ suite_id: 'copilot_classification', score: 100 }));
  });
});
