import { describe, expect, it } from 'vitest';

import { ProfileSchema } from './schema.js';

describe('ProfileSchema', () => {
  it('defaults finance.demo_offers_enabled to true', () => {
    const p = ProfileSchema.parse({ profile_id: 'dev', region: 'eu-iberia' });
    expect(p.finance.demo_offers_enabled).toBe(true);
  });
});

