import type pg from 'pg';
import type { StorageClient } from './storage.js';
import { setAppContext, withTx } from '@traibox/db';

export async function uploadPassportDocument(
  pool: pg.Pool,
  storage: StorageClient,
  input: { orgId: string; userId: string; mime: string; bytes: Buffer; filename?: string; type?: string }
): Promise<{ doc_id: string; file_url: string }> {
  const docId = crypto.randomUUID();
  const safeName = (input.filename ?? 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  const key = `passport/${input.orgId}/${docId}_${safeName}`;
  const fileUrl = (await storage.putObject({ bucket: 'evidence', key, body: input.bytes, contentType: input.mime })).url;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO passport_documents(doc_id, org_id, uploaded_by, type, file_url, mime, bytes) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      docId,
      input.orgId,
      input.userId,
      input.type ?? null,
      fileUrl,
      input.mime,
      input.bytes.byteLength
    ]);
  });

  return { doc_id: docId, file_url: fileUrl };
}

export async function startKybVerification(
  pool: pg.Pool,
  input: { orgId: string; userId: string; vendor?: string }
): Promise<{ vendor: string; status: string; applicant_id?: string }> {
  const vendor = input.vendor ?? 'sumsub';
  const isConfigured = vendor === 'sumsub' ? Boolean(process.env.SUMSUB_APP_TOKEN && process.env.SUMSUB_SECRET_KEY) : false;
  // Fail closed. When no real KYB provider is configured we must NOT assert that
  // the org is verified — an unconfigured environment cannot vouch for identity.
  // Configured  -> 'pending'    (provider will drive it to verified/rejected)
  // Unconfigured -> 'unverified' (maps to a 'warn' KYB check downstream, never 'pass').
  // See compliance.ts: only status === 'verified' yields a passing KYB check.
  const status = isConfigured ? 'pending' : 'unverified';
  const applicantId = isConfigured ? `sumsub_${crypto.randomUUID()}` : `mock_${crypto.randomUUID()}`;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query(
      `INSERT INTO kyb_verifications(org_id, vendor, applicant_id, status, meta_json)
       VALUES($1,$2,$3,$4,$5)`,
      [input.orgId, vendor, applicantId, status, JSON.stringify({ configured: isConfigured })]
    );
  });

  return { vendor, status, applicant_id: applicantId };
}

export async function getKybStatus(pool: pg.Pool, input: { orgId: string; userId: string }) {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT vendor, applicant_id, status, meta_json, updated_at, created_at FROM kyb_verifications ORDER BY updated_at DESC LIMIT 1');
    return res.rows[0] ?? null;
  });
  return row;
}

