import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_STAGING_STORAGE_BUCKETS, buildStagingStorageReadinessReport } from './staging-storage-readiness.js';

describe('staging storage readiness', () => {
  it('passes when all required buckets exist and are private', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(REQUIRED_STAGING_STORAGE_BUCKETS.map((name) => ({ name, public: false }))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const report = await buildStagingStorageReadinessReport({
      supabaseUrl: 'https://project.supabase.co/',
      serviceRoleKey: 'service-role-key',
      fetchImpl,
      now: new Date('2026-07-11T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.missing_buckets).toEqual([]);
    expect(report.public_buckets).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith('https://project.supabase.co/storage/v1/bucket', expect.any(Object));
    expect(JSON.stringify(report)).not.toContain('service-role-key');
  });

  it('fails for missing or public buckets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: 'documents', public: true }, { name: 'reports', public: false }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const report = await buildStagingStorageReadinessReport({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key',
      fetchImpl
    });

    expect(report.status).toBe('fail');
    expect(report.public_buckets).toEqual(['documents']);
    expect(report.missing_buckets).toEqual(expect.arrayContaining(['document-packs', 'evidence', 'bundles', 'exports']));
  });

  it('fails safely when credentials are absent', async () => {
    const report = await buildStagingStorageReadinessReport({});

    expect(report.status).toBe('fail');
    expect(report.endpoint_status).toBeNull();
    expect(report.missing_buckets).toEqual([...REQUIRED_STAGING_STORAGE_BUCKETS]);
  });
});
