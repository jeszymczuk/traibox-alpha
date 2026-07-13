import type pg from 'pg';
import type {
  AcceptResponse,
  EvidenceSaved,
  FinanceOfferItem,
  FinanceReservationItem,
  FundingRequestItem,
  GradeResponse,
  OfferRequest,
  OfferResponse,
  SSEEvent
} from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';
import { sha256Hex } from '@traibox/proof';
import {
  ProtectedExecutionError,
  authorizeProtectedExecution,
  consumeProtectedExecutionApproval,
  hashCanonicalPayload,
  idempotencyFingerprint,
  loadFundingOfferSnapshot,
  type FundingOfferSnapshot
} from '../domains/approvals/protected-execution.js';
import {
  getIdempotentResponseInTransaction,
  lockIdempotencyTransaction,
  putIdempotentResponseInTransaction
} from './idempotency.js';

export async function requestOffers(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; input: OfferRequest }
): Promise<OfferResponse> {
  const { orgId, userId, traceId, profile } = input;
  const tradeId = input.input.trade_id;

  const grade = await computeAndStoreGrade(pool, { orgId, userId, traceId, profile, tradeId, sustainable: input.input.sustainable });

  const offerResult = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });

    // Reuse an existing recent offer request if present; otherwise avoid creating a new one if we already have fresh offers.
    const recentReq = await client.query(
      `SELECT request_id, status, created_at
       FROM offer_requests
       WHERE trade_id=$1 AND created_at > now() - interval '30 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [tradeId]
    );

    let requestId: string | null = (recentReq.rows[0]?.request_id as string | undefined) ?? null;
    let requestStatus: string | null = (recentReq.rows[0]?.status as string | undefined) ?? null;
    let createdNewRequest = false;
    let becameReady = false;

    if (!requestId) {
      const existingOffers = await client.query(
        `SELECT offer_id, request_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, allocation_json, expires_at
         FROM finance_offers
         WHERE trade_id=$1 AND created_at > now() - interval '10 minutes'
         ORDER BY created_at DESC`,
        [tradeId]
      );
      if (existingOffers.rows.length > 0) {
        return { requestId: existingOffers.rows[0]?.request_id ?? null, offers: existingOffers.rows, createdNewRequest, becameReady };
      }

      requestId = crypto.randomUUID();
      createdNewRequest = true;
      requestStatus = 'pending';
      await client.query(
        'INSERT INTO offer_requests(request_id, trade_id, org_id, amount, currency, tenor_days, sustainable, status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [requestId, tradeId, orgId, input.input.amount, 'EUR', input.input.tenor_days, JSON.stringify(input.input.sustainable ?? null), 'pending']
      );
    }

    const byRequest = requestId
      ? await client.query(
          `SELECT offer_id, request_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, allocation_json, expires_at
           FROM finance_offers
           WHERE request_id=$1
           ORDER BY created_at DESC`,
          [requestId]
        )
      : { rows: [] as any[] };

    if (byRequest.rows.length > 0) {
      if (requestStatus !== 'ready' && requestId) {
        await client.query('UPDATE offer_requests SET status=$1 WHERE request_id=$2', ['ready', requestId]);
        becameReady = true;
      }
      return { requestId, offers: byRequest.rows, createdNewRequest, becameReady };
    }

    if (!profile.finance.demo_offers_enabled) {
      // Partner mode: leave the request pending and let partners submit offers asynchronously.
      return { requestId, offers: [], createdNewRequest, becameReady };
    }

    // MVP fallback: generate two demo offers for pilots
    const tag = grade.grade === 'aligned' || grade.grade === 'eligible' ? 'green_uop' : 'none';
    const gradeLabel = grade.grade === 'aligned' ? 'aligned' : grade.grade === 'eligible' ? 'eligible' : 'not_sustainable';

    const alphaId = crypto.randomUUID();
    const betaId = crypto.randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const alpha = {
      offer_id: alphaId,
      request_id: requestId,
      trade_id: tradeId,
      org_id: orgId,
      financier_id: 'bank-alpha',
      financier_name: 'Bank Alpha',
      apr_bps: 450,
      fees: 25,
      tenor_days: input.input.tenor_days,
      currency: 'EUR',
      sustainability_tag: tag,
      sustainability_grade: gradeLabel,
      verification_level: grade.verification_level ?? null,
      sustainable_pricing_delta_bps: grade.grade === 'aligned' ? -10 : null,
      explanations: JSON.stringify(
        grade.grade === 'aligned'
          ? ['Eligible activity match', 'Evidence valid', 'DNSH/MS passed']
          : grade.grade === 'eligible'
            ? ['Eligible activity match', 'Evidence valid']
            : ['No sustainability evidence']
      ),
      expires_at: expires
    };

    const beta = {
      offer_id: betaId,
      request_id: requestId,
      trade_id: tradeId,
      org_id: orgId,
      financier_id: 'bank-beta',
      financier_name: 'Bank Beta',
      apr_bps: 480,
      fees: 0,
      tenor_days: input.input.tenor_days,
      currency: 'EUR',
      sustainability_tag: 'none',
      sustainability_grade: 'not_sustainable',
      verification_level: null,
      sustainable_pricing_delta_bps: null,
      explanations: JSON.stringify(['No UoP evidence']),
      expires_at: expires
    };

    await client.query(
      `INSERT INTO finance_offers(offer_id, request_id, trade_id, org_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        alpha.offer_id,
        alpha.request_id,
        alpha.trade_id,
        alpha.org_id,
        alpha.financier_id,
        alpha.financier_name,
        alpha.apr_bps,
        alpha.fees,
        alpha.tenor_days,
        alpha.currency,
        alpha.sustainability_tag,
        alpha.sustainability_grade,
        alpha.verification_level,
        alpha.sustainable_pricing_delta_bps,
        alpha.explanations,
        alpha.expires_at
      ]
    );
    await client.query(
      `INSERT INTO finance_offers(offer_id, request_id, trade_id, org_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        beta.offer_id,
        beta.request_id,
        beta.trade_id,
        beta.org_id,
        beta.financier_id,
        beta.financier_name,
        beta.apr_bps,
        beta.fees,
        beta.tenor_days,
        beta.currency,
        beta.sustainability_tag,
        beta.sustainability_grade,
        beta.verification_level,
        beta.sustainable_pricing_delta_bps,
        beta.explanations,
        beta.expires_at
      ]
    );

    const res = await client.query(
      `SELECT offer_id, request_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, allocation_json, expires_at
       FROM finance_offers WHERE request_id=$1 ORDER BY apr_bps ASC`,
      [requestId]
    );
    await client.query('UPDATE offer_requests SET status=$1 WHERE request_id=$2', ['ready', requestId]);
    becameReady = true;
    return { requestId, offers: res.rows, createdNewRequest, becameReady };
  });

  if (offerResult.createdNewRequest) {
    await emit(pool, { orgId, userId, traceId, tradeId, type: 'offers.requested', data: { trade_id: tradeId, trace_id: traceId } });
  }

  const offers = offerResult.offers ?? [];
  if (offers.length === 0) {
    return { trade_id: tradeId, offers: [], recommended_offer_id: null, trace_id: traceId, status: 'partial' };
  }

  const ranking = rankOffers(offers, profile.finance.prime_policy_id);
  const recommended = ranking[0]?.offer_id ?? null;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    for (const r of ranking) {
      await client.query('UPDATE finance_offers SET allocation_json=$1 WHERE offer_id=$2', [JSON.stringify({ score: r.score, policy_id: profile.finance.prime_policy_id, reasons: r.reasons }), r.offer_id]);
    }
    await client.query(
      'INSERT INTO allocation_decisions(trade_id, org_id, market, policy_id, inputs_hash, winner, ranking_json, reasons_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        tradeId,
        orgId,
        'finance',
        profile.finance.prime_policy_id,
        sha256Hex(JSON.stringify({ tradeId, offers })),
        ranking[0]?.financier_id ?? 'unknown',
        JSON.stringify(ranking),
        JSON.stringify(ranking[0]?.reasons ?? [])
      ]
    );
  });

  const resp: OfferResponse = {
    trade_id: tradeId,
    offers: offers.map((o: any) => ({
      offer_id: o.offer_id,
      financier: o.financier_name,
      apr_bps: o.apr_bps,
      fees: Number(o.fees ?? 0),
      tenor_days: o.tenor_days,
      currency: o.currency,
      sustainability_tag: o.sustainability_tag,
      sustainability_grade: o.sustainability_grade,
      verification_level: o.verification_level ?? undefined,
      sustainable_pricing_delta_bps: o.sustainable_pricing_delta_bps ?? undefined,
      explanations: Array.isArray(o.explanations) ? o.explanations : safeJsonArray(o.explanations),
      allocation: o.allocation_json ?? undefined,
      expires_at: o.expires_at ?? undefined
    })),
    recommended_offer_id: recommended,
    trace_id: traceId,
    status: 'offers_ready'
  };

  if (offerResult.becameReady) {
    await emit(pool, {
      orgId,
      userId,
      traceId,
      tradeId,
      type: 'offers.ready',
      data: { trade_id: tradeId, recommended_offer_id: recommended, count: resp.offers.length, trace_id: traceId }
    });
  }

  return resp;
}

export async function acceptOffer(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; offerId: string; approvalId: string; idempotencyKey: string }
): Promise<AcceptResponse> {
  const { orgId, userId, traceId, offerId } = input;
  const route = `POST /v1/finance/offers/${offerId}/accept`;
  let attemptedPayloadHash = hashCanonicalPayload({ offer_id: offerId });
  try {
    return await withTx(pool, async (client) => {
      await setAppContext(client, { userId, orgId });
      await assertFundingInitiatorRole(client, { orgId, userId });
      const snapshot = await loadFundingOfferSnapshot(client, { orgId, offerId, lock: true });
      attemptedPayloadHash = hashCanonicalPayload(snapshot);
      await lockFundingAcceptanceScope(client, snapshot);
      const requestHash = hashCanonicalPayload({
        approval_id: input.approvalId,
        action: 'accept_funding_offer',
        target: { type: 'funding_offer', id: offerId },
        payload: snapshot
      });
      await lockIdempotencyTransaction(client, { orgId, route, key: input.idempotencyKey });
      const idempotent = await getIdempotentResponseInTransaction(client, {
        orgId,
        route,
        key: input.idempotencyKey,
        requestHash
      });
      if (idempotent) return idempotent.response_json as AcceptResponse;

      const authorization = await authorizeProtectedExecution(client, {
        orgId,
        approvalId: input.approvalId,
        action: 'accept_funding_offer',
        target: { type: 'funding_offer', id: offerId },
        payload: snapshot
      });
      if (authorization.existingConsumption) {
        const original = await loadReservationResult(client, authorization.existingConsumption.result_id, traceId);
        await putIdempotentResponseInTransaction(client, {
          orgId,
          route,
          key: input.idempotencyKey,
          requestHash,
          statusCode: 200,
          responseJson: original
        });
        return original;
      }

      assertOfferFresh(snapshot);
      const conflicting = await findConflictingReservation(client, snapshot);
      if (conflicting) {
        throw fundingError(
          'protected_action_not_approved',
          conflicting.offer_id === offerId ? 'Funding offer already has an active reservation' : 'Funding request already has a conflicting active reservation',
          409,
          'conflicting_active_reservation'
        );
      }

      const now = Date.now();
      const offerExpiry = snapshot.terms.expires_at ? new Date(snapshot.terms.expires_at).getTime() : Number.POSITIVE_INFINITY;
      const expiresAt = new Date(Math.min(now + 30 * 60 * 1000, offerExpiry)).toISOString();
      const financierRef = `res_${offerId.slice(0, 8)}`;
      const reservation = await client.query<{ reservation_id: string; offer_id: string; expires_at: string; financier_ref: string | null }>(
        `INSERT INTO reservations(offer_id, trade_id, org_id, expires_at, financier_ref, status)
         VALUES($1,$2,$3,$4,$5,'active')
         RETURNING reservation_id, offer_id, expires_at, financier_ref`,
        [offerId, snapshot.trade_id, orgId, expiresAt, financierRef]
      );
      const row = reservation.rows[0]!;
      const acceptedAt = new Date().toISOString();
      const evidence = {
        approval_id: input.approvalId,
        action: 'accept_funding_offer',
        target: { type: 'funding_offer', id: offerId },
        payload_hash: authorization.payloadHash,
        actor_id: userId,
        org_id: orgId,
        idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey),
        result: { type: 'reservation', id: row.reservation_id },
        trace_id: traceId,
        classification: 'succeeded',
        at: acceptedAt
      };
      await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
        orgId,
        snapshot.trade_id,
        `user:${userId}`,
        'protected_execution.succeeded',
        JSON.stringify(evidence)
      ]);
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        crypto.randomUUID(),
        orgId,
        snapshot.trade_id,
        'offer.accepted',
        traceId,
        `user:${userId}`,
        JSON.stringify({
          trade_id: snapshot.trade_id,
          offer_id: offerId,
          reservation_id: row.reservation_id,
          approval_id: input.approvalId,
          payload_hash: authorization.payloadHash,
          expires_at: row.expires_at,
          trace_id: traceId
        })
      ]);
      await consumeProtectedExecutionApproval(client, authorization, {
        request_hash: requestHash,
        result_type: 'reservation',
        result_id: row.reservation_id,
        idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey),
        actor_id: userId,
        trace_id: traceId,
        consumed_at: acceptedAt
      });
      const response: AcceptResponse = {
        reservation: { offer_id: offerId, expires_at: row.expires_at, financier_ref: row.financier_ref ?? undefined },
        trace_id: traceId
      };
      await putIdempotentResponseInTransaction(client, {
        orgId,
        route,
        key: input.idempotencyKey,
        requestHash,
        statusCode: 200,
        responseJson: response
      });
      return response;
    });
  } catch (error) {
    await recordFundingExecutionFailure(pool, input, error, attemptedPayloadHash);
    throw error;
  }
}

async function assertFundingInitiatorRole(client: pg.PoolClient, input: { orgId: string; userId: string }): Promise<void> {
  const role = await client.query<{ role: string }>('SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2 LIMIT 1', [input.orgId, input.userId]);
  if (!role.rows[0] || !['owner', 'admin', 'finance'].includes(role.rows[0].role)) {
    throw fundingError('forbidden', 'Caller role cannot initiate funding-offer acceptance', 403, 'unauthorized_initiator');
  }
}

async function lockFundingAcceptanceScope(client: pg.PoolClient, snapshot: FundingOfferSnapshot): Promise<void> {
  const trade = await client.query('SELECT 1 FROM trades WHERE trade_id=$1 AND org_id=app.current_org() FOR UPDATE', [snapshot.trade_id]);
  if (!trade.rows[0]) throw fundingError('not_found', 'Linked trade not found', 404, 'trade_not_found');
  if (snapshot.request_id) {
    const request = await client.query('SELECT 1 FROM offer_requests WHERE request_id=$1 AND org_id=app.current_org() FOR UPDATE', [snapshot.request_id]);
    if (!request.rows[0]) throw fundingError('not_found', 'Linked funding request not found', 404, 'funding_request_not_found');
  }
}

function assertOfferFresh(snapshot: FundingOfferSnapshot): void {
  if (snapshot.terms.expires_at && new Date(snapshot.terms.expires_at).getTime() <= Date.now()) {
    throw fundingError('validation_error', 'Funding offer has expired', 400, 'offer_expired');
  }
  if (['cancelled', 'archived', 'completed', 'rejected'].includes(snapshot.trade_status.toLowerCase())) {
    throw fundingError('validation_error', 'Linked trade is not eligible for funding acceptance', 400, 'trade_not_eligible');
  }
  if (snapshot.request.status && ['cancelled', 'expired', 'rejected'].includes(snapshot.request.status.toLowerCase())) {
    throw fundingError('validation_error', 'Linked funding request is not eligible for acceptance', 400, 'funding_request_not_eligible');
  }
}

async function findConflictingReservation(
  client: pg.PoolClient,
  snapshot: FundingOfferSnapshot
): Promise<{ reservation_id: string; offer_id: string } | null> {
  const result = await client.query<{ reservation_id: string; offer_id: string }>(
    `SELECT reservation_id, offer_id
       FROM reservations
      WHERE org_id=app.current_org() AND status='active' AND trade_id=$1
      ORDER BY created_at ASC
      LIMIT 1`,
    [snapshot.trade_id]
  );
  return result.rows[0] ?? null;
}

async function loadReservationResult(client: pg.PoolClient, reservationId: string, traceId: string): Promise<AcceptResponse> {
  const result = await client.query<{ offer_id: string; expires_at: string; financier_ref: string | null }>(
    `SELECT offer_id, expires_at, financier_ref
       FROM reservations
      WHERE reservation_id=$1 AND org_id=app.current_org()
      LIMIT 1`,
    [reservationId]
  );
  const row = result.rows[0];
  if (!row) throw fundingError('unsafe_action_blocked', 'Consumed approval reservation result is missing', 403, 'consumption_result_missing');
  return {
    reservation: { offer_id: row.offer_id, expires_at: row.expires_at, financier_ref: row.financier_ref ?? undefined },
    trace_id: traceId
  };
}

async function recordFundingExecutionFailure(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; offerId: string; approvalId: string; idempotencyKey: string },
  error: unknown,
  payloadHash: string
): Promise<void> {
  const codedError = error as { code?: unknown };
  const code = typeof codedError?.code === 'string' ? codedError.code : 'internal_error';
  const classification = error instanceof ProtectedExecutionError ? error.classification : code;
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
      input.orgId,
      null,
      `user:${input.userId}`,
      'protected_execution.denied',
      JSON.stringify({
        approval_id: input.approvalId,
        action: 'accept_funding_offer',
        target: { type: 'funding_offer', id: input.offerId },
        payload_hash: payloadHash,
        payload_hash_scope: 'attempted_canonical_execution',
        actor_id: input.userId,
        org_id: input.orgId,
        idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey),
        trace_id: input.traceId,
        classification,
        error_code: code,
        at: new Date().toISOString()
      })
    ]);
  }).catch(() => undefined);
}

function fundingError(code: string, message: string, statusCode: number, classification = code): ProtectedExecutionError {
  return new ProtectedExecutionError(code, message, statusCode, classification);
}

export async function listFunding(
  pool: pg.Pool,
  input: { orgId: string; userId: string; limit?: number }
): Promise<{ requests: FundingRequestItem[]; reservations: FinanceReservationItem[] }> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });

    const requestRows = await client.query(
      `SELECT r.request_id, r.trade_id, t.title AS trade_title, r.amount, r.currency, r.tenor_days, r.sustainable, r.status, r.created_at
       FROM offer_requests r
       LEFT JOIN trades t ON t.trade_id = r.trade_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [limit]
    );

    const requestIds = requestRows.rows.map((r: any) => r.request_id);
    const offerRows = requestIds.length
      ? await client.query(
          `SELECT offer_id, request_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency,
                  sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, expires_at, created_at
           FROM finance_offers
           WHERE request_id = ANY($1)
           ORDER BY apr_bps ASC`,
          [requestIds]
        )
      : { rows: [] as any[] };

    const offersByRequest = new Map<string, FinanceOfferItem[]>();
    for (const raw of offerRows.rows) {
      const offer = { ...raw, fees: Number(raw.fees) } as FinanceOfferItem;
      const list = offersByRequest.get(raw.request_id) ?? [];
      list.push(offer);
      offersByRequest.set(raw.request_id, list);
    }

    const requests = requestRows.rows.map(
      (r: any) => ({ ...r, amount: Number(r.amount), offers: offersByRequest.get(r.request_id) ?? [] }) as FundingRequestItem
    );

    const reservationRows = await client.query(
      `SELECT res.reservation_id, res.offer_id, res.trade_id, t.title AS trade_title, res.financier_ref, res.expires_at, res.status, res.created_at,
              o.financier_name, o.apr_bps, o.fees, o.tenor_days, o.currency, req.amount
       FROM reservations res
       JOIN finance_offers o ON o.offer_id = res.offer_id
       LEFT JOIN offer_requests req ON req.request_id = o.request_id
       LEFT JOIN trades t ON t.trade_id = res.trade_id
       ORDER BY res.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const reservations = reservationRows.rows.map(
      (r: any) => ({ ...r, fees: Number(r.fees), amount: r.amount === null ? null : Number(r.amount) }) as FinanceReservationItem
    );

    return { requests, reservations };
  });
}

export async function upsertEvidence(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; input: any }
): Promise<EvidenceSaved> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.input.trade_id as string;
  const evidenceId = input.input.evidence_id ?? crypto.randomUUID();

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    await client.query(
      `INSERT INTO stf_evidence(evidence_id, trade_id, org_id, type, scheme_code, issuer, valid_from, valid_to, verification_level, file_url, links_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (evidence_id) DO UPDATE SET type=excluded.type, scheme_code=excluded.scheme_code, issuer=excluded.issuer, valid_from=excluded.valid_from, valid_to=excluded.valid_to, verification_level=excluded.verification_level, file_url=excluded.file_url, links_json=excluded.links_json`,
      [
        evidenceId,
        tradeId,
        orgId,
        input.input.type,
        input.input.scheme_code ?? null,
        input.input.issuer ?? null,
        input.input.valid_from ?? null,
        input.input.valid_to ?? null,
        input.input.verification_level ?? null,
        input.input.file_url ?? null,
        JSON.stringify(input.input.links ?? null)
      ]
    );
  });

  await emit(pool, { orgId, userId, traceId, tradeId, type: 'evidence.uploaded', data: { trade_id: tradeId, evidence_id: evidenceId, trace_id: traceId } });
  return { evidence_id: evidenceId, trace_id: traceId };
}

export async function deleteEvidence(pool: pg.Pool, input: { orgId: string; userId: string; evidenceId: string }): Promise<void> {
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('DELETE FROM stf_evidence WHERE evidence_id=$1', [input.evidenceId]);
  });
}

export async function gradeEvidence(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; input: any }
): Promise<GradeResponse> {
  const tradeId = input.input.trade_id as string;
  return computeAndStoreGrade(pool, {
    orgId: input.orgId,
    userId: input.userId,
    traceId: input.traceId,
    profile: input.profile,
    tradeId,
    sustainable: { path: input.input.path, minimum_grade: input.input.minimum_grade, evidence_ids: input.input.evidence_ids }
  });
}

async function computeAndStoreGrade(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; tradeId: string; sustainable?: any }
): Promise<GradeResponse> {
  const { orgId, userId, traceId, profile, tradeId } = input;
  const path = (input.sustainable?.path as 'uop' | 'sltf' | undefined) ?? profile.finance.stf.default_path;

  const evidence = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT evidence_id, valid_to, verification_level FROM stf_evidence WHERE trade_id=$1', [tradeId]);
    return res.rows;
  });

  const now = new Date();
  const validEvidence = evidence.filter((e: any) => !e.valid_to || new Date(e.valid_to) >= now);

  let grade: 'aligned' | 'eligible' | 'insufficient' = 'insufficient';
  let verification_level: any = undefined;
  const details: string[] = [];
  if (validEvidence.length > 0) {
    verification_level = validEvidence.some((e: any) => e.verification_level === 'registry') ? 'registry' : validEvidence.some((e: any) => e.verification_level === 'third_party') ? 'third_party' : 'self';
    grade = verification_level === 'third_party' || verification_level === 'registry' ? 'aligned' : 'eligible';
    details.push('Evidence valid');
    if (grade === 'aligned') details.push('Verification level high');
  } else {
    details.push('No valid evidence');
  }

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    await client.query(
      `INSERT INTO stf_grades(trade_id, org_id, path, grade, details_json, verification_level, dns_h_ms_passed, cbam_flag)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (trade_id, path) DO UPDATE SET grade=excluded.grade, details_json=excluded.details_json, verification_level=excluded.verification_level, dns_h_ms_passed=excluded.dns_h_ms_passed, cbam_flag=excluded.cbam_flag, created_at=now()`,
      [tradeId, orgId, path, grade, JSON.stringify(details), verification_level ?? null, grade === 'aligned', false]
    );
  });

  await emit(pool, { orgId, userId, traceId, tradeId, type: 'evidence.validated', data: { trade_id: tradeId, grade, verification_level, trace_id: traceId } });

  return { trade_id: tradeId, path, grade, details, verification_level, dns_h_ms_passed: grade === 'aligned', cbam_flag: false, glass_box: ['MVP grading rules'] };
}

function rankOffers(offers: any[], policyId: string): Array<{ offer_id: string; financier_id: string; score: number; reasons: string[] }> {
  if (offers.length === 0) return [];
  const prices = offers.map((o) => Number(o.apr_bps));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const norm = (p: number) => (max === min ? 1 : (max - p) / (max - min));
  return offers
    .map((o) => {
      const score = 0.8 * norm(Number(o.apr_bps)) + 0.2 * (o.sustainability_grade === 'aligned' ? 1 : o.sustainability_grade === 'eligible' ? 0.7 : 0.2);
      const reasons = ['Lower APR'];
      if (o.sustainability_grade === 'aligned') reasons.push('STF aligned');
      if (o.sustainability_grade === 'eligible') reasons.push('STF eligible');
      return { offer_id: o.offer_id, financier_id: o.financier_id, score: Number(score.toFixed(3)), reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function safeJsonArray(v: any): string[] {
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function emit(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; tradeId: string; type: string; data: any }
): Promise<void> {
  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type: input.type,
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: input.tradeId,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: input.data
  };
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ev.event_id,
      ev.org_id,
      ev.trade_id,
      ev.type,
      ev.trace_id,
      ev.actor,
      JSON.stringify(ev.data)
    ]);
  });
}
