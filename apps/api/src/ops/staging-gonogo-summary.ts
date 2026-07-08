import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Status = 'pass' | 'warn' | 'fail' | 'skipped' | string;

interface OperatorEvidenceItem {
  key: string;
  status: Status;
  evidence: string;
  operator_action: string;
  artifact_ref?: string;
}

interface StagingRehearsalLike {
  status?: Status;
  generated_at?: string;
  profile_id?: string;
  fixture_mode?: boolean;
  artifact_paths?: {
    latest?: string;
    timestamped?: string;
  };
  operator_evidence?: {
    status?: Status;
    ready_for_pilot_invitation?: boolean;
    checklist?: OperatorEvidenceItem[];
    next_operator_actions?: string[];
  };
}

export function buildGoNoGoSummaryMarkdown(report: StagingRehearsalLike): string {
  const evidence = report.operator_evidence;
  const ready = evidence?.ready_for_pilot_invitation === true;
  const decision = ready ? 'GO for controlled pilot invitation' : 'NO-GO until operator actions are resolved';
  const checklist = evidence?.checklist ?? [];
  const actions = evidence?.next_operator_actions?.length ? evidence.next_operator_actions : ['No operator actions recorded.'];
  const timestamped = report.artifact_paths?.timestamped ?? 'not recorded';

  return [
    '# TRAIBOX Pilot Go/No-Go Evidence',
    '',
    `- Decision: **${decision}**`,
    `- Rehearsal status: **${report.status ?? 'unknown'}**`,
    `- Operator evidence status: **${evidence?.status ?? 'unknown'}**`,
    `- Ready for pilot invitation: **${ready ? 'yes' : 'no'}**`,
    `- Fixture mode: **${report.fixture_mode ? 'yes' : 'no'}**`,
    `- Profile: **${report.profile_id ?? 'unknown'}**`,
    `- Generated at: **${report.generated_at ?? 'unknown'}**`,
    `- Timestamped artifact: \`${timestamped}\``,
    '',
    '## Checklist',
    '',
    checklist.length
      ? checklist.map((item) => `- ${statusIcon(item.status)} **${item.key}** (${item.status}): ${item.evidence} Action: ${item.operator_action}${item.artifact_ref ? ` Artifact: \`${item.artifact_ref}\`.` : ''}`).join('\n')
      : '- No operator evidence checklist was found in the rehearsal report.',
    '',
    '## Next Operator Actions',
    '',
    actions.map((action) => `- ${action}`).join('\n'),
    '',
    '## Rule',
    '',
    'Do not invite pilot users unless `ready_for_pilot_invitation` is `true`, or every warning has a named operator acceptance recorded in the pilot go/no-go pack.',
    ''
  ].join('\n');
}

export function writeGoNoGoSummary(input: { reportPath?: string; outputPath?: string } = {}) {
  const reportPath = input.reportPath ?? 'artifacts/staging-rehearsals/latest.json';
  const outputPath = input.outputPath ?? 'artifacts/staging-rehearsals/go-no-go-summary.md';
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as StagingRehearsalLike;
  const markdown = buildGoNoGoSummaryMarkdown(report);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);
  return { outputPath, markdown };
}

function statusIcon(status: Status) {
  if (status === 'pass') return '[pass]';
  if (status === 'warn') return '[warn]';
  if (status === 'fail') return '[fail]';
  if (status === 'skipped') return '[skip]';
  return '[info]';
}

async function main(): Promise<void> {
  const reportPath = process.env.STAGING_REHEARSAL_REPORT_PATH;
  const outputPath = process.env.STAGING_GONOGO_SUMMARY_PATH;
  const result = writeGoNoGoSummary({ reportPath, outputPath });
  process.stdout.write(`${result.markdown}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
