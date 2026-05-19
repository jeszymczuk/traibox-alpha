import crypto from 'node:crypto';
import JSZip from 'jszip';

export type Hex = string;

export interface BundleArtifactInput {
  id: string;
  path: string;
  mime: string;
  bytes?: number;
  data: Buffer;
  hashing: 'raw-bytes' | 'jcs-json';
}

export interface BundleBuildInput {
  trade_id: string;
  org_id: string;
  created_at: string; // ISO
  artifacts: BundleArtifactInput[];
  policy: { retention_days: number; pii_on_chain: boolean };
  build: { service: string; version: string; trace_id: string };
  signing?: { ed25519_private_key_pem: string };
}

export interface BundleBuildOutput {
  zipBytes: Buffer;
  manifestSha256: Hex;
  root: Hex;
}

export interface VerifyOutput {
  valid: boolean;
  reasons: string[];
  root?: Hex;
  bundleSha256?: Hex;
}

export function sha256Hex(buf: Buffer | string): Hex {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(jcsStringify(value), 'utf8');
}

// RFC 8785 (JCS) compatible canonical JSON serializer.
// Notes:
// - Sorts object keys lexicographically (UTF-16 code unit order as in JS).
// - Matches JSON.stringify semantics for unsupported values:
//   - object properties with undefined/function/symbol are omitted
//   - array entries with undefined/function/symbol become null
//   - NaN/Infinity serialize as null
function jcsStringify(value: unknown): string {
  return serialize(value, false);
}

function serialize(value: unknown, inArray: boolean): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) return 'null';
    // JSON.stringify(-0) === "0"
    return Object.is(value, -0) ? '0' : Number(value).toString();
  }
  if (t === 'bigint') throw new TypeError('BigInt is not supported in JSON');
  if (t === 'undefined' || t === 'function' || t === 'symbol') return inArray ? 'null' : '';

  // objects
  const obj: any = value as any;
  if (obj && typeof obj.toJSON === 'function') {
    return serialize(obj.toJSON(), inArray);
  }

  if (Array.isArray(obj)) {
    const parts = obj.map((v) => serialize(v, true));
    return `[${parts.join(',')}]`;
  }

  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const k of keys) {
    const v = serialize(obj[k], false);
    if (v === '') continue; // omitted
    pairs.push(`${JSON.stringify(k)}:${v}`);
  }
  return `{${pairs.join(',')}}`;
}

function merkleRootSha256(leaves: Hex[]): Hex {
  if (leaves.length === 0) return sha256Hex(Buffer.from(''));
  let layer: Buffer[] = leaves.map((h) => Buffer.from(h, 'hex'));
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1] ?? left;
      next.push(crypto.createHash('sha256').update(Buffer.concat([left, right])).digest());
    }
    layer = next;
  }
  return layer[0]!.toString('hex');
}

