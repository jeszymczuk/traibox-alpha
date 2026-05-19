import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface StorageClient {
  putObject(input: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<{ url: string }>;
  getObject(input: { bucket: string; key: string }): Promise<Buffer>;
  getObjectByUrl(url: string): Promise<Buffer>;
}

export class LocalStorage implements StorageClient {
  private readonly rootDir: string;

  constructor(input: { rootDir: string }) {
    this.rootDir = input.rootDir;
  }

  async putObject(input: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<{ url: string }> {
    const fullPath = path.join(this.rootDir, input.bucket, input.key);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, input.body);
    return { url: `local://${input.bucket}/${input.key}` };
  }

  async getObject(input: { bucket: string; key: string }): Promise<Buffer> {
    const fullPath = path.join(this.rootDir, input.bucket, input.key);
    return readFileSync(fullPath);
  }

  async getObjectByUrl(url: string): Promise<Buffer> {
    if (!url.startsWith('local://')) throw new Error('Unsupported URL scheme');
    const rest = url.slice('local://'.length);
    const [bucket, ...keyParts] = rest.split('/');
    if (!bucket) throw new Error('Invalid storage URL');
    const key = keyParts.join('/');
    return this.getObject({ bucket, key });
  }
}

export class SupabaseStorage implements StorageClient {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(input: { supabaseUrl: string; serviceRoleKey: string }) {
    this.supabaseUrl = input.supabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = input.serviceRoleKey;
  }

  async putObject(input: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<{ url: string }> {
    const url = `${this.supabaseUrl}/storage/v1/object/${encodePath(input.bucket)}/${encodePath(input.key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': input.contentType
      },
      body: input.body.buffer.slice(input.body.byteOffset, input.body.byteOffset + input.body.byteLength) as BodyInit
    });
    if (!res.ok) throw new Error(`Supabase storage upload failed: ${res.status}`);
    return { url: `supabase://${input.bucket}/${input.key}` };
  }

  async getObject(input: { bucket: string; key: string }): Promise<Buffer> {
    const url = `${this.supabaseUrl}/storage/v1/object/${encodePath(input.bucket)}/${encodePath(input.key)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.serviceRoleKey}`, apikey: this.serviceRoleKey }
    });
    if (!res.ok) throw new Error(`Supabase storage download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  }

  async getObjectByUrl(url: string): Promise<Buffer> {
    if (!url.startsWith('supabase://')) throw new Error('Unsupported URL scheme');
    const rest = url.slice('supabase://'.length);
    const [bucket, ...keyParts] = rest.split('/');
    if (!bucket) throw new Error('Invalid storage URL');
    const key = keyParts.join('/');
    return this.getObject({ bucket, key });
  }
}

function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
