import type { ClientBase } from 'pg';
import { z } from 'zod';

/**
 * Company-side canonical context readers (Phase 4.1 §6).
 *
 * The AUTHENTICATED API — never the client and never the model — resolves
 * typed, principal-scoped canonical object references into normalized
 * snapshots under the org RLS context. Each snapshot carries auditable
 * identity (object type, source layer, object id, organization, principal),
 * retrieval + as-of times, freshness, and FIELD-LEVEL facts; the Trade Brain
 * turns those facts into VERIFIED evidence claims with typed canonical
 * source references. Every reader is strictly read-only: canonical Finance
 * state is never mutated here.
 *
 * Callers may still supply user-provided inputs where canonical data is
 * unavailable — those stay visibly unverified in the evidence model.
 */

export class ContextReadError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const authorizedObjectRefSchema = z
  .object({
    source_layer: z.enum(['relational', 'alpha_object']),
    domain: z.string().min(1),
    object_type: z.enum(['trade', 'company_profile', 'finance_offer', 'alpha_object']),
    object_id: z.string().uuid(),
    organization_id: z.string().uuid()
  })
  .strict();

export type AuthorizedObjectRef = z.infer<typeof authorizedObjectRefSchema>;

export interface CanonicalFieldFact {
  input_path: string;
  statement: string;
  /** Canonical field path (defaults to input_path). */
  field_path?: string | null;
  /** STRUCTURED authoritative value (provenance-binding closure §3) — the
   * comparison value for calculator-input bindings. The prose statement is
   * derived presentation and is never compared. */
  value?: string | null;
  value_type?: 'decimal' | 'integer' | 'boolean' | 'string' | 'date' | null;
  currency?: string | null;
  unit?: string | null;
  category?: string | null;
  as_of?: string | null;
}

export interface CanonicalSnapshot {
  object_type: string;
  source_layer: 'relational' | 'alpha_object' | 'external';
  object_id: string;
  organization_id: string;
  principal_id: string;
  retrieved_at: string;
  as_of?: string | null;
  freshness: 'current' | 'recent' | 'stale' | 'unknown';
  facts: CanonicalFieldFact[];
}

/** Categories these readers can attest, aligned with the outcome
 * definitions' required_evidence_categories vocabulary. Category mappings are
 * deliberately NARROW (provenance-binding closure §7): a general trade
 * amount attests trade context only — it never automatically satisfies
 * detailed cost evidence, a dated cash-flow basis, procurement cost, invoice
 * value, or receivables evidence. Categories tied to calculator consumption
 * become verified only through exact value bindings. */
const TRADE_CATEGORY = 'trade_context';
const OFFER_CATEGORY = 'offer_terms';

function freshnessFor(updatedAt: Date | null, retrievedAt: Date): CanonicalSnapshot['freshness'] {
  if (!updatedAt) return 'unknown';
  const ageDays = (retrievedAt.getTime() - updatedAt.getTime()) / 86_400_000;
  if (ageDays <= 7) return 'current';
  if (ageDays <= 45) return 'recent';
  return 'stale';
}

async function readTrade(client: ClientBase, ref: AuthorizedObjectRef, principalId: string): Promise<CanonicalSnapshot> {
  const row = await client.query(
    `SELECT trade_id, title, corridor, amount, currency, status, updated_at FROM trades WHERE trade_id = $1 AND org_id = $2`,
    [ref.object_id, ref.organization_id]
  );
  const trade = row.rows[0];
  if (!trade) throw new ContextReadError('context.trade_not_found', `trade ${ref.object_id} does not exist in this organization`, 404);
  const retrievedAt = new Date();
  return {
    object_type: 'trade',
    source_layer: 'relational',
    object_id: trade.trade_id,
    organization_id: ref.organization_id,
    principal_id: principalId,
    retrieved_at: retrievedAt.toISOString(),
    as_of: trade.updated_at?.toISOString() ?? null,
    freshness: freshnessFor(trade.updated_at ?? null, retrievedAt),
    facts: [
      {
        input_path: `trade.${trade.trade_id}.title`,
        field_path: 'title',
        statement: `Trade '${trade.title}' (${trade.corridor}) exists with status '${trade.status}'`,
        value: String(trade.title),
        value_type: 'string',
        category: TRADE_CATEGORY
      },
      {
        input_path: `trade.${trade.trade_id}.status`,
        field_path: 'status',
        statement: `Trade status is '${trade.status}'`,
        value: String(trade.status),
        value_type: 'string',
        category: TRADE_CATEGORY
      },
      {
        input_path: `trade.${trade.trade_id}.amount`,
        field_path: 'amount',
        statement: `Trade amount is ${trade.amount} ${trade.currency}`,
        value: String(trade.amount),
        value_type: 'decimal',
        currency: String(trade.currency),
        // Narrow by design: the headline trade amount is trade context. It
        // can VERIFY a revenue/settlement input only through an exact value
        // binding — never by category membership.
        category: TRADE_CATEGORY
      }
    ]
  };
}

