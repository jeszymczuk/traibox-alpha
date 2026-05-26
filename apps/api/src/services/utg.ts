import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import type {
  UTGEdge,
  UTGNode,
  UTGPartnerFeaturesRequest,
  UTGPartnerFeaturesResponse,
  UTGProjectionSummary,
  UTGRecallRequest,
  UTGRecallResponse
} from '@traibox/contracts';

type GraphRow = Record<string, any>;

type GraphBuilder = {
  addNode: (node: UTGNode) => void;
  addEdge: (edge: UTGEdge) => void;
  nodes: () => UTGNode[];
  edges: () => UTGEdge[];
};

export async function utgRecall(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: UTGRecallRequest }
): Promise<UTGRecallResponse> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.body.trade_id;
  const include = buildIncludeFilter(input.body.include);

  const source = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const trade = await client.query(
      'SELECT trade_id, title, corridor, amount, currency, status, created_at, updated_at FROM trades WHERE trade_id=$1 AND org_id=$2 LIMIT 1',
      [tradeId, orgId]
    );
    const tradeRow = trade.rows[0] ?? null;
    if (!tradeRow) return null;

    const plan = await client.query(
      'SELECT items, parties, terms, confidence, glass_box, created_at FROM trade_plans WHERE trade_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 1',
      [tradeId, orgId]
    );

    const tradeObjects = await client.query(
      `SELECT object_id, type, status, origin_workspace, owner_id, trade_id, title, summary, payload_json,
              permissions_json, evidence_refs_json, audit_refs_json, trace_id, created_at, updated_at
       FROM alpha_objects
       WHERE trade_id=$1 AND org_id=$2
       ORDER BY created_at ASC`,
      [tradeId, orgId]
    );

    const links = await client.query(
      `SELECT l.link_id, l.source_object_id, l.target_type, l.target_id, l.mode, l.payload_json,
              l.trace_id, l.created_by, l.created_at,
              src.type AS source_type, src.trade_id AS source_trade_id, src.title AS source_title
       FROM alpha_object_links l
       JOIN alpha_objects src ON src.object_id=l.source_object_id AND src.org_id=l.org_id
       WHERE l.org_id=$2
         AND (src.trade_id=$1
          OR (l.target_type = ANY($3::text[]) AND l.target_id=$1))
       ORDER BY l.created_at ASC`,
      [tradeId, orgId, ['trade', 'trade_room']]
    );

    const tradeObjectIds = tradeObjects.rows.map((row) => String(row.object_id));
    const linkedSourceIds = links.rows.map((row) => String(row.source_object_id)).filter((id) => !tradeObjectIds.includes(id));
    const linkedObjects = linkedSourceIds.length
      ? await client.query(
          `SELECT object_id, type, status, origin_workspace, owner_id, trade_id, title, summary, payload_json,
                  permissions_json, evidence_refs_json, audit_refs_json, trace_id, created_at, updated_at
           FROM alpha_objects
           WHERE object_id=ANY($1::uuid[]) AND org_id=$2
           ORDER BY created_at ASC`,
          [linkedSourceIds, orgId]
        )
      : { rows: [] as GraphRow[] };

    const alphaObjects = dedupeRows([...tradeObjects.rows, ...linkedObjects.rows], 'object_id');
    const objectIds = alphaObjects.map((row) => String(row.object_id));

    const readiness = await client.query(
      `SELECT readiness_id, object_id, trade_id, overall, score, dimensions_json,
              missing_items_json, risk_findings_json, next_actions_json, trace_id, created_at
       FROM alpha_readiness_states
       WHERE org_id=$3 AND (trade_id=$1 OR object_id=ANY($2::uuid[]))
       ORDER BY created_at DESC
       LIMIT 100`,
      [tradeId, objectIds, orgId]
    );

    const memory = await client.query(
      `SELECT memory_event_id, level, trade_id, object_id, kind, signal, payload_json, trace_id, created_at
       FROM alpha_memory_events
       WHERE org_id=$3 AND (trade_id=$1 OR object_id=ANY($2::uuid[]))
       ORDER BY created_at DESC
       LIMIT 200`,
      [tradeId, objectIds, orgId]
    );

    const alphaProofs = await client.query(
      `SELECT bundle_id, trade_id, object_id, root, manifest_sha256, artifact_refs_json, status, trace_id, created_by, created_at
       FROM alpha_proof_bundles
       WHERE org_id=$3 AND (trade_id=$1 OR object_id=ANY($2::uuid[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [tradeId, objectIds, orgId]
    );

    const events = await client.query(
      `SELECT event_id, trade_id, type, ts, trace_id, actor, data
       FROM trade_events
       WHERE trade_id=$1 AND org_id=$2
       ORDER BY ts DESC
       LIMIT 200`,
      [tradeId, orgId]
    );

    const audits = await client.query(
      `SELECT event_id, trade_id, actor, action, payload_json, hash, created_at
       FROM audit_events
       WHERE org_id=$3
         AND (trade_id=$1
          OR payload_json->>'trade_id'=$1::text
          OR payload_json->>'object_id'=ANY($2::text[])
          OR payload_json->>'document_id'=ANY($2::text[])
          OR payload_json->>'extraction_result_id'=ANY($2::text[])
          OR payload_json->>'approval_id'=ANY($2::text[])
          OR payload_json->>'proof_bundle_id'=ANY($2::text[])
          OR payload_json->>'document_pack_id'=ANY($2::text[]))
       ORDER BY created_at DESC
       LIMIT 150`,
      [tradeId, objectIds, orgId]
    );

    const offers = await client.query(
      'SELECT offer_id, financier_id, financier_name, apr_bps, sustainability_grade, sustainability_tag, allocation_json, created_at FROM finance_offers WHERE trade_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 25',
      [tradeId, orgId]
    );
    const payments = await client.query(
      'SELECT payment_id, scheme, status, created_at FROM payments WHERE trade_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 25',
      [tradeId, orgId]
    );

    return {
      trade: tradeRow,
      plan: plan.rows[0] ?? null,
      alphaObjects,
      links: links.rows,
      readiness: readiness.rows,
      memory: memory.rows,
      alphaProofs: alphaProofs.rows,
      events: events.rows,
      audits: audits.rows,
      offers: offers.rows,
      payments: payments.rows
    };
  });

  if (!source) {
    const error: any = new Error('Trade not found');
    error.statusCode = 404;
    error.code = 'not_found';
    throw error;
  }

  const graph = createGraphBuilder();
  const tradeNodeId = `trade:${String(source.trade.trade_id)}`;
  graph.addNode({
    id: tradeNodeId,
    label: 'Trade',
    props: compactProps({
      trade_id: source.trade.trade_id,
      title: source.trade.title,
      corridor: source.trade.corridor,
      status: source.trade.status,
      amount: source.trade.amount,
      currency: source.trade.currency,
      created_at: source.trade.created_at,
      updated_at: source.trade.updated_at
    })
  });

  if (include('plan')) {
    addPlanGraph(graph, tradeNodeId, source.trade, source.plan);
  }
  if (include('alpha_objects')) {
    addAlphaObjectGraph(graph, tradeNodeId, source.alphaObjects);
  }
  if (include('attachments')) {
    addAttachmentGraph(graph, tradeNodeId, source.links);
  }
  if (include('readiness')) {
    addReadinessGraph(graph, tradeNodeId, source.readiness);
  }
  if (include('proof')) {
    addProofGraph(graph, tradeNodeId, source.alphaProofs);
  }
  if (include('memory')) {
    addMemoryGraph(graph, tradeNodeId, source.memory);
  }
  if (include('events')) {
    addEventGraph(graph, tradeNodeId, source.events);
  }
  if (include('audit')) {
    addAuditGraph(graph, tradeNodeId, source.audits);
  }
  if (include('finance')) {
    addFinanceGraph(graph, tradeNodeId, source.offers);
  }
  if (include('payments')) {
    addPaymentGraph(graph, tradeNodeId, source.payments);
  }

  const limit = typeof input.body.limit_nodes === 'number' && input.body.limit_nodes > 0 ? input.body.limit_nodes : 240;
  const nodes = graph.nodes().slice(0, limit);
  const allowed = new Set(nodes.map((node) => node.id));
  const edges = graph.edges().filter((edge) => allowed.has(edge.from) && allowed.has(edge.to));
  const latestSourceAt = latestTimestamp([
    source.trade.updated_at,
    source.trade.created_at,
    source.plan?.created_at,
    ...source.alphaObjects.flatMap((row) => [row.updated_at, row.created_at]),
    ...source.links.map((row) => row.created_at),
    ...source.readiness.map((row) => row.created_at),
    ...source.memory.map((row) => row.created_at),
    ...source.alphaProofs.map((row) => row.created_at),
    ...source.events.map((row) => row.ts),
    ...source.audits.map((row) => row.created_at)
  ]);
  const generatedAt = new Date();
  const projection: UTGProjectionSummary = {
    adapter: 'postgres_alpha_projection',
    phase: 'utg_phase_1',
    generated_at: generatedAt.toISOString(),
    trade_id: tradeId,
    source_counts: {
      trades: 1,
      plan_items: toArray(source.plan?.items).length,
      plan_parties: toArray(source.plan?.parties).length,
      alpha_objects: source.alphaObjects.length,
      attachments: source.links.length,
      readiness_states: source.readiness.length,
      memory_events: source.memory.length,
      proof_bundles: source.alphaProofs.length,
      trade_events: source.events.length,
      audit_events: source.audits.length,
      finance_offers: source.offers.length,
      payments: source.payments.length
    },
    coverage: {
      node_count: nodes.length,
      edge_count: edges.length,
      alpha_object_nodes: nodes.filter((node) => node.label === 'AlphaObject').length,
      evidence_edges: edges.filter((edge) => edge.type === 'EVIDENCES' || edge.type === 'CONTAINS_EVIDENCE').length,
      attachment_edges: edges.filter((edge) => edge.type === 'ATTACHED_TO' || edge.type === 'LINKED_TO' || edge.type === 'CONVERTED_TO').length,
      risk_nodes: nodes.filter((node) => node.label === 'RiskFinding').length,
      missing_proof_nodes: nodes.filter((node) => node.label === 'MissingProof').length
    },
    latest_source_at: latestSourceAt,
    freshness_lag_ms: latestSourceAt ? Math.max(0, generatedAt.getTime() - new Date(latestSourceAt).getTime()) : null
  };

  return { nodes, edges, projection, trace_id: traceId };
}

export async function utgPartnerFeatures(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: UTGPartnerFeaturesRequest }
): Promise<UTGPartnerFeaturesResponse> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.body.trade_id;

  const { corridor, partnersById } = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const trade = await client.query('SELECT corridor FROM trades WHERE trade_id=$1 AND org_id=$2 LIMIT 1', [tradeId, orgId]);
    if (!trade.rows[0]) {
      const error: any = new Error('Trade not found');
      error.statusCode = 404;
      error.code = 'not_found';
      throw error;
    }
    const corridor = (trade.rows[0]?.corridor as string | null | undefined) ?? null;

    const partnerIds = input.body.partner_ids.filter(Boolean);
    const uuidPartnerIds = partnerIds.filter(isUuidLike);
    const partners = uuidPartnerIds.length
      ? await client.query(
          'SELECT partner_id, display_name, domains, corridors, rails, stf_ready FROM partners WHERE partner_id = ANY($1::uuid[])',
          [uuidPartnerIds]
        )
      : { rows: [] as any[] };
    const byId = new Map<string, any>();
    for (const p of partners.rows) byId.set(String(p.partner_id), p);
    return { corridor, partnersById: byId };
  });

  const features = input.body.partner_ids.map((pid) => {
    const p = partnersById.get(pid) ?? null;
    const corridors: string[] = Array.isArray(p?.corridors) ? p.corridors : [];
    const rails: string[] = Array.isArray(p?.rails) ? p.rails : [];
    const domains: string[] = Array.isArray(p?.domains) ? p.domains : [];

    const fit = corridor && corridors.includes(corridor) ? 1 : corridor ? 0.4 : 0.5;
    const capability =
      input.body.domain === 'payments'
        ? rails.length > 0
          ? 0.9
          : 0.4
        : domains.includes(String(input.body.domain))
          ? 0.9
          : 0.5;
    const performance = 0.6;
    const trust = 0.8;
    const esg = p?.stf_ready ? 0.9 : 0.4;
    const net_proximity = 0.0;

    const reasons: string[] = [];
    if (corridor && corridors.includes(corridor)) reasons.push(`Corridor ${corridor}`);
    if (p?.stf_ready) reasons.push('STF-ready');
    if (input.body.domain === 'payments' && rails.includes('SEPA_INSTANT')) reasons.push('SEPA Instant');
    if (input.body.domain && domains.includes(String(input.body.domain))) reasons.push(`Supports ${input.body.domain}`);
    if (!p) reasons.push('Unknown partner (stub features)');

    return { partner_id: pid, fit, capability, performance, trust, esg, net_proximity, reasons };
  });

  return { features, trace_id: traceId };
}

function addPlanGraph(graph: GraphBuilder, tradeNodeId: string, trade: GraphRow, plan: GraphRow | null) {
  if (trade.corridor) {
    const corridorId = `corridor:${String(trade.corridor)}`;
    graph.addNode({ id: corridorId, label: 'Corridor', props: { code: trade.corridor } });
    graph.addEdge({ from: tradeNodeId, to: corridorId, type: 'HAS_CORRIDOR', props: { code: trade.corridor } });
  }

  const items = toArray(plan?.items);
  items.forEach((item, idx) => {
    const record = asRecord(item);
    const id = `subject:${idx}:${slug(String(record?.hs_code ?? record?.name ?? 'unknown'))}`;
    graph.addNode({
      id,
      label: 'SubjectOfTrade',
      props: compactProps({
        name: record?.name,
        hs_code: record?.hs_code,
        nace_code: record?.nace_code,
        qty: record?.qty,
        unit: record?.unit
      })
    });
    graph.addEdge({ from: tradeNodeId, to: id, type: 'INVOLVES_SUBJECT', props: { idx } });
  });

  const parties = toArray(plan?.parties);
  parties.forEach((party, idx) => {
    const record = asRecord(party);
    const stable = slug(String(record?.lei ?? record?.name ?? record?.country ?? idx));
    const id = `counterparty:${String(record?.role ?? 'other')}:${stable}`;
    graph.addNode({
      id,
      label: 'Counterparty',
      props: compactProps({
        role: record?.role,
        name: record?.name,
        country: record?.country,
        lei: record?.lei
      })
    });
    graph.addEdge({ from: id, to: tradeNodeId, type: 'PARTICIPATES_AS', props: { role: record?.role } });
  });

  if (plan?.terms) {
    const termsId = `${tradeNodeId}:terms`;
    graph.addNode({ id: termsId, label: 'TradeTerms', props: asRecord(plan.terms) ?? {} });
    graph.addEdge({ from: tradeNodeId, to: termsId, type: 'HAS_TERMS' });
  }
}

function addAlphaObjectGraph(graph: GraphBuilder, tradeNodeId: string, objects: GraphRow[]) {
  for (const object of objects) {
    const objectId = objectNodeId(object.object_id);
    graph.addNode({
      id: objectId,
      label: 'AlphaObject',
      props: compactProps({
        object_id: object.object_id,
        object_type: object.type,
        status: object.status,
        origin_workspace: object.origin_workspace,
        title: object.title,
        summary: object.summary,
        trace_id: object.trace_id,
        created_at: object.created_at,
        updated_at: object.updated_at
      })
    });
    graph.addEdge({
      from: tradeNodeId,
      to: objectId,
      type: 'HAS_OBJECT',
      props: { object_type: object.type, status: object.status, origin_workspace: object.origin_workspace }
    });
    addObjectPayloadGraph(graph, objectId, object);
    for (const ref of toArray(object.evidence_refs_json)) {
      const record = asRecord(ref);
      const refId = coerceUuid(record?.object_id);
      if (!refId) continue;
      graph.addEdge({
        from: objectId,
        to: objectNodeId(refId),
        type: 'EVIDENCES',
        props: compactProps({ role: record?.role, source: 'evidence_refs_json' })
      });
    }
  }
}

function addObjectPayloadGraph(graph: GraphBuilder, objectId: string, object: GraphRow) {
  const payload = asRecord(object.payload_json) ?? {};
  if (object.type === 'document' || object.type === 'document_pack') {
    const hash = String(payload.sha256 ?? payload.manifest_sha256 ?? '');
    if (hash) {
      const evidenceId = `evidence:${hash.slice(0, 16)}`;
      graph.addNode({
        id: evidenceId,
        label: 'EvidenceArtifact',
        props: compactProps({
          sha256: payload.sha256 ?? payload.manifest_sha256,
          file_url: payload.file_url,
          mime_type: payload.mime_type,
          byte_size: payload.byte_size
        })
      });
      graph.addEdge({ from: objectId, to: evidenceId, type: 'STORES_EVIDENCE' });
    }
  }
  if (object.type === 'extraction_result') {
    for (const field of Object.keys(asRecord(payload.extracted_fields) ?? {})) {
      const fieldId = `${objectId}:field:${slug(field)}`;
      graph.addNode({ id: fieldId, label: 'ExtractedField', props: { field } });
      graph.addEdge({ from: objectId, to: fieldId, type: 'EXTRACTED_FIELD' });
    }
  }
  for (const refId of extractUuidValues(payload)) {
    graph.addEdge({ from: objectId, to: objectNodeId(refId), type: 'REFERENCES_OBJECT', props: { source: 'payload_json' } });
  }
}

function addAttachmentGraph(graph: GraphBuilder, tradeNodeId: string, links: GraphRow[]) {
  for (const link of links) {
    const sourceId = objectNodeId(link.source_object_id);
    const targetId = link.target_type === 'trade' || link.target_type === 'trade_room' ? tradeNodeId : objectNodeId(link.target_id);
    const mode = String(link.mode ?? 'attach');
    graph.addEdge({
      from: sourceId,
      to: targetId,
      type: mode === 'link' ? 'LINKED_TO' : mode === 'convert' ? 'CONVERTED_TO' : 'ATTACHED_TO',
      props: compactProps({
        link_id: link.link_id,
        mode,
        target_type: link.target_type,
        trace_id: link.trace_id,
        created_at: link.created_at
      })
    });
  }
}

function addReadinessGraph(graph: GraphBuilder, tradeNodeId: string, readiness: GraphRow[]) {
  for (const state of readiness) {
    const readinessId = `readiness:${String(state.readiness_id)}`;
    graph.addNode({
      id: readinessId,
      label: 'ReadinessState',
      props: compactProps({
        readiness_id: state.readiness_id,
        overall: state.overall,
        score: Number(state.score),
        trace_id: state.trace_id,
        created_at: state.created_at
      })
    });
    graph.addEdge({ from: tradeNodeId, to: readinessId, type: 'HAS_READINESS', props: { overall: state.overall, score: Number(state.score) } });
    if (state.object_id) graph.addEdge({ from: readinessId, to: objectNodeId(state.object_id), type: 'EVALUATES_OBJECT' });

    for (const item of toStringArray(state.missing_items_json)) {
      const missingId = `missing:${slug(item)}`;
      graph.addNode({ id: missingId, label: 'MissingProof', props: { item } });
      graph.addEdge({ from: readinessId, to: missingId, type: 'MISSING_PROOF' });
    }
    for (const finding of toStringArray(state.risk_findings_json)) {
      const riskId = `risk:${slug(finding)}`;
      graph.addNode({ id: riskId, label: 'RiskFinding', props: { finding } });
      graph.addEdge({ from: readinessId, to: riskId, type: 'HAS_RISK' });
    }
  }
}

function addProofGraph(graph: GraphBuilder, tradeNodeId: string, proofs: GraphRow[]) {
  for (const proof of proofs) {
    const proofId = `proof:${String(proof.bundle_id)}`;
    graph.addNode({
      id: proofId,
      label: 'ProofBundle',
      props: compactProps({
        bundle_id: proof.bundle_id,
        object_id: proof.object_id,
        root: proof.root,
        manifest_sha256: proof.manifest_sha256,
        status: proof.status,
        trace_id: proof.trace_id,
        created_at: proof.created_at
      })
    });
    graph.addEdge({ from: tradeNodeId, to: proofId, type: 'HAS_PROOF_BUNDLE', props: { status: proof.status } });
    if (proof.object_id) graph.addEdge({ from: objectNodeId(proof.object_id), to: proofId, type: 'MATERIALIZES_PROOF' });
    for (const ref of toArray(proof.artifact_refs_json)) {
      const record = asRecord(ref);
      const refId = coerceUuid(record?.object_id);
      if (!refId) continue;
      graph.addEdge({ from: proofId, to: objectNodeId(refId), type: 'CONTAINS_EVIDENCE', props: compactProps({ role: record?.role }) });
    }
  }
}

function addMemoryGraph(graph: GraphBuilder, tradeNodeId: string, memory: GraphRow[]) {
  for (const event of memory) {
    const memoryId = `memory:${String(event.memory_event_id)}`;
    graph.addNode({
      id: memoryId,
      label: 'MemoryEvent',
      props: compactProps({
        memory_event_id: event.memory_event_id,
        level: event.level,
        kind: event.kind,
        signal: event.signal,
        trace_id: event.trace_id,
        created_at: event.created_at
      })
    });
    graph.addEdge({ from: tradeNodeId, to: memoryId, type: 'HAS_MEMORY', props: { level: event.level, signal: event.signal } });
    if (event.object_id) graph.addEdge({ from: memoryId, to: objectNodeId(event.object_id), type: 'REMEMBERS_OBJECT' });
  }
}

function addEventGraph(graph: GraphBuilder, tradeNodeId: string, events: GraphRow[]) {
  for (const event of events) {
    const eventId = `event:${String(event.event_id)}`;
    graph.addNode({
      id: eventId,
      label: 'TradeEvent',
      props: compactProps({
        event_id: event.event_id,
        event_type: event.type,
        trace_id: event.trace_id,
        actor: event.actor,
        ts: event.ts
      })
    });
    graph.addEdge({ from: tradeNodeId, to: eventId, type: 'EMITTED_EVENT', props: { event_type: event.type } });
    for (const refId of extractUuidValues(event.data)) {
      graph.addEdge({ from: eventId, to: objectNodeId(refId), type: 'EVENT_REFERENCES_OBJECT' });
    }
  }
}

function addAuditGraph(graph: GraphBuilder, tradeNodeId: string, audits: GraphRow[]) {
  for (const audit of audits) {
    const auditId = `audit:${String(audit.event_id)}`;
    graph.addNode({
      id: auditId,
      label: 'AuditEvent',
      props: compactProps({
        audit_event_id: audit.event_id,
        action: audit.action,
        actor: audit.actor,
        hash: audit.hash,
        created_at: audit.created_at
      })
    });
    graph.addEdge({ from: tradeNodeId, to: auditId, type: 'HAS_AUDIT_EVENT', props: { action: audit.action } });
    for (const refId of extractUuidValues(audit.payload_json)) {
      graph.addEdge({ from: auditId, to: objectNodeId(refId), type: 'AUDIT_REFERENCES_OBJECT' });
    }
  }
}

function addFinanceGraph(graph: GraphBuilder, tradeNodeId: string, offers: GraphRow[]) {
  for (const offer of offers) {
    const providerId = `provider:finance:${slug(String(offer.financier_id ?? offer.financier_name ?? 'unknown'))}`;
    graph.addNode({
      id: providerId,
      label: 'Provider',
      props: compactProps({
        partner_id: offer.financier_id,
        domain: 'finance',
        name: offer.financier_name,
        sustainability_grade: offer.sustainability_grade
      })
    });
    graph.addEdge({
      from: tradeNodeId,
      to: providerId,
      type: 'MATCHED_PROVIDER',
      props: compactProps({ offer_id: offer.offer_id, apr_bps: offer.apr_bps, reasons: asRecord(offer.allocation_json)?.reasons })
    });
  }
}

function addPaymentGraph(graph: GraphBuilder, tradeNodeId: string, payments: GraphRow[]) {
  for (const payment of payments) {
    const paymentId = `payment:${String(payment.payment_id)}`;
    graph.addNode({
      id: paymentId,
      label: 'Payment',
      props: compactProps({
        payment_id: payment.payment_id,
        scheme: payment.scheme,
        status: payment.status,
        created_at: payment.created_at
      })
    });
    graph.addEdge({ from: tradeNodeId, to: paymentId, type: 'HAS_PAYMENT', props: { scheme: payment.scheme, status: payment.status } });
  }
}

function createGraphBuilder(): GraphBuilder {
  const nodes = new Map<string, UTGNode>();
  const edges = new Map<string, UTGEdge>();
  return {
    addNode(node) {
      const existing = nodes.get(node.id);
      nodes.set(node.id, existing ? { ...existing, props: compactProps({ ...(existing.props ?? {}), ...(node.props ?? {}) }) } : node);
    },
    addEdge(edge) {
      edges.set(`${edge.from}|${edge.type}|${edge.to}|${JSON.stringify(edge.props ?? {})}`, edge);
    },
    nodes() {
      return Array.from(nodes.values());
    },
    edges() {
      return Array.from(edges.values());
    }
  };
}

function buildIncludeFilter(include?: string[]) {
  const requested = new Set((include ?? []).map((item) => item.toLowerCase()));
  return (section: string) => requested.size === 0 || requested.has('all') || requested.has(section);
}

function objectNodeId(id: unknown) {
  return `object:${String(id)}`;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value: unknown): string[] {
  return toArray(value).map((item) => String(item)).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function compactProps(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function dedupeRows(rows: GraphRow[], key: string): GraphRow[] {
  const byId = new Map<string, GraphRow>();
  for (const row of rows) byId.set(String(row[key]), row);
  return Array.from(byId.values());
}

function extractUuidValues(value: unknown, out = new Set<string>(), depth = 0): string[] {
  if (depth > 6 || value == null) return Array.from(out);
  if (typeof value === 'string') {
    if (isUuidLike(value)) out.add(value);
    return Array.from(out);
  }
  if (Array.isArray(value)) {
    for (const item of value) extractUuidValues(item, out, depth + 1);
    return Array.from(out);
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) extractUuidValues(item, out, depth + 1);
  }
  return Array.from(out);
}

function coerceUuid(value: unknown): string | null {
  return typeof value === 'string' && isUuidLike(value) ? value : null;
}

function latestTimestamp(values: unknown[]): string | null {
  const dates = values
    .map((value) => (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null))
    .filter((value): value is Date => value !== null && Number.isFinite(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0]?.toISOString() ?? null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
