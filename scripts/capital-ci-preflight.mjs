// Capital CI preflight (Phase 4.1 §1): the Capital database suites are gated
// on ALPHA_INTEGRATION_DATABASE_URL — when it is missing they self-skip.
// This preflight makes that skip IMPOSSIBLE in CI: test:capital:ci fails
// fast unless the database URL is configured, so a green run always means
// the suites actually executed.
const fail = (message) => {
  process.stderr.write(`capital-ci-preflight: ${message}\n`);
  process.exit(1);
};

const url = (process.env.ALPHA_INTEGRATION_DATABASE_URL ?? '').trim();
if (!url) fail('ALPHA_INTEGRATION_DATABASE_URL is not set — the Capital database suites would be skipped. Failing closed.');
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail('ALPHA_INTEGRATION_DATABASE_URL is not a valid URL.');
}
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  fail(`refusing a non-local integration database host '${parsed.hostname}'.`);
}
process.stdout.write(`capital-ci-preflight: OK (${parsed.hostname}${parsed.pathname})\n`);
