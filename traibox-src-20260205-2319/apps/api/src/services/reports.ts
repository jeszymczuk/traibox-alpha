import type pg from 'pg';
import PDFDocument from 'pdfkit';
import type { StorageClient } from './storage.js';
import { setAppContext, withTx } from '@traibox/db';

export async function getOrBuildSustainableFinanceReport(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; tradeId: string; type: 'uop' | 'sltf' }
): Promise<{ json: any; pdf_url: string }> {
  const existing = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT json_blob, pdf_url FROM sf_reports WHERE trade_id=$1 AND type=$2 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId,
      input.type
    ]);
    return res.rows[0] ?? null;
  });
  if (existing?.json_blob && existing?.pdf_url) return { json: existing.json_blob, pdf_url: existing.pdf_url };

  const grade = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      'SELECT path, grade, details_json, verification_level, dns_h_ms_passed, cbam_flag FROM stf_grades WHERE trade_id=$1 AND path=$2 LIMIT 1',
      [input.tradeId, input.type]
    );
    return res.rows[0] ?? null;
  });

  const reportJson = {
    report_id: `sf-${input.type}-${input.tradeId}`,
    trade_id: input.tradeId,
    type: input.type,
    generated_at: new Date().toISOString(),
    grade: grade?.grade ?? 'insufficient',
    details: grade?.details_json ?? [],
    verification_level: grade?.verification_level ?? null,
    dns_h_ms_passed: grade?.dns_h_ms_passed ?? null,
    cbam_flag: grade?.cbam_flag ?? null
  };

  const pdf = await buildSfPdf(reportJson);
  const key = `sf/${input.tradeId}_${input.type}.pdf`;
  const pdfUrl = (await storage.putObject({ bucket: 'reports', key, body: pdf, contentType: 'application/pdf' })).url;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO sf_reports(trade_id, org_id, type, json_blob, pdf_url, hash) VALUES($1,$2,$3,$4,$5,$6)', [
      input.tradeId,
      input.orgId,
      input.type,
      JSON.stringify(reportJson),
      pdfUrl,
      null
    ]);
  });

  return { json: reportJson, pdf_url: pdfUrl };
}

async function buildSfPdf(reportJson: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (d) => chunks.push(Buffer.from(d)));

  doc.fontSize(18).text('TRAIBOX — Sustainable Finance Report', { align: 'left' });
  doc.moveDown();
  doc.fontSize(12).text(`Trade: ${reportJson.trade_id}`);
  doc.text(`Type: ${reportJson.type}`);
  doc.text(`Generated: ${reportJson.generated_at}`);
  doc.moveDown();
  doc.fontSize(14).text('Grade');
  doc.fontSize(12).text(`${reportJson.grade} (${reportJson.verification_level ?? 'unverified'})`);
  doc.moveDown();
  doc.fontSize(14).text('Details');
  for (const d of reportJson.details ?? []) {
    doc.fontSize(10).fillColor('#444').text(`- ${d}`);
  }
  doc.fillColor('black');
  doc.end();

  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

