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
  return {
    title: input.title ?? 'TRAIBOX alpha proof bundle',
    org_id: input.orgId,
    trade_id: input.tradeId,
    object_ids: input.objectIds,
    artifacts: input.artifacts,
    generated_at: input.generatedAt,
    generated_by: input.generatedBy,
    shareable: input.shareable ?? false
  };
}

export function buildProofRootInput(input: { manifestSha256: string; traceId: string; artifactCount: number }) {
  return {
    manifest_sha256: input.manifestSha256,
    trace_id: input.traceId,
    artifact_count: input.artifactCount
  };
}
