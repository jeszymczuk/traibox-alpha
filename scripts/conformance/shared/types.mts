export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ConformanceFinding = {
  check: string;
  rule: string;
  message: string;
  source?: string;
  severity: FindingSeverity;
  baselineKey?: string;
};

export type CheckResult = {
  check: string;
  findings: ConformanceFinding[];
  baselined: ConformanceFinding[];
};

export type CheckContext = {
  root: string;
};

export type DebtBaselineEntry = {
  fingerprint: string;
  rule: string;
  source: string;
  owner: string;
  severity: FindingSeverity;
  rationale: string;
  remediation_condition: string;
};
