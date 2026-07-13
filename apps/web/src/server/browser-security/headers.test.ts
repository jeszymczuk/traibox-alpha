import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../../next.config.mjs', import.meta.url)), 'utf8');

describe('Next.js browser security headers', () => {
  it('sets the required CSP isolation directives without wildcard sources', () => {
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(source).toContain(directive);
    }
    expect(source).not.toMatch(/script-src[^\n]*\*/);
    expect(source).not.toMatch(/connect-src[^\n]*\*/);
    expect(source).toContain("production ? '' : \" 'unsafe-eval'\"");
  });

  it('sets nosniff, referrer, permissions, clickjacking, opener, and production HSTS controls', () => {
    for (const header of [
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
      'Cross-Origin-Opener-Policy',
      'Strict-Transport-Security'
    ]) {
      expect(source).toContain(header);
    }
  });
});
