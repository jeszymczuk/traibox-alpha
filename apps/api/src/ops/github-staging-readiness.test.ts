import { describe, expect, it } from 'vitest';
import {
  REQUIRED_STAGING_GITHUB_SECRETS,
  buildGitHubStagingReadinessReport
} from './github-staging-readiness.js';

describe('GitHub staging readiness', () => {
  it('fails without required staging GitHub secrets', () => {
    const report = buildGitHubStagingReadinessReport({
      repository: 'jeszymczuk/traibox-alpha',
      secretNames: [],
      now: new Date('2026-07-07T10:00:00.000Z')
    });

    expect(report.status).toBe('fail');
    expect(report.missing_secrets).toEqual(expect.arrayContaining(['STAGING_DATABASE_URL', 'STAGING_PARTNER_JWT_SECRET']));
    expect(JSON.stringify(report)).not.toContain('DATABASE_URL=');
  });

  it('passes when all required staging GitHub secrets are present', () => {
    const report = buildGitHubStagingReadinessReport({
      repository: 'jeszymczuk/traibox-alpha',
      secretNames: [...REQUIRED_STAGING_GITHUB_SECRETS],
      now: new Date('2026-07-07T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.missing_secrets).toEqual([]);
    expect(report.required_workflow_inputs).toEqual(
      expect.arrayContaining(['api_base_url', 'web_base_url', 'backup_restore_checked_at'])
    );
  });
});
