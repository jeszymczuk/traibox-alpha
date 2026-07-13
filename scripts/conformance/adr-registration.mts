import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { loadGovernanceDocuments } from './governance-schema.mts';
import { readText, walkFiles } from './shared/repo.mts';

const ADR_STATUS = ['Proposed', 'Accepted', 'Superseded', 'Deprecated'] as const;

type AdrRecord = {
  number: string;
  path: string;
  status: string;
  effectiveWhen?: string;
  approvalRecord?: string;
  draftAuthority?: string;
  supersededBy?: string;
};

function field(markdown: string, name: string): string | undefined {
  return markdown.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim();
}

export function parseAdr(path: string, markdown: string): AdrRecord {
  const number = path.match(/ADR-(\d{3})/)?.[1];
  if (!number) throw new Error(`${path}: invalid ADR filename`);
  return {
    number,
    path,
    status: field(markdown, 'Status') ?? '',
    effectiveWhen: field(markdown, 'Effective when'),
    approvalRecord: field(markdown, 'Approval record'),
    draftAuthority: field(markdown, 'Draft branch authority'),
    supersededBy: field(markdown, 'Superseded by')?.match(/ADR-(\d{3})/)?.[1]
  };
}

function add(findings: ConformanceFinding[], rule: string, message: string, source: string): void {
  findings.push({ check: 'adr-registration', rule, message, source, severity: 'high' });
}

export function compareAdrRegistration(adrs: AdrRecord[], readme: string, registrations: Array<{ id: string; path: string; status: string }>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const numbers = new Map<string, AdrRecord[]>();
  for (const adr of adrs) numbers.set(adr.number, [...(numbers.get(adr.number) ?? []), adr]);
  for (const [number, records] of numbers) if (records.length > 1) add(findings, 'ADR_NUMBER_DUPLICATE', `ADR-${number} is used by ${records.map((record) => record.path).join(', ')}`, records[0]!.path);

  const linkedPaths = new Set([...readme.matchAll(/\]\((ADR-\d{3}[^)]+\.md)\)/g)].map((match) => `docs/adrs/${match[1]}`));
  const actualPaths = new Set(adrs.map((adr) => adr.path));
  for (const adr of adrs) if (!linkedPaths.has(adr.path)) add(findings, 'ADR_MISSING_INDEX', `${adr.path} is absent from docs/adrs/README.md`, adr.path);
  for (const path of linkedPaths) if (!actualPaths.has(path)) add(findings, 'ADR_INDEX_MISSING_FILE', `README references nonexistent ${path}`, 'docs/adrs/README.md');

  const registeredByPath = new Map(registrations.map((entry) => [entry.path, entry]));
  for (const adr of adrs) {
    if (!(ADR_STATUS as readonly string[]).includes(adr.status)) add(findings, 'ADR_STATUS_INVALID', `${adr.path} has invalid status ${adr.status || '<missing>'}`, adr.path);
    const registration = registeredByPath.get(adr.path);
    if (adr.status === 'Accepted' && (!registration || registration.status !== 'APPROVED')) add(findings, 'ADR_APPROVED_NOT_REGISTERED', `${adr.path} is Accepted but not APPROVED in source-of-truth.yaml`, adr.path);
    if (adr.status === 'Accepted') {
      if (!adr.effectiveWhen?.includes('merged into `main` by the repository owner')) add(findings, 'ADR_ACTIVATION_INVALID', `${adr.path} lacks valid merge activation metadata`, adr.path);
      if (!adr.approvalRecord?.includes('merge of PR #')) add(findings, 'ADR_APPROVAL_RECORD_INVALID', `${adr.path} lacks a merge approval record`, adr.path);
      if (!adr.draftAuthority?.toLowerCase().includes('none over `main`')) add(findings, 'ADR_DRAFT_AUTHORITY_INVALID', `${adr.path} permits an unmerged draft to claim authority over main`, adr.path);
    }
    if (adr.status === 'Superseded') {
      if (!adr.supersededBy) add(findings, 'ADR_SUPERSESSION_MISSING', `${adr.path} is Superseded without a target ADR`, adr.path);
      else if (adr.supersededBy === adr.number) add(findings, 'ADR_SUPERSESSION_SELF', `${adr.path} supersedes itself`, adr.path);
      else if (!numbers.has(adr.supersededBy)) add(findings, 'ADR_SUPERSESSION_TARGET_MISSING', `${adr.path} references missing ADR-${adr.supersededBy}`, adr.path);
    }
  }
  for (const registration of registrations.filter((entry) => /^adr-\d{3}$/.test(entry.id))) {
    if (!actualPaths.has(registration.path)) add(findings, 'ADR_REGISTRATION_MISSING_FILE', `${registration.id} references nonexistent ${registration.path}`, 'docs/governance/source-of-truth.yaml');
  }
  return findings;
}

export function checkAdrRegistration(context: CheckContext): ConformanceFinding[] {
  const paths = walkFiles(context.root, 'docs/adrs', (path) => /\/ADR-\d{3}[^/]*\.md$/.test(path));
  const adrs = paths.map((path) => parseAdr(path, readText(context.root, path)));
  const { sourceOfTruth } = loadGovernanceDocuments(context.root);
  return compareAdrRegistration(adrs, readText(context.root, 'docs/adrs/README.md'), sourceOfTruth.repository_governance);
}

export async function runAdrRegistrationCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'adr-registration', findings: checkAdrRegistration(context), baselined: [] };
}
