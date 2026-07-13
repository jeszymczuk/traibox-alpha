import { describe, expect, it, vi } from 'vitest';
import { recordProtectedDenial } from './protected-denial-audit';

describe('protected denial audit', () => {
  it('writes exactly one redacted structured event for an authenticated denial', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() })
    } as unknown as Parameters<typeof recordProtectedDenial>[0];
    await recordProtectedDenial(pool, {
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000004',
      traceId: 'trace-safe',
      action: 'send_payment',
      target: { type: 'payment_intent', id: 'creditor-iban-PT50002700000001234567833' },
      approvalId: 'secret-approval-reference',
      code: 'validation_error',
      classification: 'malformed_execution_request',
      payloadHash: 'a'.repeat(64),
      idempotencyKey: 'raw-secret-idempotency-key'
    });

    const inserts = query.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO audit_events'));
    expect(inserts).toHaveLength(1);
    const payload = JSON.parse(String((inserts[0]![1] as unknown[])[4])) as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        action: 'send_payment',
        target: { type: 'payment_intent' },
        error_code: 'validation_error',
        classification: 'malformed_execution_request',
        payload_hash: 'a'.repeat(64),
        idempotency_fingerprint: expect.stringMatching(/^[0-9a-f]{24}$/)
      })
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('PT50002700000001234567833');
    expect(serialized).not.toContain('secret-approval-reference');
    expect(serialized).not.toContain('raw-secret-idempotency-key');
  });

  it('does not create a tenant audit without authenticated actor context', async () => {
    const connect = vi.fn();
    const pool = { connect } as unknown as Parameters<typeof recordProtectedDenial>[0];
    await recordProtectedDenial(pool, {
      orgId: '',
      userId: '',
      traceId: 'unauthenticated',
      action: 'accept_funding_offer',
      target: { type: 'funding_offer' },
      code: 'unauthorized',
      classification: 'unauthenticated'
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
