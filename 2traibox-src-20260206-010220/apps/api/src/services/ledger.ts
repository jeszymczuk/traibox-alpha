import type pg from 'pg';
import JSZip from 'jszip';
import { ethers } from 'ethers';

import type { LedgerProofsResponse, SSEEvent } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';
import type { StorageClient } from './storage.js';
import { buildBundleZip, canonicalJsonBytes, sha256Hex } from '@traibox/proof';
import { getOrBuildSustainableFinanceReport } from './reports.js';

export async function getOrBuildBundle(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; tradeId: string }
): Promise<LedgerProofsResponse> {
  const existing = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT bundle_url, manifest_sha256, root, created_at FROM proof_bundles WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId
    ]);
    return res.rows[0] ?? null;
  });

  if (existing) {
    const anchor = await getAnchor(pool, { orgId: input.orgId, userId: input.userId, root: existing.root });
    return {
      bundle_url: existing.bundle_url,
      manifest_sha256: existing.manifest_sha256,
      root: existing.root,
      anchor,
      trace_id: input.traceId
    };
  }

  const artifacts = await gatherArtifacts(pool, storage, { orgId: input.orgId, userId: input.userId, tradeId: input.tradeId });
  const createdAt = new Date().toISOString();
  const out = await buildBundleZip({
    trade_id: input.tradeId,
    org_id: input.orgId,
    created_at: createdAt,
    artifacts,
    policy: { retention_days: 365, pii_on_chain: false },
    build: { service: 'ledger', version: '0.1.0', trace_id: input.traceId },
    signing: process.env.LEDGER_MANIFEST_SIGNING_PRIVATE_KEY
      ? { ed25519_private_key_pem: process.env.LEDGER_MANIFEST_SIGNING_PRIVATE_KEY }
      : undefined
  });

  const bundleKey = `bundles/${input.tradeId}.zip`;
  const bundleUrl = (await storage.putObject({ bucket: 'bundles', key: bundleKey, body: out.zipBytes, contentType: 'application/zip' })).url;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO proof_bundles(trade_id, org_id, manifest_sha256, root, bundle_url) VALUES($1,$2,$3,$4,$5)', [
      input.tradeId,
      input.orgId,
      out.manifestSha256,
      out.root,
      bundleUrl
    ]);

    for (const a of artifacts) {
      const hash = a.hashing === 'jcs-json' ? sha256Hex(canonicalJsonBytes(JSON.parse(a.data.toString('utf8')))) : sha256Hex(a.data);
      await client.query('INSERT INTO proof_artifacts(trade_id, org_id, path, mime, bytes, sha256) VALUES($1,$2,$3,$4,$5,$6)', [
        input.tradeId,
        input.orgId,
        a.path,
        a.mime,
        a.data.byteLength,
        hash
      ]);
    }

    if (input.profile.ledger.anchoring.enabled) {
      const batchId = `trade-${input.tradeId}`;
      await client.query(
        `INSERT INTO anchor_batches(batch_id, org_id, root, network, adapter_id, status)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (batch_id) DO NOTHING`,
        [batchId, input.orgId, out.root, input.profile.ledger.anchoring.network, 'evm_event', 'pending']
      );
    }
  });

  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type: 'ledger.bundle.ready',
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: input.tradeId,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: { trade_id: input.tradeId, bundle_url: bundleUrl, root: out.root, trace_id: input.traceId }
  };
  await insertEvent(pool, { orgId: input.orgId, userId: input.userId, ev });

  const anchor = await getAnchor(pool, { orgId: input.orgId, userId: input.userId, root: out.root });
  return { bundle_url: bundleUrl, manifest_sha256: out.manifestSha256, root: out.root, anchor, trace_id: input.traceId };
}

export async function listAnchors(pool: pg.Pool, input: { orgId: string; userId: string; since?: string }) {
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      'SELECT batch_id, root, network, tx_hash, block_number, status, created_at, anchored_at FROM anchor_batches WHERE created_at >= COALESCE($1::timestamptz, now() - interval \'7 days\') ORDER BY created_at DESC LIMIT 200',
      [input.since ?? null]
    );
    return res.rows;
  });
  return { anchors: rows };
}

