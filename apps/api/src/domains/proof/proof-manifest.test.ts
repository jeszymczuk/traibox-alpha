import { describe, expect, it } from 'vitest';

import { buildProofArtifactRefs, buildProofManifest, buildProofRootInput } from './proof-manifest';

describe('proof manifest domain model', () => {
  it('turns alpha objects into stable proof artifact references', () => {
    const artifacts = buildProofArtifactRefs([
      {
        object_id: '00000000-0000-0000-0000-000000000101',
        type: 'payment_intent',
        status: 'approval_required',
        title: 'Supplier advance',
        trace_id: 'trc_payment'
      },
      {
        object_id: '00000000-0000-0000-0000-000000000102',
        type: 'readiness_state',
        status: 'completed',
        title: 'Readiness: missing',
        trace_id: 'trc_readiness'
      }
    ]);

    expect(artifacts).toEqual([
      {
        object_id: '00000000-0000-0000-0000-000000000101',
        type: 'payment_intent',
        status: 'approval_required',
        title: 'Supplier advance',
        trace_id: 'trc_payment'
      },
      {
        object_id: '00000000-0000-0000-0000-000000000102',
        type: 'readiness_state',
        status: 'completed',
        title: 'Readiness: missing',
        trace_id: 'trc_readiness'
      }
    ]);
  });

  it('builds the alpha proof manifest envelope with explicit share controls', () => {
    const artifact = {
      object_id: '00000000-0000-0000-0000-000000000201',
      type: 'proof_bundle',
      status: 'completed',
      title: 'Internal proof',
      trace_id: 'trc_proof'
    };

    const manifest = buildProofManifest({
      title: 'Pilot proof bundle',
      orgId: '00000000-0000-0000-0000-000000000001',
      tradeId: '00000000-0000-0000-0000-000000000002',
      objectIds: [artifact.object_id],
      artifacts: [artifact],
      generatedAt: '2026-05-19T08:10:00.000Z',
      generatedBy: '00000000-0000-0000-0000-000000000003',
      shareable: true
    });

    expect(manifest).toMatchObject({
      title: 'Pilot proof bundle',
      org_id: '00000000-0000-0000-0000-000000000001',
      trade_id: '00000000-0000-0000-0000-000000000002',
      object_ids: [artifact.object_id],
      artifacts: [artifact],
      generated_at: '2026-05-19T08:10:00.000Z',
      generated_by: '00000000-0000-0000-0000-000000000003',
      shareable: true
    });
  });

  it('keeps proof-root inputs minimal and deterministic', () => {
    expect(buildProofRootInput({ manifestSha256: 'sha', traceId: 'trc_123', artifactCount: 3 })).toEqual({
      manifest_sha256: 'sha',
      trace_id: 'trc_123',
      artifact_count: 3
    });
  });
});
