# TRAIBOX Pilot Onboarding Flow

Use this flow when admitting a new SME, partner, financier, broker, or external participant into a controlled pilot environment.

## 1. Pre-Onboarding Gate

Before sending an invitation:

- Confirm the environment has passed `docs/pilot/readiness-checklist.md`.
- Confirm the release has passed `docs/production/release-safety.md`.
- Confirm the data region and retention policy match the pilot agreement.
- Confirm the participant has an assigned TRAIBOX owner.
- Confirm protected-action policy is enabled for payments, funding, external sharing, declarations, and binding trade actions.

Do not invite pilot users while runtime preflight, migration preflight, backup/restore evidence, tenant isolation, or protected-action controls are failing.

## 2. Organization Setup

For each SME:

1. Create the organization.
2. Assign the first admin user.
3. Add role-scoped users for operations, finance, compliance, and viewer access as needed.
4. Set default corridor, currency, and notification preferences.
5. Confirm approval policy for protected actions.
6. Confirm Trade Memory and proof retention expectations with the organization owner.

Minimum pilot roles:

- `owner`: organization setup, policy, and final approval.
- `ops`: Trade Room execution, tasks, and Operations Center follow-up.
- `finance`: payment intents, funding requests, offers, and reconciliation.
- `compliance`: clearance checks, screening, reports, and Trade Passport review.
- `viewer`: read-only proof, readiness, and reporting access.

## 3. Counterparty And Partner Setup

For counterparties and external participants:

1. Create or invite the counterparty from Network or a Trade Room.
2. Use scoped guest access only for the specific target object or trade.
3. Set expiry aligned with `privacy.retention.external_access_token_days`.
4. Record the invitation in audit, Trade Memory, and Operations Center.
5. Revoke access when the pilot task is completed or the participant leaves scope.

For finance partners:

1. Bootstrap the partner through the admin route described in `docs/pilot/go-live.md`.
2. Issue only the minimum API scope needed to submit pilot offers.
3. Test one funding request and one offer submission before live SME usage.
4. Confirm partner actions appear in proof, audit, and memory.

## 4. First-Session Guided Story

The first user session should prove the TRAIBOX promise without forcing the user through every module.

Run this sequence:

1. Start with messy trade input.
2. Upload a document.
3. Review extracted fields and missing proof.
4. Run readiness and clearance.
5. Create a funding request or payment intent.
6. Request human approval for the protected action.
7. Generate a proof bundle.
8. Show the Operations Center update.
9. Create a standalone object and attach it to the Trade Room.

Success means the user understands that TRAIBOX structures fragmented activity, shows what is missing or risky, coordinates governed execution, and generates trusted proof.

## 5. Pilot Support Rhythm

During the pilot:

- Review Operations Center daily for blocked work, approvals, agent tasks, proof readiness, and external participant access.
- Review Trade Memory weekly for recurring missing documents, approval bottlenecks, counterparty friction, rejected recommendations, and clearance gaps.
- Review incident and degraded-mode usage after each pilot cohort.
- Review AI eval reports before promoting a new release.

## 6. Offboarding

When a pilot participant leaves:

1. Revoke user sessions and external access tokens.
2. Confirm outstanding protected actions are cancelled or reassigned.
3. Preserve audit, proof, and memory according to retention policy.
4. Export scoped evidence if required by the pilot agreement.
5. Record offboarding in audit and organization memory.

