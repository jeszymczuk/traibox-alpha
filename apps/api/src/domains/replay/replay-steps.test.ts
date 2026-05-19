import { describe, expect, it } from 'vitest';

import {
  mapAttachmentReplayStep,
  mapAuditReplayStep,
  mapEventReplayStep,
  mapObjectReplayStep,
  mapProofReplayStep,
  mapReadinessReplayStep
} from './replay-steps';

const occurredAt = new Date('2026-05-19T09:15:00.000Z');

describe('replay step domain mappers', () => {
  it('maps canonical objects into replayable snapshots with evidence and actor context', () => {
    expect(
      mapObjectReplayStep({
        object_id: 'object-1',
        type: 'payment_intent',
        title: 'Pay supplier invoice',
        created_at: occurredAt,
        trade_id: null,
        trace_id: 'trace-1',
        owner_id: 'user-1',
        status: 'approval_required',
        origin_workspace: 'finance',
        summary: 'Payment for invoice INV-42',
        payload_json: { amount: 4200, currency: 'EUR' },
        evidence_refs_json: [{ object_id: 'document-1' }]
      })
    ).toMatchObject({
      step_id: 'object:object-1',
      source: 'object',
      kind: 'object.payment_intent',
      title: 'payment intent created',
      occurred_at: '2026-05-19T09:15:00.000Z',
      object_id: 'object-1',
      actor: 'user:user-1',
      status: 'approval_required',
      payload_json: {
        type: 'payment_intent',
        origin_workspace: 'finance',
        payload: { amount: 4200, currency: 'EUR' },
        evidence_refs: [{ object_id: 'document-1' }]
      }
    });
  });

  it('maps event rows with extracted summary, object id, and status', () => {
    expect(
      mapEventReplayStep({
        event_id: 'event-1',
        trade_id: 'trade-1',
        type: 'approval_decision',
        ts: '2026-05-19T09:16:00.000Z',
        trace_id: 'trace-2',
        actor: 'user:user-2',
        data: {
          approval_object_id: 'approval-1',
          decision: 'approved'
        }
      })
    ).toMatchObject({
      step_id: 'event:event-1',
      source: 'event',
      title: 'approval decision',
      summary: 'Decision: approved',
      trade_id: 'trade-1',
      object_id: 'approval-1',
      status: 'approved'
    });
  });

  it('maps audit rows with chain hashes and payload-derived scope', () => {
    expect(
      mapAuditReplayStep({
        event_id: 'audit-1',
        trade_id: null,
        actor: 'user:user-3',
        action: 'alpha.proof.bundle.ready',
        payload_json: {
          trade_id: 'trade-2',
          bundle_id: 'bundle-1',
          status: 'completed',
          trace_id: 'trace-3'
        },
        prev_hash: 'prev-hash',
        hash: 'hash',
        created_at: occurredAt
      })
    ).toMatchObject({
      step_id: 'audit:audit-1',
      source: 'audit',
      title: 'alpha proof bundle ready',
      summary: 'Bundle bundle-1',
      trade_id: 'trade-2',
      trace_id: 'trace-3',
      status: 'completed',
      hash: 'hash',
      prev_hash: 'prev-hash'
    });
  });

  it('maps readiness rows with stable score, gaps, risks, and next action payloads', () => {
    expect(
      mapReadinessReplayStep({
        readiness_id: 'readiness-1',
        trade_id: 'trade-3',
        object_id: 'trade-3',
        overall: 'blocked',
        score: '62.4',
        dimensions_json: [{ name: 'documents', status: 'missing' }],
        missing_items_json: ['commercial_invoice'],
        risk_findings_json: ['Missing invoice'],
        next_actions_json: ['Request commercial invoice'],
        trace_id: 'trace-4',
        created_at: occurredAt
      })
    ).toMatchObject({
      step_id: 'readiness:readiness-1',
      source: 'readiness',
      title: 'Readiness blocked',
      summary: '62% · Request commercial invoice',
      trade_id: 'trade-3',
      object_id: 'trade-3',
      status: 'blocked',
      payload_json: {
        score: 62.4,
        missing_items: ['commercial_invoice'],
        risk_findings: ['Missing invoice'],
        next_actions: ['Request commercial invoice']
      }
    });
  });

  it('maps attach transitions as trade-scoped replay steps', () => {
    expect(
      mapAttachmentReplayStep({
        link_id: 'link-1',
        source_object_id: 'payment-1',
        target_type: 'trade_room',
        target_id: 'trade-4',
        mode: 'attached',
        payload_json: { reason: 'Payment belongs to this trade' },
        trace_id: 'trace-5',
        created_at: occurredAt
      })
    ).toMatchObject({
      step_id: 'attachment:link-1',
      source: 'attachment',
      kind: 'attachment.attached',
      summary: 'Payment belongs to this trade',
      trade_id: 'trade-4',
      object_id: 'payment-1',
      status: 'attached',
      payload_json: {
        target: { type: 'trade_room', id: 'trade-4' },
        mode: 'attached'
      }
    });
  });

  it('maps proof bundle rows with manifest and root hash evidence', () => {
    expect(
      mapProofReplayStep({
        bundle_id: 'bundle-2',
        trade_id: 'trade-5',
        object_id: null,
        root: 'root-hash',
        manifest_sha256: 'manifest-hash',
        artifact_refs_json: [{ object_id: 'approval-2' }, { object_id: 'readiness-2' }],
        status: 'completed',
        trace_id: 'trace-6',
        created_at: occurredAt
      })
    ).toMatchObject({
      step_id: 'proof:bundle-2',
      source: 'proof',
      summary: '2 artifact(s) · manifest-hash',
      trade_id: 'trade-5',
      object_id: 'bundle-2',
      status: 'completed',
      hash: 'root-hash',
      payload_json: {
        bundle_id: 'bundle-2',
        root: 'root-hash',
        manifest_sha256: 'manifest-hash',
        artifact_refs: [{ object_id: 'approval-2' }, { object_id: 'readiness-2' }]
      }
    });
  });
});
