import type { AlphaObject, UUID } from '@traibox/contracts';

export type ProofArtifactRef = {
  object_id: UUID;
  type: string;
  status: string;
  title: string;
  trace_id: string;
};

export type ProofManifest = {
  title: string;
  org_id: UUID;
  trade_id: UUID | null;
  object_ids: UUID[];
  artifacts: ProofArtifactRef[];
  generated_at: string;
  generated_by: UUID;
  shareable: boolean;
  share_policy: ProofSharePolicy;
};

export type ProofSharePolicy = {
  external_sharing_status: 'internal_only' | 'approval_required' | 'approved_for_controlled_share';
  protected_action: 'share_proof_bundle_externally';
  approval_required: boolean;
  allowed_scopes: string[];
  human_control: {
    recipient_required: boolean;
    step_up_required: boolean;
    residual_risk_acknowledgement_required: boolean;
    external_action_performed_by_traibox: boolean;
  };
};

export function buildProofArtifactRefs(objects: Array<Pick<AlphaObject, 'object_id' | 'type' | 'status' | 'title' | 'trace_id'>>): ProofArtifactRef[] {
  return objects.map((object) => ({
    object_id: object.object_id,
    type: object.type,
    status: object.status,
    title: object.title,
    trace_id: object.trace_id
  }));
}

export function buildProofManifest(input: {
  title?: string;
  orgId: UUID;
  tradeId: UUID | null;
  objectIds: UUID[];
  artifacts: ProofArtifactRef[];
  generatedAt: string;
  generatedBy: UUID;
  shareable?: boolean;
}): ProofManifest {
  const shareable = input.shareable ?? false;
  return {
    title: input.title ?? 'TRAIBOX alpha proof bundle',
    org_id: input.orgId,
    trade_id: input.tradeId,
    object_ids: input.objectIds,
    artifacts: input.artifacts,
    generated_at: input.generatedAt,
    generated_by: input.generatedBy,
    shareable,
    share_policy: buildProofSharePolicy({ shareable })
  };
}

export function buildProofSharePolicy(input: { shareable?: boolean; approved?: boolean } = {}): ProofSharePolicy {
  return {
    external_sharing_status: input.approved ? 'approved_for_controlled_share' : input.shareable ? 'approval_required' : 'internal_only',
    protected_action: 'share_proof_bundle_externally',
    approval_required: true,
    allowed_scopes: ['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle'],
    human_control: {
      recipient_required: true,
      step_up_required: true,
      residual_risk_acknowledgement_required: true,
      external_action_performed_by_traibox: false
    }
  };
}

export function buildProofRootInput(input: { manifestSha256: string; traceId: string; artifactCount: number }) {
  return {
    manifest_sha256: input.manifestSha256,
    trace_id: input.traceId,
    artifact_count: input.artifactCount
  };
}
