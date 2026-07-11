import type pg from 'pg';

import type { ComplianceRequest, ComplianceResponse, SSEEvent } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';

import type { StorageClient } from './storage.js';

export async function runCompliance(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; input: ComplianceRequest }
): Promise<ComplianceResponse> {
  const { orgId, userId, traceId, profile } = input;
  const tradeId = input.input.trade_id;

  const runningEv = makeEvent(orgId, tradeId, traceId, userId, 'compliance.running', { trade_id: tradeId, started_at: new Date().toISOString(), trace_id: traceId });
  await insertEvent(pool, { orgId, userId, ev: runningEv });

  const plan = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT items, parties, terms FROM trade_plans WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [tradeId]);
    return res.rows[0] ?? null;
  });
  if (!plan) throw new Error('trade plan not found');

  const items = (plan.items ?? []) as Array<{ name: string; hs_code?: string | null }>;
  const corridor = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT corridor FROM trades WHERE trade_id=$1 LIMIT 1', [tradeId]);
    return (res.rows[0]?.corridor as string | null) ?? 'PT-ES';
  });

  const checks: any[] = [];

  // KYB status (org-level)
  const kyb = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT vendor, status, updated_at FROM kyb_verifications WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 1', [orgId]);
    return res.rows[0] as { vendor: string; status: string; updated_at: string } | null;
  });
  if (!kyb) {
    checks.push({ type: 'KYB', status: 'warn', provider: 'mvp', reasons: ['No KYB verification found'], updated_at: new Date().toISOString() });
  } else {
    const s = String(kyb.status ?? '').toLowerCase();
    const status = s === 'verified' ? 'pass' : s === 'rejected' ? 'fail' : 'warn';
    const reasons = status === 'pass' ? ['KYB verified'] : status === 'fail' ? ['KYB rejected'] : ['KYB pending'];
    checks.push({ type: 'KYB', status, provider: kyb.vendor ?? 'vendor', provider_ref: null, reasons, updated_at: kyb.updated_at ?? new Date().toISOString() });
  }

  // Sanctions/PEP/Adverse Media (ComplyAdvantage)
  const caEnabled = profile.compliance.complyadvantage.enabled && Boolean(process.env.COMPLYADVANTAGE_API_KEY);
  const namedParties = ((plan.parties ?? []) as Array<{ role?: string; name?: string }>).filter((p) => typeof p.name === 'string' && p.name.trim().length > 0);
  if (!caEnabled) {
    checks.push({ type: 'SANCTIONS', status: 'warn', provider: 'mvp', provider_ref: null, reasons: ['Screening provider not configured'], updated_at: new Date().toISOString() });
  } else if (namedParties.length === 0) {
    checks.push({ type: 'SANCTIONS', status: 'warn', provider: 'complyadvantage', provider_ref: null, reasons: ['Party names missing; cannot screen'], updated_at: new Date().toISOString() });
  } else {
    const results = await Promise.allSettled(namedParties.slice(0, 2).map((p) => complyAdvantageSearch(p.name!)));
    const hits: Array<{ party: string; types: string[]; ref?: string; total_matches?: number }> = [];
    for (const r of results) {
      if (r.status === 'fulfilled') hits.push(r.value);
    }

    const allTypes = new Set(hits.flatMap((h) => h.types));
    const hasSanction = allTypes.has('sanction') || allTypes.has('sanctions');
    const hasPep = allTypes.has('pep');
    const hasAdverse = allTypes.has('adverse-media') || allTypes.has('adverse_media') || allTypes.has('adverse media');
    const anyMatches = hits.some((h) => (h.total_matches ?? 0) > 0);

    checks.push({
      type: 'SANCTIONS',
      status: hasSanction ? 'fail' : anyMatches ? 'warn' : 'pass',
      provider: 'complyadvantage',
      provider_ref: hits.map((h) => h.ref).filter(Boolean).join('|') || null,
      reasons: hits.length > 0 ? hits.map((h) => `${h.party}: ${h.types.join(', ') || 'no types'} (${h.total_matches ?? 0} matches)`) : ['No results'],
      updated_at: new Date().toISOString()
    });
    checks.push({
      type: 'PEP',
      status: hasPep ? 'warn' : 'pass',
      provider: 'complyadvantage',
      provider_ref: hits.map((h) => h.ref).filter(Boolean).join('|') || null,
      reasons: hasPep ? ['Potential PEP match'] : ['No PEP types detected'],
      updated_at: new Date().toISOString()
    });
    checks.push({
      type: 'ADVERSE_MEDIA',
      status: hasAdverse ? 'warn' : 'pass',
      provider: 'complyadvantage',
      provider_ref: hits.map((h) => h.ref).filter(Boolean).join('|') || null,
      reasons: hasAdverse ? ['Adverse media types detected'] : ['No adverse media types detected'],
      updated_at: new Date().toISOString()
    });
  }

  // Export controls heuristic
  const exportWarn = items.some((i) => (i.hs_code ?? '').toString().startsWith('8418'));
  checks.push({
    type: 'EXPORT',
    status: exportWarn ? 'warn' : 'pass',
    provider: 'rules',
    provider_ref: null,
    reasons: exportWarn ? ['HS 8418 family flagged; confirm end-use/end-user'] : ['No export flags in pilot rules'],
    updated_at: new Date().toISOString()
  });

  // CBAM heuristic (very rough for MVP)
  const cbamWarn = items.some((i) => {
    const hs = (i.hs_code ?? '').toString();
    return hs.startsWith('72') || hs.startsWith('73') || hs.startsWith('76');
  });
  checks.push({
    type: 'CBAM',
    status: cbamWarn ? 'warn' : 'pass',
    provider: 'rules',
    provider_ref: null,
    reasons: cbamWarn ? ['HS family may be in scope for CBAM reporting'] : ['No CBAM flags in pilot rules'],
    updated_at: new Date().toISOString()
  });

  const overall = checks.some((c: any) => c.status === 'fail') ? 'failed' : checks.some((c: any) => c.status === 'warn') ? 'warnings' : 'passed';
  const risk_level = overall === 'failed' ? 'high' : overall === 'warnings' ? 'medium' : 'low';

  const reportJson = {
    report_id: `cr-${tradeId}`,
    trade_id: tradeId,
    generated_at: new Date().toISOString(),
    policy_id: input.input.policy_id ?? 'pol-std-1',
    corridor,
    items,
    checks,
    overall,
    risk_level,
    next_actions: checks.some((c: any) => c.status === 'warn') ? ['Provide missing KYB/KYC', 'Confirm export details if flagged'] : [],
    signatures: { hash: '', version: '0.1.0' }
  };

  const pdf = await buildCompliancePdf(reportJson);
  const pdfKey = `compliance/${tradeId}.pdf`;
  const pdfUrl = (await storage.putObject({ bucket: 'reports', key: pdfKey, body: pdf, contentType: 'application/pdf' })).url;

  const saved = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    await client.query('DELETE FROM compliance_checks WHERE trade_id=$1', [tradeId]);
    for (const c of checks as any[]) {
      await client.query(
        'INSERT INTO compliance_checks(trade_id, org_id, type, status, score, reasons, provider, provider_ref, policy_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [tradeId, orgId, c.type, c.status, c.score ?? null, JSON.stringify(c.reasons ?? []), c.provider ?? null, c.provider_ref ?? null, reportJson.policy_id]
      );
    }
    const res = await client.query(
      'INSERT INTO compliance_reports(trade_id, org_id, overall, risk_level, json_blob, pdf_url, hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING report_id',
      [tradeId, orgId, overall, risk_level, JSON.stringify(reportJson), pdfUrl, null]
    );
    await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
      orgId,
      tradeId,
      `user:${userId}`,
      'compliance.run',
      JSON.stringify({ overall })
    ]);
    return res.rows[0] as { report_id: string };
  });

  const finalType = overall === 'failed' ? 'compliance.failed' : overall === 'warnings' ? 'compliance.warnings' : 'compliance.passed';
  const finalEv = makeEvent(orgId, tradeId, traceId, userId, finalType, { trade_id: tradeId, report_url: pdfUrl, trace_id: traceId });
  await insertEvent(pool, { orgId, userId, ev: finalEv });

  return {
    trade_id: tradeId,
    overall,
    risk_level,
    checks: checks as any,
    next_actions: reportJson.next_actions,
    report_url: pdfUrl,
    trace_id: traceId
  };
}

