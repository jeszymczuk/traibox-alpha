import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  complianceConfig,
  counterpartiesConfig,
  fundingConfig,
  intelligenceRunsConfig,
  intelligenceSessionsConfig,
  invitationsConfig,
  passportConfig,
  paymentsConfig,
  proofConfig,
  reportsConfig
} from './workspace-routes';

const configs = [
  intelligenceSessionsConfig,
  intelligenceRunsConfig,
  fundingConfig,
  paymentsConfig,
  counterpartiesConfig,
  invitationsConfig,
  passportConfig,
  complianceConfig,
  reportsConfig,
  proofConfig
];

const upgradedRoutes = [
  'src/app/intelligence/sessions/[sessionId]/page.tsx',
  'src/app/intelligence/runs/[runId]/page.tsx',
  'src/app/finance/funding/page.tsx',
  'src/app/finance/funding/[fundingId]/page.tsx',
  'src/app/finance/payments/[paymentId]/page.tsx',
  'src/app/network/counterparties/[partyId]/page.tsx',
  'src/app/network/invitations/page.tsx',
  'src/app/clearance/passport/[passportId]/page.tsx',
  'src/app/clearance/compliance/requirements/[requirementId]/page.tsx',
  'src/app/clearance/reports/[reportId]/page.tsx',
  'src/app/operations-center/approvals/page.tsx',
  'src/app/settings/permissions/page.tsx',
  'src/app/settings/policies/page.tsx',
  'src/app/trades/[tradeId]/proof/page.tsx'
];

describe('workspace route contracts', () => {
  it('defines actionable data contracts for every shared workspace screen', () => {
    for (const config of configs) {
      expect(config.title.length).toBeGreaterThan(10);
      expect(config.description.length).toBeGreaterThan(30);
      expect(config.types.length).toBeGreaterThan(0);
      expect(config.primaryHref).toMatch(/^\//);
    }
  });

  it('keeps every upgraded canonical route free of scaffold-shell delegation', () => {
    for (const route of upgradedRoutes) {
      const source = readFileSync(resolve(process.cwd(), route), 'utf8');
      expect(source).not.toContain('ScreenContractShell');
      // TrustPassportClient / PaymentDetailClient are v9 screens that delegate
      // to ObjectWorkspaceDetail for object ids outside their primary type.
      expect(source).toMatch(/ObjectWorkspace|ApprovalQueue|GovernanceWorkspace|TrustPassportClient|PaymentDetailClient/);
    }
  });
});
