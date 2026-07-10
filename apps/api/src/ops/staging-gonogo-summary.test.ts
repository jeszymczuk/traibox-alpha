import { describe, expect, it } from 'vitest';
import { buildGoNoGoSummaryMarkdown } from './staging-gonogo-summary.js';

describe('staging go/no-go summary', () => {
  it('renders a pilot-ready evidence decision', () => {
    const markdown = buildGoNoGoSummaryMarkdown({
      status: 'warn',
      generated_at: '2026-07-08T18:00:00.000Z',
      profile_id: 'staging',
      fixture_mode: false,
      artifact_paths: { timestamped: 'artifacts/staging-rehearsals/2026.json' },
      operator_evidence: {
        status: 'warn',
        ready_for_pilot_invitation: true,
        checklist: [
          {
            key: 'runtime.api',
            status: 'warn',
            evidence: 'API runtime has accepted degraded mode.',
            operator_action: 'Record accepted degraded-mode warning.'
          }
        ],
        next_operator_actions: ['Pilot runtime evidence is complete; proceed to controlled founder story validation.']
      }
    });

    expect(markdown).toContain('GO for controlled pilot invitation');
    expect(markdown).toContain('runtime.api');
    expect(markdown).toContain('Record accepted degraded-mode warning');
    expect(markdown).toContain('artifacts/staging-rehearsals/2026.json');
  });

  it('renders a no-go decision when invitation evidence is incomplete', () => {
    const markdown = buildGoNoGoSummaryMarkdown({
      status: 'fail',
      fixture_mode: true,
      operator_evidence: {
        status: 'fail',
        ready_for_pilot_invitation: false,
        checklist: [{ key: 'http_smoke', status: 'fail', evidence: 'HTTP smoke failed.', operator_action: 'Fix staging API.' }],
        next_operator_actions: ['Fix staging API.']
      }
    });

    expect(markdown).toContain('NO-GO until operator actions are resolved');
    expect(markdown).toContain('HTTP smoke failed');
    expect(markdown).toContain('Fixture mode: **yes**');
  });
});