async function complyAdvantageSearch(searchTerm: string): Promise<{ party: string; types: string[]; ref?: string; total_matches?: number }> {
  const apiKey = process.env.COMPLYADVANTAGE_API_KEY!;
  const base = (process.env.COMPLYADVANTAGE_BASE_URL ?? 'https://api.complyadvantage.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/searches`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_term: searchTerm, fuzziness: 0.6, share_url: 0 })
  });
  if (!res.ok) throw new Error(`ComplyAdvantage error: ${res.status}`);
  const json = (await res.json()) as any;
  const data = json?.content?.data ?? json?.data ?? {};
  const hits = Array.isArray(data.hits) ? data.hits : [];
  const types = new Set<string>();
  for (const h of hits) {
    const t = h?.doc?.types;
    if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') types.add(x);
  }
  return { party: searchTerm, types: [...types], ref: data.ref, total_matches: typeof data.total_matches === 'number' ? data.total_matches : undefined };
}

async function buildCompliancePdf(reportJson: any): Promise<Buffer> {
  const PDFDocument = await loadPdfDocument();
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (d: Uint8Array) => chunks.push(Buffer.from(d)));

  doc.fontSize(18).text('TRAIBOX — Compliance Report', { align: 'left' });
  doc.moveDown();
  doc.fontSize(12).text(`Trade: ${reportJson.trade_id}`);
  doc.text(`Generated: ${reportJson.generated_at}`);
  doc.text(`Overall: ${reportJson.overall} (risk: ${reportJson.risk_level})`);
  doc.moveDown();
  doc.fontSize(14).text('Checks');
  doc.moveDown(0.5);
  for (const c of reportJson.checks ?? []) {
    doc.fontSize(12).text(`${c.type}: ${c.status}`);
    for (const r of c.reasons ?? []) doc.fontSize(10).fillColor('#444').text(`- ${r}`);
    doc.fillColor('black');
    doc.moveDown(0.25);
  }
  doc.end();

  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

async function loadPdfDocument(): Promise<any> {
  const modulePath = process.env.TRAIBOX_PDFKIT_MODULE ?? 'pdfkit';
  const imported = (await import(modulePath)) as any;
  const PDFDocument = imported.default?.default ?? imported.default;
  if (typeof PDFDocument !== 'function') throw new Error(`PDF runtime ${modulePath} does not export PDFDocument`);
  return PDFDocument;
}

function makeEvent(orgId: string, tradeId: string, traceId: string, userId: string, type: string, data: any): SSEEvent {
  return {
    event_id: crypto.randomUUID(),
    type,
    ts: new Date().toISOString(),
    org_id: orgId,
    trade_id: tradeId,
    trace_id: traceId,
    actor: `user:${userId}`,
    data
  };
}

async function insertEvent(pool: pg.Pool, input: { orgId: string; userId: string; ev: SSEEvent }): Promise<void> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      input.ev.event_id,
      input.ev.org_id,
      input.ev.trade_id ?? null,
      input.ev.type,
      input.ev.trace_id,
      input.ev.actor ?? null,
      JSON.stringify(input.ev.data ?? {})
    ]);
  });
}
