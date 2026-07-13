import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type Keyring = ReadonlyArray<{ id: string; key: Buffer }>;

export function parseKeyring(value: string): Keyring {
  const keys = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0) throw new Error('BROWSER_SESSION_KEYS entries must use key-id:base64-key');
      const id = entry.slice(0, separator);
      const key = Buffer.from(entry.slice(separator + 1), 'base64');
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32) {
        throw new Error('BROWSER_SESSION_KEYS requires a safe key id and a 32-byte base64 key');
      }
      return { id, key };
    });
  if (keys.length === 0) throw new Error('BROWSER_SESSION_KEYS must contain at least one encryption key');
  if (new Set(keys.map((key) => key.id)).size !== keys.length) throw new Error('BROWSER_SESSION_KEYS key ids must be unique');
  return keys;
}

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function digestOpaqueToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function tokenMatchesDigest(value: string, expectedHex: string): boolean {
  const actual = Buffer.from(digestOpaqueToken(value), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function seal(value: string, keyring: Keyring, associatedData: string): string {
  const active = keyring[0]!;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', active.key, nonce);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', active.id, nonce.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

export function open(sealed: string, keyring: Keyring, associatedData: string): string {
  const [version, keyId, nonceValue, ciphertextValue, tagValue, extra] = sealed.split('.');
  if (version !== 'v1' || !keyId || !nonceValue || !ciphertextValue || !tagValue || extra) throw new Error('Malformed encrypted session material');
  const selected = keyring.find((key) => key.id === keyId);
  if (!selected) throw new Error('Unknown session encryption key');
  const nonce = Buffer.from(nonceValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('Malformed encrypted session material');
  const decipher = createDecipheriv('aes-256-gcm', selected.key, nonce);
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
