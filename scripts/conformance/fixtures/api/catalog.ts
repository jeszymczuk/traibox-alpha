export const TRAIBOX_API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/v1/method-mismatch',
    operation_id: 'methodMismatch',
    workspace: 'platform',
    auth: 'org_user',
    roles: ['owner'],
    tags: ['Fixture'],
    stability: 'alpha'
  },
  {
    method: 'POST',
    path: '/v1/role-mismatch',
    operation_id: 'roleMismatch',
    workspace: 'platform',
    auth: 'org_user',
    roles: ['owner'],
    tags: ['Fixture'],
    stability: 'alpha'
  },
  {
    method: 'POST',
    path: '/v1/protected',
    operation_id: 'protectedWithoutAnnotation',
    workspace: 'platform',
    auth: 'org_user',
    roles: ['owner'],
    tags: ['Fixture'],
    stability: 'alpha'
  }
] as const;