async function readCompanyProfile(client: ClientBase, ref: AuthorizedObjectRef, principalId: string): Promise<CanonicalSnapshot> {
  const row = await client.query(`SELECT org_id, name, country, created_at FROM orgs WHERE org_id = $1`, [ref.object_id]);
  const org = row.rows[0];
  if (!org) throw new ContextReadError('context.org_not_found', `organization ${ref.object_id} does not exist`, 404);
  if (org.org_id !== ref.organization_id) {
    throw new ContextReadError('context.cross_org_ref', 'a company profile reference must target the authenticated organization', 403);
  }
  const retrievedAt = new Date();
  return {
    object_type: 'company_profile',
    source_layer: 'relational',
    object_id: org.org_id,
    organization_id: ref.organization_id,
    principal_id: principalId,
    retrieved_at: retrievedAt.toISOString(),
    as_of: org.created_at?.toISOString() ?? null,
    freshness: 'current',
    facts: [
      { input_path: `company.${org.org_id}.name`, field_path: 'name', statement: `Company '${org.name}' (${org.country}) is the verified organization of record`, value: String(org.name), value_type: 'string', category: TRADE_CATEGORY },
      { input_path: `company.${org.org_id}.country`, field_path: 'country', statement: `Company country of record is ${org.country}`, value: String(org.country), value_type: 'string', category: TRADE_CATEGORY }
    ]
  };
}

async function readFinanceOffer(client: ClientBase, ref: AuthorizedObjectRef, principalId: string): Promise<CanonicalSnapshot> {
  const row = await client.query(
    `SELECT offer_id, financier_name, apr_bps, fees, tenor_days, currency, expires_at, created_at
     FROM finance_offers WHERE offer_id = $1 AND org_id = $2`,
    [ref.object_id, ref.organization_id]
  );
  const offer = row.rows[0];
  if (!offer) throw new ContextReadError('context.offer_not_found', `finance offer ${ref.object_id} does not exist in this organization`, 404);
  const retrievedAt = new Date();
  const expired = offer.expires_at && new Date(offer.expires_at).getTime() < retrievedAt.getTime();
  return {
    object_type: 'finance_offer',
    source_layer: 'relational',
    object_id: offer.offer_id,
    organization_id: ref.organization_id,
    principal_id: principalId,
    retrieved_at: retrievedAt.toISOString(),
    as_of: offer.created_at?.toISOString() ?? null,
    freshness: expired ? 'stale' : freshnessFor(offer.created_at ?? null, retrievedAt),
    facts: [
      {
        input_path: `finance_offer.${offer.offer_id}.apr_bps`,
        field_path: 'apr_bps',
        statement: `Offer from ${offer.financier_name}: ${offer.apr_bps} bps APR${expired ? ' (EXPIRED)' : ''}`,
        value: String(offer.apr_bps),
        value_type: 'integer',
        category: OFFER_CATEGORY
      },
      {
        input_path: `finance_offer.${offer.offer_id}.fees`,
        field_path: 'fees',
        statement: `Offer fees are ${offer.fees} ${offer.currency}`,
        value: String(offer.fees),
        value_type: 'decimal',
        currency: String(offer.currency),
        category: OFFER_CATEGORY
      },
      {
        input_path: `finance_offer.${offer.offer_id}.tenor_days`,
        field_path: 'tenor_days',
        statement: `Offer tenor is ${offer.tenor_days} days`,
        value: String(offer.tenor_days),
        value_type: 'integer',
        category: OFFER_CATEGORY
      }
    ]
  };
}

async function readAlphaObject(client: ClientBase, ref: AuthorizedObjectRef, principalId: string): Promise<CanonicalSnapshot> {
  const row = await client.query(
    `SELECT object_id, type, status, title, summary, updated_at FROM alpha_objects WHERE object_id = $1 AND org_id = $2`,
    [ref.object_id, ref.organization_id]
  );
  const object = row.rows[0];
  if (!object) throw new ContextReadError('context.alpha_object_not_found', `alpha object ${ref.object_id} does not exist in this organization`, 404);
  const retrievedAt = new Date();
  return {
    object_type: object.type,
    source_layer: 'alpha_object',
    object_id: object.object_id,
    organization_id: ref.organization_id,
    principal_id: principalId,
    retrieved_at: retrievedAt.toISOString(),
    as_of: object.updated_at?.toISOString() ?? null,
    freshness: freshnessFor(object.updated_at ?? null, retrievedAt),
    facts: [
      {
        input_path: `alpha.${object.object_id}.status`,
        field_path: 'status',
        statement: `${object.type} '${object.title}' is in status '${object.status}'${object.summary ? ` — ${object.summary}` : ''}`,
        value: String(object.status),
        value_type: 'string',
        category: TRADE_CATEGORY
      }
    ]
  };
}

/**
 * Resolve authorized object references into canonical snapshots. Runs inside
 * the caller's authenticated RLS transaction; every reference must target the
 * authenticated organization (cross-org references fail closed).
 */
export async function resolveAuthorizedRefs(
  client: ClientBase,
  refs: Array<Record<string, unknown>>,
  context: { orgId: string; principalId: string }
): Promise<CanonicalSnapshot[]> {
  const snapshots: CanonicalSnapshot[] = [];
  for (const raw of refs) {
    const ref = authorizedObjectRefSchema.parse(raw);
    if (ref.organization_id !== context.orgId) {
      throw new ContextReadError('context.cross_org_ref', 'authorized object references must target the authenticated organization', 403);
    }
    if (ref.object_type === 'trade') snapshots.push(await readTrade(client, ref, context.principalId));
    else if (ref.object_type === 'company_profile') snapshots.push(await readCompanyProfile(client, ref, context.principalId));
    else if (ref.object_type === 'finance_offer') snapshots.push(await readFinanceOffer(client, ref, context.principalId));
    else snapshots.push(await readAlphaObject(client, ref, context.principalId));
  }
  return snapshots;
}
