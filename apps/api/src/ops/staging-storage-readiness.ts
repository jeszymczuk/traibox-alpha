import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type CheckStatus = 'pass' | 'fail';

export const REQUIRED_STAGING_STORAGE_BUCKETS = ['documents', 'document-packs', 'evidence', 'reports', 'bundles', 'exports'] as const;

export interface StagingStorageReadinessReport {
  status: CheckStatus;
  generated_at: string;
  checks: Array<{ bucket: string; status: CheckStatus; exists: boolean; public: boolean | null; message: string }>;
  missing_buckets: string[];
  public_buckets: string[];
  endpoint_status: number | null;
  artifact_paths: { latest: string; timestamped: string };
}

export async function buildStagingStorageReadinessReport(input: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  artifactDir?: string;
}): Promise<StagingStorageReadinessReport> {
  const now = input.now ?? new Date();
  const artifactPaths = buildArtifactPaths(input.artifactDir ?? 'artifacts/staging-storage-readiness', now);
  const url = input.supabaseUrl?.trim().replace(/\/+$/, '');
  const key = input.serviceRoleKey?.trim();
  if (!url || !key) {
    const checks = REQUIRED_STAGING_STORAGE_BUCKETS.map((bucket) => ({
      bucket,
      status: 'fail' as const,
      exists: false,
      public: null,
      message: 'Supabase storage credentials are not configured for this readiness check.'
    }));
    return {
      status: 'fail',
      generated_at: now.toISOString(),
      checks,
      missing_buckets: [...REQUIRED_STAGING_STORAGE_BUCKETS],
      public_buckets: [],
      endpoint_status: null,
      artifact_paths: artifactPaths
    };
  }

  const response = await (input.fetchImpl ?? fetch)(`${url}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key }
  });
  if (!response.ok) {
    const checks = REQUIRED_STAGING_STORAGE_BUCKETS.map((bucket) => ({
      bucket,
      status: 'fail' as const,
      exists: false,
      public: null,
      message: `Supabase storage bucket listing failed with HTTP ${response.status}.`
    }));
    return {
      status: 'fail',
      generated_at: now.toISOString(),
      checks,
      missing_buckets: [...REQUIRED_STAGING_STORAGE_BUCKETS],
      public_buckets: [],
      endpoint_status: response.status,
      artifact_paths: artifactPaths
    };
  }

  const payload = (await response.json()) as Array<{ name?: string; public?: boolean }>;
  const buckets = new Map(payload.filter((item) => typeof item.name === 'string').map((item) => [item.name!, item]));
  const checks = REQUIRED_STAGING_STORAGE_BUCKETS.map((bucket) => {
    const configured = buckets.get(bucket);
    const exists = Boolean(configured);
    const isPublic = configured ? Boolean(configured.public) : null;
    const status: CheckStatus = exists && isPublic === false ? 'pass' : 'fail';
    return {
      bucket,
      status,
      exists,
      public: isPublic,
      message: !exists ? `${bucket} bucket is missing.` : isPublic ? `${bucket} bucket must be private.` : `${bucket} bucket exists and is private.`
    };
  });
  const missingBuckets = checks.filter((check) => !check.exists).map((check) => check.bucket);
  const publicBuckets = checks.filter((check) => check.public).map((check) => check.bucket);

  return {
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    generated_at: now.toISOString(),
    checks,
    missing_buckets: missingBuckets,
    public_buckets: publicBuckets,
    endpoint_status: response.status,
    artifact_paths: artifactPaths
  };
}

function buildArtifactPaths(artifactDir: string, now: Date) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    latest: path.join(artifactDir, 'latest.json'),
    timestamped: path.join(artifactDir, `${stamp}.json`)
  };
}

async function main() {
  const report = await buildStagingStorageReadinessReport({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  mkdirSync(path.dirname(report.artifact_paths.latest), { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(report.artifact_paths.latest, json);
  writeFileSync(report.artifact_paths.timestamped, json);
  process.stdout.write(json);
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
