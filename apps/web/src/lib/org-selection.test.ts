import { describe, expect, it } from 'vitest';

import { reconcileOrganizationSelection, shouldClearTenantCache } from './org-selection';

describe('tenant-safe organization preference', () => {
  it('rejects a stale or cross-tenant selection against the API membership list', () => {
    const organizations = [{ org_id: 'allowed-a' }, { org_id: 'allowed-b' }];
    expect(reconcileOrganizationSelection(organizations, 'other-tenant')).toBe('allowed-a');
    expect(reconcileOrganizationSelection(organizations, 'allowed-b')).toBe('allowed-b');
  });

  it('clears tenant state across every identity-boundary transition', () => {
    expect(shouldClearTenantCache('org-a', 'org-b')).toBe(true);
    expect(shouldClearTenantCache('org-a', null)).toBe(true);
    expect(shouldClearTenantCache(null, 'org-a')).toBe(true);
    expect(shouldClearTenantCache('org-a', 'org-a')).toBe(false);
    expect(shouldClearTenantCache(null, null)).toBe(false);
  });
});