export async function verifyAnchorTx(input: { txHash: string; rpcUrl: string; registryAddress?: string | undefined }): Promise<{ ok: boolean; root?: string }> {
  const provider = new ethers.JsonRpcProvider(input.rpcUrl);
  const receipt = await provider.getTransactionReceipt(input.txHash);
  if (!receipt) return { ok: false };
  const addr = (input.registryAddress ?? '').toLowerCase();

  const iface = new ethers.Interface(['event Anchored(bytes32 indexed root, bytes32 indexed memo, address indexed sender, uint256 blockNumber, uint256 ts)']);
  for (const log of receipt.logs) {
    if (addr && log.address.toLowerCase() !== addr) continue;
    try {
      const parsed = iface.parseLog(log);
      const rootHex = parsed?.args?.root as string | undefined;
      if (rootHex) return { ok: true, root: rootHex.startsWith('0x') ? rootHex.slice(2) : rootHex };
    } catch {
      // ignore
    }
  }
  return { ok: false };
}

export async function exportLedger(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; traceId: string; tradeIds: string[] }
): Promise<{ url: string; hash: string }> {
  const zip = new JSZip();
  const manifest: any = { schema: 'traibox.export/1.0', created_at: new Date().toISOString(), trades: [] as any[] };

  for (const tradeId of input.tradeIds) {
    const bundle = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: input.userId, orgId: input.orgId });
      const res = await client.query('SELECT bundle_url, root, manifest_sha256 FROM proof_bundles WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [tradeId]);
      return res.rows[0] ?? null;
    });
    if (!bundle) continue;
    const zipBytes = await storage.getObjectByUrl(bundle.bundle_url);
    zip.file(`bundles/${tradeId}.zip`, zipBytes);
    manifest.trades.push({ trade_id: tradeId, root: bundle.root, manifest_sha256: bundle.manifest_sha256, bundle_url: bundle.bundle_url });
  }

  zip.file('manifest.json', canonicalJsonBytes(manifest));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const hash = sha256Hex(bytes);
  const key = `exports/export_${Date.now()}.zip`;
  const url = (await storage.putObject({ bucket: 'exports', key, body: bytes, contentType: 'application/zip' })).url;
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO ledger_exports(org_id, requested_by, url, hash) VALUES($1,$2,$3,$4)', [input.orgId, input.userId, url, hash]);
  });
  return { url, hash };
}

