import { loadProfileFromFile, validateRuntimeEnvironment, type RuntimeTarget } from './index.js';

const profilePath = process.env.DEPLOYMENT_PROFILE_PATH ?? process.argv[2] ?? 'packages/profiles/profiles/dev.yaml';
const target = parseTarget(process.env.RUNTIME_TARGET ?? process.argv[3] ?? 'api');
const report = validateRuntimeEnvironment({
  profile: loadProfileFromFile(profilePath),
  target
});

// eslint-disable-next-line no-console
console.log(JSON.stringify(report, null, 2));

if (report.status === 'fail') {
  process.exitCode = 1;
}

function parseTarget(value: string): RuntimeTarget {
  if (value === 'api' || value === 'worker' || value === 'web' || value === 'ci') return value;
  throw new Error(`Unsupported RUNTIME_TARGET=${value}`);
}
