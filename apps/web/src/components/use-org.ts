'use client';

import { useTenantContext } from './providers';

export function useOrgSelection() {
  return useTenantContext();
}