export async function buildBundleZip(input: BundleBuildInput): Promise<BundleBuildOutput> {
  const artifacts = input.artifacts.map((a) => {
    const bytes = a.bytes ?? a.data.byteLength;
    const sha256 =
      a.hashing === 'jcs-json' ? sha256Hex(canonicalJsonBytes(JSON.parse(a.data.toString('utf8')))) : sha256Hex(a.data);
    return { id: a.id, path: a.path, mime: a.mime, bytes, sha256, _data: a.data, _hashing: a.hashing };
  });

  const manifest = {
    schema: 'traibox.bundle.manifest/1.0',
    trade_id: input.trade_id,
    org_id: input.org_id,
    created_at: input.created_at,
    artifacts: artifacts.map((a) => ({ id: a.id, path: a.path, mime: a.mime, bytes: a.bytes, sha256: a.sha256 })),
    hash_algo: 'sha256',
    canonicalization: { json: 'JCS-RFC8785', pdf: 'raw-bytes' },
    policy: input.policy,
    build: input.build
  };

  const leafRows = artifacts
    .map((a) => ({ artifact_id: a.id, sha256: a.sha256 }))
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
  const root = merkleRootSha256(leafRows.map((l) => l.sha256));

  const merkle = {
    schema: 'traibox.merkle/1.0',
    algo: 'sha256',
    leaf_order: 'lexicographic_sha256',
    leaves: leafRows,
    root,
    built_at: new Date().toISOString()
  };

  const anchor = {
    schema: 'traibox.anchor/1.0',
    root,
    status: 'pending',
    network: 'xdc',
    notes: 'Hashes only; no PII on chain'
  };

  const zip = new JSZip();
  const manifestBytes = canonicalJsonBytes(manifest);
  zip.file('manifest.json', manifestBytes);
  zip.file('merkle.json', canonicalJsonBytes(merkle));
  zip.file('anchor.json', canonicalJsonBytes(anchor));

  for (const a of artifacts) {
    zip.file(a.path, a._data);
  }

  if (input.signing?.ed25519_private_key_pem) {
    const sig = crypto.sign(null, manifestBytes, input.signing.ed25519_private_key_pem);
    zip.file('signatures/traibox.manifest.sig', sig);
  }

  const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const manifestSha256 = sha256Hex(manifestBytes);
  return { zipBytes, manifestSha256, root };
}

export async function verifyBundleZip(zipBytes: Buffer, opts?: { ed25519_public_key_pem?: string }): Promise<VerifyOutput> {
  const reasons: string[] = [];
  const bundleSha256 = sha256Hex(zipBytes);
  const zip = await JSZip.loadAsync(zipBytes);

  const manifestFile = zip.file('manifest.json');
  const merkleFile = zip.file('merkle.json');
  if (!manifestFile || !merkleFile) {
    return { valid: false, reasons: ['Missing manifest.json or merkle.json'], bundleSha256 };
  }

  const manifest = JSON.parse(await manifestFile.async('string')) as {
    artifacts: Array<{ id: string; path: string; sha256: string; mime: string }>;
  };
  const merkle = JSON.parse(await merkleFile.async('string')) as { root: string; leaves: Array<{ artifact_id?: string; sha256: string }> };

  const computedLeaves: Array<{ artifact_id: string; sha256: string }> = [];
  for (const art of manifest.artifacts) {
    const f = zip.file(art.path);
    if (!f) {
      reasons.push(`Missing artifact: ${art.path}`);
      continue;
    }
    const data = await f.async('nodebuffer');
    const isJson = art.mime === 'application/json' || art.path.endsWith('.json');
    const hash = isJson ? sha256Hex(canonicalJsonBytes(JSON.parse(data.toString('utf8')))) : sha256Hex(data);
    if (hash !== art.sha256) reasons.push(`Hash mismatch: ${art.path}`);
    computedLeaves.push({ artifact_id: art.id, sha256: hash });
  }

  const leaves = computedLeaves.sort((a, b) => a.sha256.localeCompare(b.sha256));
  const root = merkleRootSha256(leaves.map((l) => l.sha256));
  if (root !== merkle.root) reasons.push('Merkle root mismatch');

  if (Array.isArray(merkle.leaves) && merkle.leaves.length > 0) {
    const merkleHashes = merkle.leaves.map((l) => l.sha256).sort();
    const computedHashes = leaves.map((l) => l.sha256).sort();
    if (merkleHashes.join('|') !== computedHashes.join('|')) reasons.push('Merkle leaves mismatch');
  }

  if (opts?.ed25519_public_key_pem) {
    const sigFile = zip.file('signatures/traibox.manifest.sig');
    if (sigFile) {
      const sig = await sigFile.async('nodebuffer');
      const manifestBytes = canonicalJsonBytes(JSON.parse(await manifestFile.async('string')));
      const ok = crypto.verify(null, manifestBytes, opts.ed25519_public_key_pem, sig);
      if (!ok) reasons.push('Invalid manifest signature');
    }
  }

  const valid = reasons.length === 0;
  return { valid, reasons, root, bundleSha256 };
}