async function gatherArtifacts(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; tradeId: string }
): Promise<Array<{ id: string; path: string; mime: string; data: Buffer; hashing: 'raw-bytes' | 'jcs-json' }>> {
  const res = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const compliance = await client.query('SELECT json_blob, pdf_url FROM compliance_reports WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [input.tradeId]);
    const offers = await client.query('SELECT financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, allocation_json, expires_at FROM finance_offers WHERE trade_id=$1', [input.tradeId]);
    const payment = await client.query('SELECT payment_id, scheme, status, iso_status, return_reason, redirect_url, trace_id FROM payments WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [input.tradeId]);
    const alloc = await client.query('SELECT policy_id, ranking_json, reasons_json, timestamp FROM allocation_decisions WHERE trade_id=$1 ORDER BY timestamp DESC LIMIT 1', [input.tradeId]);
    const stf = await client.query('SELECT path, grade, details_json, verification_level, dns_h_ms_passed, cbam_flag FROM stf_grades WHERE trade_id=$1', [input.tradeId]);
    return { compliance: compliance.rows[0] ?? null, offers: offers.rows, payment: payment.rows[0] ?? null, alloc: alloc.rows[0] ?? null, stf: stf.rows };
  });

  const artifacts: Array<{ id: string; path: string; mime: string; data: Buffer; hashing: 'raw-bytes' | 'jcs-json' }> = [];

  if (res.compliance?.json_blob) {
    artifacts.push({ id: 'compliance_report_json', path: 'artifacts/compliance_report.json', mime: 'application/json', data: Buffer.from(JSON.stringify(res.compliance.json_blob), 'utf8'), hashing: 'jcs-json' });
  }
  if (res.compliance?.pdf_url) {
    const pdf = await storage.getObjectByUrl(res.compliance.pdf_url);
    artifacts.push({ id: 'compliance_report_pdf', path: 'artifacts/compliance_report.pdf', mime: 'application/pdf', data: pdf, hashing: 'raw-bytes' });
  }

  artifacts.push({
    id: 'finance_offers',
    path: 'artifacts/finance_offers.json',
    mime: 'application/json',
    data: Buffer.from(JSON.stringify(res.offers), 'utf8'),
    hashing: 'jcs-json'
  });

  artifacts.push({
    id: 'stf_grades',
    path: 'artifacts/stf_grades.json',
    mime: 'application/json',
    data: Buffer.from(JSON.stringify(res.stf), 'utf8'),
    hashing: 'jcs-json'
  });

  // Always include the Sustainable Finance report (UoP) in the proof pack for audit readiness.
  const uop = await getOrBuildSustainableFinanceReport(pool, storage, { orgId: input.orgId, userId: input.userId, tradeId: input.tradeId, type: 'uop' });
  artifacts.push({
    id: `sf_uop_json`,
    path: 'artifacts/stf_uop_statement.json',
    mime: 'application/json',
    data: Buffer.from(JSON.stringify(uop.json), 'utf8'),
    hashing: 'jcs-json'
  });
  artifacts.push({
    id: `sf_uop_pdf`,
    path: 'artifacts/stf_uop_statement.pdf',
    mime: 'application/pdf',
    data: await storage.getObjectByUrl(uop.pdf_url),
    hashing: 'raw-bytes'
  });

  // Include SLTF annex if present in grades (optional v1).
  const hasSltf = Array.isArray(res.stf) && res.stf.some((r: any) => r.path === 'sltf');
  if (hasSltf) {
    const sltf = await getOrBuildSustainableFinanceReport(pool, storage, { orgId: input.orgId, userId: input.userId, tradeId: input.tradeId, type: 'sltf' });
    artifacts.push({
      id: `sf_sltf_json`,
      path: 'artifacts/sltf_annex.json',
      mime: 'application/json',
      data: Buffer.from(JSON.stringify(sltf.json), 'utf8'),
      hashing: 'jcs-json'
    });
    artifacts.push({
      id: `sf_sltf_pdf`,
      path: 'artifacts/sltf_annex.pdf',
      mime: 'application/pdf',
      data: await storage.getObjectByUrl(sltf.pdf_url),
      hashing: 'raw-bytes'
    });
  }

  if (res.payment) {
    artifacts.push({
      id: 'payment_receipt',
      path: 'artifacts/payment_receipt.json',
      mime: 'application/json',
      data: Buffer.from(JSON.stringify(res.payment), 'utf8'),
      hashing: 'jcs-json'
    });
  }
  if (res.alloc) {
    artifacts.push({
      id: 'allocation_explanations',
      path: 'artifacts/allocation_explanations.json',
      mime: 'application/json',
      data: Buffer.from(JSON.stringify(res.alloc), 'utf8'),
      hashing: 'jcs-json'
    });
  }

  return artifacts;
}

async function getAnchor(pool: pg.Pool, input: { orgId: string; userId: string; root: string }): Promise<any> {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT network, tx_hash, block_number, status, anchored_at FROM anchor_batches WHERE root=$1 ORDER BY created_at DESC LIMIT 1', [input.root]);
    return res.rows[0] ?? null;
  });
  if (!row) return { status: 'off' };
  return {
    status: row.status,
    network: row.network,
    tx_hash: row.tx_hash ?? undefined,
    block_number: row.block_number ?? undefined,
    anchored_at: row.anchored_at ?? undefined
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
