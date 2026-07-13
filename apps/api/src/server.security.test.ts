import { describe, expect, it } from 'vitest';

import { configuredApiCorsOrigins } from './server';

describe('Fastify browser boundary CORS', () => {
  it('denies controlled-profile browser CORS by default', () => {
    expect(configuredApiCorsOrigins({ controlled: true, authMode: 'supabase' })).toEqual([]);
  });

  it('uses only exact configured origins and deduplicates them', () => {
    expect(
      configuredApiCorsOrigins({
        configured: 'https://app.example,https://admin.example,https://app.example',
        controlled: true,
        authMode: 'supabase'
      })
    ).toEqual(['https://app.example', 'https://admin.example']);
  });

  it('permits only the explicit localhost origin for non-controlled dev fallback', () => {
    expect(configuredApiCorsOrigins({ controlled: false, authMode: 'dev' })).toEqual(['http://localhost:3000']);
  });

  it('rejects wildcard and path-bearing CORS configuration', () => {
    expect(() => configuredApiCorsOrigins({ configured: '*', controlled: true, authMode: 'supabase' })).toThrow();
    expect(() => configuredApiCorsOrigins({ configured: 'https://app.example/path', controlled: true, authMode: 'supabase' })).toThrow();
  });
});
