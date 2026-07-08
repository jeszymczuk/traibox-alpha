# TRAIBOX Execution Rails Strategy

Status: active architecture decision for alpha-to-beta completion.

TRAIBOX must remain provider-neutral. Payment providers, ledger networks, smart-contract platforms, escrow partners, and future TRAIBOX-owned rails are replaceable execution adapters behind TRAIBOX-owned workflow objects.

## Principle

TRAIBOX owns readiness, approvals, workflow state, audit, memory, evidence, and proof.

External providers execute regulated or infrastructure-specific actions through governed adapters. TRAIBOX must not couple core product logic to any single provider such as TrueLayer, iBanFirst, XDC, or a future in-house rail.

## Rail Categories

1. Core execution rails
   - Manual bank transfer fallback.
   - iBanFirst for cross-border B2B payments, FX, beneficiaries, currency accounts, and payment tracking.
   - TrueLayer for open-banking AIS/PIS and Pay by Bank where coverage fits.
   - Future bank, PSP, escrow, or TRAIBOX-owned rails.

2. Trust and proof rails
   - XDC as the first ledger anchoring target.
   - Future EVM-compatible networks, permissioned ledgers, notary services, or TRAIBOX-operated proof infrastructure.

3. Programmable trade rails
   - Smart-contract templates.
   - Contract deployment requests.
   - Escrow-style condition workflows.
   - Tokenized trade-finance instrument workflows.

## Product Boundary

TRAIBOX is the trade execution control layer. It creates and governs:

- `payment_intent`
- `payment_route`
- `funding_request`
- `trade_finance_instrument`
- `approval`
- `execution_task`
- `proof_bundle`
- `memory_event`

The selected provider executes the external action only after TRAIBOX policy, permissions, step-up, and approval gates pass.

## Licensing Boundary

Until TRAIBOX holds the required regulatory permissions, TRAIBOX must not hold client funds, pool funds, execute payments as principal, or present itself as the regulated payment provider.

The day-one market path is:

- create governed payment intents;
- select an execution rail;
- collect approval and evidence;
- hand off to a licensed provider or manual transfer process;
- track status and reconciliation evidence;
- generate proof and memory.

## XDC Boundary

XDC is the initial ledger/proof rail, not a permanent dependency and not a day-one payment rail.

Approved early uses:

- anchor proof bundle roots;
- prove document pack, approval, readiness, and funding evidence existed at a point in time;
- support trade-finance evidence verification;
- prepare for future tokenized invoice, receivable, bill of lading, or letter of credit workflows.

Deferred real-value uses:

- smart-contract escrow with customer funds;
- tokenized trade finance instruments involving real investors or settlement;
- custody, on/off-ramp, or fund-release automation.

Those require legal review, audited contracts, oracle controls, dispute handling, provider/regulatory model, and explicit protected-action approval.

## Smart Contract Boundary

AI may draft, explain, review, and orchestrate smart-contract workflows. AI must not deploy or execute contracts with external consequences without explicit human approval.

The intended lifecycle is:

1. Generate or select contract template.
2. Explain roles, obligations, conditions, evidence inputs, and risks.
3. Create a contract deployment request.
4. Require human approval and, for real-value contracts, legal/security review.
5. Deploy through a governed adapter.
6. Capture deployment, oracle updates, condition changes, release events, proof, replay, and memory.

## Implementation Rule

Core objects must refer to provider capability and selected adapter, not provider-specific product names.

Good:

- `payment_intent` with `selected_provider: "ibanfirst"` or `"truelayer"`.
- `proof_bundle` with `ledger_anchor.adapter: "evm_event"` and `network: "xdc"`.
- `contract_deployment_request` with `adapter: "evm_contract_deployer"`.

Avoid:

- “TrueLayer payment” as a canonical TRAIBOX object.
- “XDC proof” as the only proof model.
- Provider-specific workflow states in core lifecycle logic.

