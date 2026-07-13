export function reconcileOrganizationSelection<T extends { org_id: string }>(organizations: readonly T[], current: string | null): string | null {
  return current && organizations.some((organization) => organization.org_id === current) ? current : organizations[0]?.org_id ?? null;
}
export function shouldClearTenantCache(previous: string | null, next: string | null): boolean {
  return previous !== next;
}
