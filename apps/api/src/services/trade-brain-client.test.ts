import { describe, expect, it } from 'vitest';

import { normalizeTradeBrainCopilotPlan, requestTradeBrainCopilotPlan } from './trade-brain-client';

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
});
