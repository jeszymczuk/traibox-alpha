# TRAIBOX Data Retention And Privacy Controls

TRAIBOX is evidence-by-default, but evidence must remain governed.

## Profile Controls

Deployment profiles define:

- `privacy.data_region`: expected data residency.
- `privacy.pii_on_chain`: must remain `false`.
- `privacy.retention.evidence_days`: artifact and evidence retention target.
- `privacy.retention.audit_days`: audit retention target.
- `privacy.retention.memory_days`: Trade Memory retention target.
- `privacy.retention.eval_artifact_days`: AI eval artifact retention target.
- `privacy.retention.external_access_token_days`: scoped guest access token retention target.
- `privacy.data_subject_requests.export_sla_days`: export response target.
- `privacy.data_subject_requests.deletion_review_sla_days`: deletion review target.

Runtime preflight blocks controlled EU pilot profiles if:

- Data region is not EU-aligned.
- PII-on-chain is enabled.
- Audit retention is below 365 days.

## On-Chain Policy

Never write PII on-chain.

Proof anchoring should use hashes, roots, manifests, and non-identifying memo data only.

## External Access

Scoped guest access must be:

- Target-bound.
- Expiring.
- Revocable.
- Audited.
- Preserved in Trade Memory after revocation.

## Data Subject Requests

For export requests:

1. Confirm requester identity and organization scope.
2. Export scoped objects, evidence metadata, proof bundles, audit, and memory.
3. Exclude cross-tenant data and unrelated external participant data.
4. Record the request and response in audit.

For deletion requests:

1. Confirm legal basis and operational impact.
2. Preserve audit/proof obligations where required.
3. Redact or detach personal data where deletion conflicts with proof/audit retention.
4. Record reviewer, decision, and affected objects.

## Pilot Rule

During controlled pilots, default to retention and redaction over deletion unless legal review approves deletion.
