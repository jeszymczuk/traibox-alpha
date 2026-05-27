import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALPHA_SCENARIOS,
  type AlphaDemoResponse,
  type DocumentPackGenerateResponse,
  type DocumentUploadResponse,
  type TradeBrainEvalReport,
  type UTGRecallResponse
} from '@traibox/contracts';

import { buildServer } from '../server.js';
import { listTradeBrainEvalRuns, persistTradeBrainEvalReport } from './trade-brain-evals.js';

const TEST_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const DEV_USER_ID = '00000000-0000-0000-0000-0000000000aa';

const run = TEST_DB_URL ? describe : describe.skip;

run('TRAIBOX alpha scenarios against Postgres', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let dbPool: pg.Pool;
  let orgId: string;
  let fullTradeStory: AlphaDemoResponse | null = null;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.AUTH_MODE = 'dev';
    process.env.DEV_USER_ID = DEV_USER_ID;
    process.env.DEPLOYMENT_PROFILE_PATH =
      process.env.DEPLOYMENT_PROFILE_PATH ?? path.join(findRepoRoot(), 'packages/profiles/profiles/dev.yaml');

    dbPool = new pg.Pool({ connectionString: TEST_DB_URL });
    app = await buildServer();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Alpha Scenario Test Org', country: 'PT' }
    });
    expect(created.statusCode).toBe(200);
    orgId = created.json<{ org_id: string }>().org_id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbPool?.end();
  });

  it('exposes Settings workspace org access and invite state', async () => {
    const access = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/access`,
      headers: authHeaders()
    });
    expect(access.statusCode).toBe(200);
    const accessBody = access.json<{ org: { role: string }; members: Array<{ role: string }>; invites: unknown[] }>();
    expect(accessBody.org.role).toBe('owner');
    expect(accessBody.members.some((member) => member.role === 'owner')).toBe(true);

    const invite = await app.inject({
      method: 'POST',
      url: `/v1/orgs/${orgId}/invites`,
      headers: authHeaders(),
      payload: { email: 'auditor@example.com', role: 'auditor' }
    });
    expect(invite.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'GET',
      url: `/v1/orgs/${orgId}/access`,
      headers: authHeaders()
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json<{ invites: Array<{ email: string; role: string }> }>();
    expect(updatedBody.invites).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'auditor@example.com', role: 'auditor' })]));
  });

  it('exposes versioned API product contracts and standardized validation errors', async () => {
    const health = await app.inject({
      method: 'GET',
      url: '/healthz'
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual(expect.objectContaining({ ok: true, service: 'traibox-api', profile_id: 'dev' }));

    const ready = await app.inject({
      method: 'GET',
      url: '/readyz'
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual(expect.objectContaining({ ok: true, service: 'traibox-api', database: expect.objectContaining({ ok: true }) }));

    const metrics = await app.inject({
      method: 'GET',
      url: '/metrics'
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('traibox_api_runtime_status');

    const catalog = await app.inject({
      method: 'GET',
      url: '/v1/api/catalog'
    });
    expect(catalog.statusCode).toBe(200);
    const catalogBody = catalog.json<{
      version: string;
      endpoints: Array<{ method: string; path: string; idempotency?: string }>;
      errors: Array<{ code: string; category: string; retryable: boolean }>;
      idempotency: { required_for: string[] };
    }>();
    expect(catalogBody.version).toBe('v1');
    expect(catalogBody.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'POST', path: '/v1/payments/intents/{paymentIntentId}/execute', idempotency: 'required' })]));
    expect(catalogBody.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'validation_error', category: 'validation', retryable: false })]));
    expect(catalogBody.idempotency.required_for).toContain('POST /v1/payments/intents/{paymentIntentId}/execute');

    const openapi = await app.inject({
      method: 'GET',
      url: '/v1/openapi.json'
    });
    expect(openapi.statusCode).toBe(200);
    const openapiBody = openapi.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(openapiBody.openapi).toBe('3.1.0');
    expect(openapiBody.paths).toHaveProperty('/v1/approvals');

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/trade/parse',
      headers: authHeaders(orgId),
      payload: {}
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual(
      expect.objectContaining({
        error: 'validation_error',
        category: 'validation',
        retryable: false,
        status_code: 400,
        trace_id: expect.any(String)
      })
    );
  });

  it('persists Trade Brain eval reports as queryable product artifacts', async () => {
    const report = sampleTradeBrainEvalReport('trade-brain-ci-smoke');

    const persisted = await persistTradeBrainEvalReport(dbPool, {
      orgId,
      userId: DEV_USER_ID,
      traceId: 'trc_eval_persist',
      report
    });

    expect(persisted.run).toEqual(
      expect.objectContaining({
        run_id: report.run_id,
        suite_id: 'trade-brain-ci-smoke',
        status: 'pass',
        score: 100,
        eval_object_id: persisted.eval_result.object_id
      })
    );
    expect(persisted.eval_result).toEqual(
      expect.objectContaining({
        type: 'ai_eval_result',
        origin_workspace: 'operations',
        payload_json: expect.objectContaining({
          artifact_kind: 'trade_brain_eval_report',
          report_sha256: expect.stringMatching(/^[0-9a-f]{64}$/i)
        })
      })
    );

    const runs = await listTradeBrainEvalRuns(dbPool, {
      orgId,
      userId: DEV_USER_ID,
      traceId: 'trc_eval_list',
      query: { suite_id: 'trade-brain-ci-smoke', limit: 10 }
    });
    expect(runs.runs).toEqual(expect.arrayContaining([expect.objectContaining({ run_id: report.run_id, status: 'pass' })]));

    const query = await app.inject({
      method: 'GET',
      url: '/v1/query?type=ai_eval_result&origin_workspace=operations&limit=20',
      headers: authHeaders(orgId)
    });
    expect(query.statusCode).toBe(200);
    const queryBody = query.json<{ objects: Array<{ object_id: string; payload_json: Record<string, unknown> }>; memory_events: unknown[] }>();
    expect(queryBody.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_id: persisted.eval_result.object_id,
          payload_json: expect.objectContaining({ artifact_kind: 'trade_brain_eval_report' })
        })
      ])
    );
    expect(queryBody.memory_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ai_eval.run',
          signal: 'trade-brain-ci-smoke:pass'
        })
      ])
    );

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/evals/trade-brain/runs?suite_id=trade-brain-ci-smoke',
      headers: authHeaders(orgId)
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json<{ runs: Array<{ run_id: string; eval_object_id: string | null }> }>();
    expect(listedBody.runs).toEqual(expect.arrayContaining([expect.objectContaining({ run_id: report.run_id, eval_object_id: persisted.eval_result.object_id })]));
  });

  for (const scenario of ALPHA_SCENARIOS) {
    it(`executes ${scenario.title}`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/internal-alpha',
        headers: authHeaders(orgId),
        payload: { scenario_id: scenario.id }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<AlphaDemoResponse>();
      expect(body.scenario_id).toBe(scenario.id);
      expect(body.mode).toBe(scenario.mode);
      expect(body.trade_id).toMatch(uuidPattern);
      expect(body.objects.length).toBeGreaterThanOrEqual(3);
      expect(body.steps.map((step) => step.key)).toEqual(expect.arrayContaining(['readiness_state', 'proof_bundle', 'operations_center']));
      expect(body.proof_bundle.type).toBe('proof_bundle');
      expect(body.readiness.trace_id).toBe(body.trace_id);
      if (scenario.id === 'full_trade_room_loop') fullTradeStory = body;

      if (scenario.mode !== 'full_trade_cycle') {
        expect(body.steps.map((step) => step.key)).toContain('attachment');
      }

      const query = await app.inject({
        method: 'GET',
        url: `/v1/query?trade_id=${encodeURIComponent(body.trade_id)}&limit=100`,
        headers: authHeaders(orgId)
      });
      expect(query.statusCode).toBe(200);
      const queryBody = query.json<{ objects: Array<{ type?: string; status?: string; payload_json?: Record<string, any> }>; readiness_states: unknown[]; memory_events: unknown[] }>();
      expect(queryBody.objects.length).toBeGreaterThanOrEqual(2);
      expect(queryBody.objects).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'workflow_run' })]));
      const workflowRun = queryBody.objects.find((object) => object.type === 'workflow_run');
      expect(workflowRun?.payload_json?.workflow_runtime).toEqual(
        expect.objectContaining({
          adapter: 'temporal_alpha_bridge',
          workflow_run_id: expect.any(String),
          workflow_id: expect.stringMatching(/^traibox-/),
          command: expect.stringMatching(/await_signal|observe|closed|run_activity|recover/),
          recovery_policy: expect.objectContaining({
            deterministic_replay_required: true,
            resume_strategy: 'replay_from_structured_events'
          })
        })
      );
      expect(queryBody.readiness_states.length).toBeGreaterThanOrEqual(1);
      expect(queryBody.memory_events.length).toBeGreaterThanOrEqual(1);

      const memoryInsights = await app.inject({
        method: 'GET',
        url: `/v1/memory/insights?trade_id=${encodeURIComponent(body.trade_id)}&limit=100`,
        headers: authHeaders(orgId)
      });
      expect(memoryInsights.statusCode).toBe(200);
      const memoryInsightsBody = memoryInsights.json<{
        insights: Array<{ category: string; severity: string; count: number; trade_ids: string[] }>;
        lenses: Array<{ lens: string; severity: string; signal_count: number; trade_ids: string[]; top_signals: unknown[]; next_action: string }>;
        recommended_actions: string[];
        source_events: number;
      }>();
      expect(memoryInsightsBody.source_events).toBeGreaterThanOrEqual(1);
      expect(memoryInsightsBody.insights).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: expect.stringMatching(/missing_proof|proof_pattern|workflow_recovery|approval_bottleneck|document_quality/),
            count: expect.any(Number),
            trade_ids: expect.arrayContaining([body.trade_id])
          })
        ])
      );
      expect(memoryInsightsBody.lenses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lens: expect.stringMatching(/recurring_gaps|proof_readiness|approval_bottlenecks|document_quality/),
            signal_count: expect.any(Number),
            trade_ids: expect.arrayContaining([body.trade_id]),
            top_signals: expect.any(Array),
            next_action: expect.any(String)
          })
        ])
      );
      expect(memoryInsightsBody.recommended_actions.length).toBeGreaterThanOrEqual(1);

      const replay = await app.inject({
        method: 'GET',
        url: `/v1/replay?trade_id=${encodeURIComponent(body.trade_id)}&limit=160`,
        headers: authHeaders(orgId)
      });
      expect(replay.statusCode).toBe(200);
      const replayBody = replay.json<{
        steps: Array<{ source: string; kind: string; trace_id?: string; hash?: string }>;
        deterministic_hash: string;
        coverage: Record<string, number>;
        gaps: string[];
      }>();
      expect(replayBody.deterministic_hash).toMatch(/^[0-9a-f]{64}$/i);
      expect(replayBody.steps.length).toBeGreaterThanOrEqual(4);
      expect(replayBody.steps.map((step) => step.source)).toEqual(expect.arrayContaining(['object', 'event', 'memory', 'readiness', 'proof']));
      expect(replayBody.steps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'object.workflow_run' })]));
      expect(replayBody.coverage.objects).toBeGreaterThanOrEqual(2);
      expect(replayBody.coverage.memory_events).toBeGreaterThanOrEqual(1);
      expect(replayBody.gaps).not.toContain('No replayable activity found for this scope.');

      const evalQuery = await app.inject({
        method: 'GET',
        url: `/v1/query?trade_id=${encodeURIComponent(body.trade_id)}&type=ai_eval_result&limit=100`,
        headers: authHeaders(orgId)
      });
      expect(evalQuery.statusCode).toBe(200);
      const evalQueryBody = evalQuery.json<{ objects: Array<{ payload_json: Record<string, unknown>; evidence_refs_json?: unknown[] }> }>();
      expect(evalQueryBody.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'ai_eval_result',
            payload_json: expect.objectContaining({
              replayable: true
            })
          })
        ])
      );
      expect(evalQueryBody.objects.map((object) => object.payload_json.suite)).toContain('proof-quality-alpha-v1');
      expect(evalQueryBody.objects.find((object) => object.payload_json.suite === 'proof-quality-alpha-v1')?.payload_json).toEqual(
        expect.objectContaining({
          quality_signals: expect.objectContaining({
            missing_count: expect.any(Number)
          })
        })
      );
      if (scenario.id === 'full_trade_room_loop') {
        expect(evalQueryBody.objects.map((object) => object.payload_json.suite)).toContain('document-intelligence-alpha-v1');
        expect(evalQueryBody.objects.find((object) => object.payload_json.suite === 'document-intelligence-alpha-v1')?.payload_json).toEqual(
          expect.objectContaining({
            quality_signals: expect.objectContaining({
              missing_field_count: expect.any(Number)
            })
          })
        );
      }

      if (scenario.id === 'full_trade_room_loop') {
        const uploadPayload = multipartDocumentPayload({
          fields: {
            trade_id: body.trade_id,
            origin_workspace: 'trades',
            extract: 'true'
          },
          filename: 'stored-supplier-pack.txt',
          contentType: 'text/plain',
          text:
            'Commercial Invoice INV-444. Seller Lusitania Automation Lda. Buyer Iberica Components SL. Amount EUR 48000. Incoterm DAP. Payment terms 40% advance and 60% after acceptance. Buyer VAT ESB12345678.'
        });
        const upload = await app.inject({
          method: 'POST',
          url: '/v1/documents/upload',
          headers: {
            ...authHeaders(orgId),
            'content-type': `multipart/form-data; boundary=${uploadPayload.boundary}`
          },
          payload: uploadPayload.body
        });
        expect(upload.statusCode).toBe(200);
        const uploadBody = upload.json<DocumentUploadResponse>();
        expect(uploadBody.document.type).toBe('document');
        expect(uploadBody.document.trade_id).toBe(body.trade_id);
        expect(uploadBody.file_url).toContain('documents/');
        expect(uploadBody.sha256).toMatch(/^[0-9a-f]{64}$/i);
        expect(uploadBody.extracted_text_available).toBe(true);
        expect(uploadBody.extraction_result?.type).toBe('extraction_result');

        const storedDocument = await app.inject({
          method: 'GET',
          url: `/v1/files?org_id=${encodeURIComponent(orgId)}&url=${encodeURIComponent(uploadBody.file_url)}&token=dev`
        });
        expect(storedDocument.statusCode).toBe(200);

        const pack = await app.inject({
          method: 'POST',
          url: '/v1/documents/packs',
          headers: authHeaders(orgId),
          payload: {
            trade_id: body.trade_id,
            object_ids: [uploadBody.document.object_id, uploadBody.extraction_result?.object_id].filter(Boolean),
            title: 'Scenario stored document pack'
          }
        });
        expect(pack.statusCode).toBe(200);
        const packBody = pack.json<DocumentPackGenerateResponse>();
        expect(packBody.document_pack.type).toBe('document_pack');
        expect(packBody.document_pack.trade_id).toBe(body.trade_id);
        expect(packBody.file_url).toContain('document-packs/');
        expect(packBody.manifest_sha256).toMatch(/^[0-9a-f]{64}$/i);
        expect(packBody.document_count).toBeGreaterThanOrEqual(1);
        expect(packBody.extraction_count).toBeGreaterThanOrEqual(1);

        const storedPack = await app.inject({
          method: 'GET',
          url: `/v1/files?org_id=${encodeURIComponent(orgId)}&url=${encodeURIComponent(packBody.file_url)}&token=dev`
        });
        expect(storedPack.statusCode).toBe(200);

        const packQuery = await app.inject({
          method: 'GET',
          url: `/v1/query?trade_id=${encodeURIComponent(body.trade_id)}&type=document_pack&limit=20`,
          headers: authHeaders(orgId)
        });
        expect(packQuery.statusCode).toBe(200);
        const packQueryBody = packQuery.json<{ objects: Array<{ object_id: string; type: string; payload_json: Record<string, unknown> }>; memory_events: Array<{ kind: string; object_id?: string }> }>();
        expect(packQueryBody.objects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              object_id: packBody.document_pack.object_id,
              type: 'document_pack',
              payload_json: expect.objectContaining({
                manifest_sha256: packBody.manifest_sha256,
                source_object_ids: expect.arrayContaining([uploadBody.document.object_id])
              })
            })
          ])
        );
        expect(packQueryBody.memory_events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'document_pack.generated',
              object_id: packBody.document_pack.object_id
            })
          ])
        );

        const graph = await app.inject({
          method: 'POST',
          url: '/v1/utg/recall',
          headers: authHeaders(orgId),
          payload: {
            trade_id: body.trade_id,
            hops: 2,
            include: ['all'],
            limit_nodes: 260
          }
        });
        expect(graph.statusCode).toBe(200);
        const graphBody = graph.json<UTGRecallResponse>();
        expect(graphBody.projection).toEqual(
          expect.objectContaining({
            adapter: 'postgres_alpha_projection',
            phase: 'utg_phase_1',
            source_counts: expect.objectContaining({
              alpha_objects: expect.any(Number),
              readiness_states: expect.any(Number),
              memory_events: expect.any(Number),
              proof_bundles: expect.any(Number),
              attachments: expect.any(Number)
            }),
            coverage: expect.objectContaining({
              node_count: expect.any(Number),
              edge_count: expect.any(Number),
              evidence_edges: expect.any(Number),
              attachment_edges: expect.any(Number)
            })
          })
        );
        expect(graphBody.nodes.map((node) => node.label)).toEqual(
          expect.arrayContaining(['Trade', 'AlphaObject', 'ReadinessState', 'MemoryEvent', 'ProofBundle'])
        );
        expect(graphBody.nodes.map((node) => node.props?.object_type).filter(Boolean)).toEqual(
          expect.arrayContaining(['document', 'extraction_result', 'document_pack', 'payment_intent', 'proof_bundle'])
        );
        expect(graphBody.edges.map((edge) => edge.type)).toEqual(
          expect.arrayContaining(['HAS_OBJECT', 'HAS_READINESS', 'HAS_MEMORY', 'HAS_PROOF_BUNDLE', 'CONTAINS_EVIDENCE'])
        );
        expect(graphBody.edges.some((edge) => ['ATTACHED_TO', 'LINKED_TO', 'CONVERTED_TO'].includes(edge.type))).toBe(true);

        const ledgerProof = await app.inject({
          method: 'GET',
          url: `/v1/ledger/proofs?trade_id=${encodeURIComponent(body.trade_id)}`,
          headers: authHeaders(orgId)
        });
        expect(ledgerProof.statusCode).toBe(200);
        const ledgerProofBody = ledgerProof.json<{ bundle_url: string; root: string; manifest_sha256: string; artifact_count: number }>();
        expect(ledgerProofBody.bundle_url).toContain('bundles/');
        expect(ledgerProofBody.root).toMatch(/^[0-9a-f]{64}$/i);
        expect(ledgerProofBody.artifact_count).toBeGreaterThan(0);

        const verification = await app.inject({
          method: 'POST',
          url: '/v1/ledger/proofs/verify',
          headers: authHeaders(orgId),
          payload: { trade_id: body.trade_id }
        });
        expect(verification.statusCode).toBe(200);
        const verificationBody = verification.json<{ valid: boolean; root: string; expected_root: string; bundle_sha256: string; trace_id: string }>();
        expect(verificationBody.valid).toBe(true);
        expect(verificationBody.root).toBe(verificationBody.expected_root);
        expect(verificationBody.bundle_sha256).toMatch(/^[0-9a-f]{64}$/i);
        expect(verificationBody.trace_id).toMatch(/^trc_/);

        const exported = await app.inject({
          method: 'POST',
          url: '/v1/ledger/export',
          headers: authHeaders(orgId),
          payload: { trade_ids: [body.trade_id] }
        });
        expect(exported.statusCode).toBe(200);
        const exportedBody = exported.json<{ url: string; hash: string; trade_count: number; trace_id: string }>();
        expect(exportedBody.url).toContain('exports/');
        expect(exportedBody.hash).toMatch(/^[0-9a-f]{64}$/i);
        expect(exportedBody.trade_count).toBe(1);
        expect(exportedBody.trace_id).toMatch(/^trc_/);

        const shareRequest = await app.inject({
          method: 'POST',
          url: '/v1/proofs/share-requests',
          headers: authHeaders(orgId),
          payload: {
            proof_bundle_id: body.proof_bundle.object_id,
            recipient: { name: 'Scenario proof recipient', email: 'proof-recipient@example.com', role: 'counterparty' },
            scopes: ['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle'],
            reason: 'Scenario test controlled proof sharing.'
          }
        });
        expect(shareRequest.statusCode).toBe(200);
        const shareRequestBody = shareRequest.json<{
          proof_bundle: { object_id: string; type: string; status: string; payload_json: Record<string, any>; permissions_json: Record<string, any> };
          approval: { object_id: string; type: string; status: string; payload_json: Record<string, any> };
          protected_action: string;
        }>();
        expect(shareRequestBody.protected_action).toBe('share_proof_bundle_externally');
        expect(shareRequestBody.approval.type).toBe('approval');
        expect(shareRequestBody.approval.status).toBe('approval_required');
        expect(shareRequestBody.approval.payload_json.protected_action).toBe('share_proof_bundle_externally');
        expect(shareRequestBody.proof_bundle.status).toBe('completed');
        expect(shareRequestBody.proof_bundle.payload_json.share_control).toEqual(
          expect.objectContaining({
            status: 'approval_required',
            approval_object_id: shareRequestBody.approval.object_id,
            external_action_performed_by_traibox: false
          })
        );

        const shareDecision = await app.inject({
          method: 'POST',
          url: `/v1/approvals/${shareRequestBody.approval.object_id}/decision`,
          headers: authHeaders(orgId),
          payload: {
            decision: 'approved',
            step_up_verified: true,
            residual_risks_acknowledged: true,
            notes: 'Scenario test proof sharing approval with recipient and scope reviewed.'
          }
        });
        expect(shareDecision.statusCode).toBe(200);
        const shareDecisionBody = shareDecision.json<{
          approval: { status: string };
          target: { status: string; payload_json: Record<string, any>; permissions_json: Record<string, any> } | null;
          execution_task: { type: string; payload_json: Record<string, any> } | null;
        }>();
        expect(shareDecisionBody.approval.status).toBe('approved');
        expect(shareDecisionBody.target?.status).toBe('completed');
        expect(shareDecisionBody.target?.payload_json.share_control).toEqual(
          expect.objectContaining({
            status: 'approved_for_controlled_share',
            external_action_performed_by_traibox: false
          })
        );
        expect(shareDecisionBody.target?.permissions_json.shareable).toBe(true);
        expect(shareDecisionBody.execution_task?.type).toBe('execution_task');
        expect(shareDecisionBody.execution_task?.payload_json.protected_action).toBe('share_proof_bundle_externally');
      }

      if (scenario.id === 'standalone_clearance') {
        const clearance = body.objects.find((object: any) => object.type === 'clearance_check') as { object_id: string } | undefined;
        expect(clearance?.object_id).toMatch(uuidPattern);
        const clearanceEval = await app.inject({
          method: 'POST',
          url: `/v1/clearance/checks/${clearance!.object_id}/evaluate`,
          headers: authHeaders(orgId),
          payload: {
            rule_pack_id: 'EU-alpha',
            corridor: 'PT-ES',
            available_evidence: ['commercial_invoice'],
            subject: 'industrial sensors with sustainability-sensitive evidence'
          }
        });
        expect(clearanceEval.statusCode).toBe(200);
        const clearanceEvalBody = clearanceEval.json<{
          clearance_check: { status: string; payload_json: Record<string, any> };
          report: { type: string; origin_workspace: string; payload_json: Record<string, any> };
          readiness: { overall: string; missing_items: string[] };
          requirements: Array<{ key: string; status: string }>;
          missing_evidence: string[];
        }>();
        expect(clearanceEvalBody.clearance_check.status).toBe('blocked');
        expect(clearanceEvalBody.clearance_check.payload_json.clearance_evaluation.rule_pack_id).toBe('EU-alpha');
        expect(clearanceEvalBody.report.type).toBe('report');
        expect(clearanceEvalBody.report.origin_workspace).toBe('clearance');
        expect(clearanceEvalBody.report.payload_json.report_type).toBe('clearance_rule_pack');
        expect(clearanceEvalBody.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'commercial_invoice', status: 'available' })]));
        expect(clearanceEvalBody.missing_evidence).toEqual(expect.arrayContaining(['origin_statement', 'buyer_tax_id']));
        expect(clearanceEvalBody.readiness.missing_items).toEqual(expect.arrayContaining(['origin_statement', 'buyer_tax_id']));
      }

      if (scenario.id === 'counterparty_onboarding_screening') {
        const counterparty = body.objects.find((object: any) => object.type === 'counterparty') as { object_id: string } | undefined;
        const onboarding = body.objects.find((object: any) => object.type === 'onboarding_flow') as { object_id: string } | undefined;
        const screening = body.objects.find((object: any) => object.type === 'screening_result') as { object_id: string } | undefined;
        expect(counterparty?.object_id).toMatch(uuidPattern);
        const trust = await app.inject({
          method: 'POST',
          url: `/v1/network/counterparties/${counterparty!.object_id}/trust-context`,
          headers: authHeaders(orgId),
          payload: {
            onboarding_flow_id: onboarding?.object_id,
            screening_result_id: screening?.object_id,
            passport_visibility: 'controlled_external',
            invite: {
              name: 'Nordic Retail operations',
              email: 'nordic-ops@example.com',
              role: 'buyer',
              scopes: ['view_trade_passport', 'submit_onboarding_evidence'],
              reason: 'Scenario test invite remains approval gated.'
            },
            match_context: { corridor: 'PT-SE', domain: 'buyer' }
          }
        });
        expect(trust.statusCode).toBe(200);
        const trustBody = trust.json<{
          counterparty: { status: string; payload_json: Record<string, any> };
          trade_passport: { object_id: string; type: string; origin_workspace: string; payload_json: Record<string, any> };
          matchmaking_result: { type: string; payload_json: Record<string, any> };
          approval?: { object_id: string; type: string; status: string; payload_json: Record<string, any> };
          trust_context: { score: number; status: string; missing_items: string[]; passport_visibility: string };
        }>();
        expect(trustBody.counterparty.payload_json.trust_context.score).toBeGreaterThan(40);
        expect(trustBody.trade_passport.type).toBe('trade_passport');
        expect(trustBody.trade_passport.origin_workspace).toBe('network');
        expect(trustBody.trade_passport.payload_json.visibility).toBe('controlled_external');
        expect(trustBody.matchmaking_result.type).toBe('matchmaking_result');
        expect(trustBody.matchmaking_result.payload_json.trade_passport_id).toBe(trustBody.trade_passport.object_id);
        expect(trustBody.approval?.type).toBe('approval');
        expect(trustBody.approval?.status).toBe('approval_required');
        expect(trustBody.approval?.payload_json.protected_action).toBe('invite_external_counterparty');

        const firstInviteApproval = await app.inject({
          method: 'POST',
          url: `/v1/approvals/${trustBody.approval!.object_id}/decision`,
          headers: authHeaders(orgId),
          payload: {
            decision: 'approved',
            step_up_verified: true,
            residual_risks_acknowledged: true,
            notes: 'Operations approves scoped counterparty invitation.'
          }
        });
        expect(firstInviteApproval.statusCode).toBe(200);
        expect(firstInviteApproval.json<{ approval: { status: string } }>().approval.status).toBe('approval_required');

        const finalInviteApproval = await app.inject({
          method: 'POST',
          url: `/v1/approvals/${trustBody.approval!.object_id}/decision`,
          headers: authHeaders(orgId),
          payload: {
            decision: 'approved',
            step_up_verified: true,
            residual_risks_acknowledged: true,
            notes: 'Admin releases scoped counterparty invitation task.'
          }
        });
        expect(finalInviteApproval.statusCode).toBe(200);
        const finalInviteApprovalBody = finalInviteApproval.json<{
          approval: { status: string };
          execution_task: { type: string; payload_json: Record<string, any> } | null;
        }>();
        expect(finalInviteApprovalBody.approval.status).toBe('approved');
        expect(finalInviteApprovalBody.execution_task?.type).toBe('execution_task');
        expect(finalInviteApprovalBody.execution_task?.payload_json.protected_action).toBe('invite_external_counterparty');
      }

      const approval = body.objects.find((object: any) => object.type === 'approval') as { object_id: string } | undefined;
      if (approval) {
        const decision = await app.inject({
          method: 'POST',
          url: `/v1/approvals/${approval.object_id}/decision`,
          headers: authHeaders(orgId),
          payload: {
            decision: 'approved',
            step_up_verified: true,
            residual_risks_acknowledged: true,
            notes: 'Scenario test approval gate.'
          }
        });
        expect(decision.statusCode).toBe(200);
        const decisionBody = decision.json<{ approval: { status: string }; execution_task: { object_id: string; type: string; status: string } | null; decision: string }>();
        expect(decisionBody.approval.status).toBe('approved');
        expect(decisionBody.execution_task?.type).toBe('execution_task');
        expect(decisionBody.execution_task?.status).toBe('in_progress');

        const documentRequest = await app.inject({
          method: 'POST',
          url: '/v1/document-requests',
          headers: authHeaders(orgId),
          payload: {
            trade_id: body.trade_id,
            task_id: decisionBody.execution_task?.object_id,
            title: 'Request missing evidence',
            requested_items: ['buyer_tax_id', 'incoterm'],
            requested_from: { name: 'Scenario Buyer', email: 'buyer@example.com', role: 'buyer' }
          }
        });
        expect(documentRequest.statusCode).toBe(200);
        const documentRequestBody = documentRequest.json<{ request: { object_id: string; type: string; status: string } }>();
        expect(documentRequestBody.request.type).toBe('document_request');
        expect(documentRequestBody.request.status).toBe('pending_input');

        const submission = await app.inject({
          method: 'POST',
          url: `/v1/document-requests/${documentRequestBody.request.object_id}/submissions`,
          headers: authHeaders(orgId),
          payload: {
            filename: 'buyer-vat-proof.txt',
            text: 'Purchase Order PO-8812. Seller: Lusitania Automation Lda. Buyer: Iberica Components SL. Buyer VAT: ESB12345678. Amount EUR 48000. Incoterm DAP. Payment terms: 40% advance and 60% after acceptance.',
            submitted_by: { name: 'Scenario Buyer', role: 'buyer' }
          }
        });
        expect(submission.statusCode).toBe(200);
        const submissionBody = submission.json<{ request: { status: string }; document: { type: string }; extraction_result: { type: string }; proof_bundle: { type: string } }>();
        expect(submissionBody.request.status).toBe('completed');
        expect(submissionBody.document.type).toBe('document');
        expect(submissionBody.extraction_result.type).toBe('extraction_result');
        expect(submissionBody.proof_bundle.type).toBe('proof_bundle');
      }
    });
  }

  it('keeps alpha activity, approvals, proof bundles, and files isolated by organization context', async () => {
    const story =
      fullTradeStory ??
      (
        await app.inject({
          method: 'POST',
          url: '/v1/demo/internal-alpha',
          headers: authHeaders(orgId),
          payload: { scenario_id: 'full_trade_room_loop' }
        })
      ).json<AlphaDemoResponse>();
    expect(story.trade_id).toMatch(uuidPattern);

    const createdB = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Isolation Guard Org', country: 'PT' }
    });
    expect(createdB.statusCode).toBe(200);
    const orgB = createdB.json<{ org_id: string }>().org_id;

    const missingOrg = await app.inject({
      method: 'GET',
      url: '/v1/query',
      headers: authHeaders()
    });
    expect(missingOrg.statusCode).toBe(400);

    const crossOrgQuery = await app.inject({
      method: 'GET',
      url: `/v1/query?trade_id=${encodeURIComponent(story.trade_id)}&limit=100`,
      headers: authHeaders(orgB)
    });
    expect(crossOrgQuery.statusCode).toBe(200);
    const crossOrgQueryBody = crossOrgQuery.json<{ objects: unknown[]; readiness_states: unknown[]; memory_events: unknown[] }>();
    expect(crossOrgQueryBody.objects).toHaveLength(0);
    expect(crossOrgQueryBody.readiness_states).toHaveLength(0);
    expect(crossOrgQueryBody.memory_events).toHaveLength(0);

    const crossOrgReplay = await app.inject({
      method: 'GET',
      url: `/v1/replay?trade_id=${encodeURIComponent(story.trade_id)}`,
      headers: authHeaders(orgB)
    });
    expect(crossOrgReplay.statusCode).toBe(404);

    const crossOrgGraph = await app.inject({
      method: 'POST',
      url: '/v1/utg/recall',
      headers: authHeaders(orgB),
      payload: { trade_id: story.trade_id }
    });
    expect(crossOrgGraph.statusCode).toBe(404);

    const ledgerProof = await app.inject({
      method: 'GET',
      url: `/v1/ledger/proofs?trade_id=${encodeURIComponent(story.trade_id)}`,
      headers: authHeaders(orgId)
    });
    expect(ledgerProof.statusCode).toBe(200);
    const ledgerProofBody = ledgerProof.json<{ bundle_url: string }>();

    const crossOrgProofByTrade = await app.inject({
      method: 'POST',
      url: '/v1/ledger/proofs/verify',
      headers: authHeaders(orgB),
      payload: { trade_id: story.trade_id }
    });
    expect(crossOrgProofByTrade.statusCode).toBe(404);

    const crossOrgProofByUrl = await app.inject({
      method: 'POST',
      url: '/v1/ledger/proofs/verify',
      headers: authHeaders(orgB),
      payload: { bundle_url: ledgerProofBody.bundle_url }
    });
    expect(crossOrgProofByUrl.statusCode).toBe(404);

    const crossOrgFile = await app.inject({
      method: 'GET',
      url: `/v1/files?org_id=${encodeURIComponent(orgB)}&url=${encodeURIComponent(ledgerProofBody.bundle_url)}&token=dev`
    });
    expect(crossOrgFile.statusCode).toBe(404);

    const approval = story.objects.find((object: any) => object.type === 'approval') as { object_id: string } | undefined;
    expect(approval?.object_id).toMatch(uuidPattern);
    const crossOrgApprovalDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approval!.object_id}/decision`,
      headers: authHeaders(orgB),
      payload: {
        decision: 'approved',
        notes: 'Cross-org approval should not see the protected action.',
        step_up_verified: true,
        residual_risks_acknowledged: true
      }
    });
    expect(crossOrgApprovalDecision.statusCode).toBe(404);

    const attachable = story.objects.find((object: any) => object.type === 'payment_intent') ?? story.objects[0];
    expect(attachable?.object_id).toMatch(uuidPattern);
    const crossOrgAttachment = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: authHeaders(orgB),
      payload: {
        object_id: attachable!.object_id,
        target: { type: 'trade_room', id: story.trade_id },
        mode: 'attach',
        reason: 'Cross-org attach should be blocked by RLS and scoped lookup.'
      }
    });
    expect(crossOrgAttachment.statusCode).toBe(404);

    const crossOrgApprovalRequest = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(orgB),
      payload: {
        target: { type: 'trade_room', id: story.trade_id },
        protected_action: 'send_payment',
        proposed_action: 'Cross-org approval request must not bind to another tenant trade.',
        step_up_required: true
      }
    });
    expect(crossOrgApprovalRequest.statusCode).toBe(404);

    const crossOrgExternalGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(orgB),
      payload: {
        target: { type: 'trade_room', id: story.trade_id },
        participant: { name: 'Wrong Tenant Viewer', email: 'wrong-tenant@example.com', role: 'buyer' },
        scopes: ['view_trade_summary'],
        reason: 'Cross-org external access must be blocked.'
      }
    });
    expect(crossOrgExternalGrant.statusCode).toBe(404);

    const crossOrgObjectWithTrade = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(orgB),
      payload: {
        title: 'Cross-org payment intent',
        origin_workspace: 'finance',
        trade_id: story.trade_id,
        payload: { amount: 1000, currency: 'EUR' }
      }
    });
    expect(crossOrgObjectWithTrade.statusCode).toBe(404);

    const crossOrgProofBundle = await app.inject({
      method: 'POST',
      url: '/v1/proofs/bundles',
      headers: authHeaders(orgB),
      payload: {
        trade_id: story.trade_id,
        object_ids: [story.proof_bundle.object_id],
        title: 'Cross-org proof bundle'
      }
    });
    expect(crossOrgProofBundle.statusCode).toBe(404);

    const crossOrgProofShare = await app.inject({
      method: 'POST',
      url: '/v1/proofs/share-requests',
      headers: authHeaders(orgB),
      payload: {
        proof_bundle_id: story.proof_bundle.object_id,
        recipient: { email: 'wrong-tenant@example.com', role: 'counterparty' },
        scopes: ['view_proof_summary'],
        reason: 'Cross-org proof sharing must be blocked.'
      }
    });
    expect(crossOrgProofShare.statusCode).toBe(404);

    const storyClearance = story.objects.find((object: any) => object.type === 'clearance_check') as { object_id: string } | undefined;
    if (storyClearance) {
      const crossOrgClearanceEval = await app.inject({
        method: 'POST',
        url: `/v1/clearance/checks/${storyClearance.object_id}/evaluate`,
        headers: authHeaders(orgB),
        payload: { rule_pack_id: 'EU-alpha', available_evidence: ['commercial_invoice'] }
      });
      expect(crossOrgClearanceEval.statusCode).toBe(404);
    }

    const networkCounterparty = await app.inject({
      method: 'POST',
      url: '/v1/objects/counterparty',
      headers: authHeaders(orgId),
      payload: {
        title: 'Cross-org network counterparty',
        origin_workspace: 'network',
        status: 'pending_input',
        payload: { role: 'buyer', country: 'ES' }
      }
    });
    expect(networkCounterparty.statusCode).toBe(200);
    const networkCounterpartyBody = networkCounterparty.json<{ object: { object_id: string } }>();
    const crossOrgNetworkTrust = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${networkCounterpartyBody.object.object_id}/trust-context`,
      headers: authHeaders(orgB),
      payload: { passport_visibility: 'internal' }
    });
    expect(crossOrgNetworkTrust.statusCode).toBe(404);
  });

  it('enforces role boundaries while preserving safe scoped external access', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Phase 6 RBAC Org', country: 'PT' }
    });
    expect(created.statusCode).toBe(200);
    const roleOrgId = created.json<{ org_id: string }>().org_id;

    const standalone = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'RBAC payment intent',
        summary: 'Standalone protected execution object for role hardening.',
        status: 'draft',
        origin_workspace: 'finance',
        payload: { amount: 12500, currency: 'EUR', beneficiary: 'RBAC Supplier' }
      }
    });
    expect(standalone.statusCode).toBe(200);
    const standaloneObject = standalone.json<{ object: { object_id: string } }>().object;

    await setCurrentUserRole(roleOrgId, 'member');
    const memberQuery = await app.inject({
      method: 'GET',
      url: '/v1/query?type=payment_intent&limit=20',
      headers: authHeaders(roleOrgId)
    });
    expect(memberQuery.statusCode).toBe(200);
    expect(memberQuery.json<{ objects: Array<{ object_id: string }> }>().objects.some((object) => object.object_id === standaloneObject.object_id)).toBe(true);

    const memberApproval = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'payment_intent', id: standaloneObject.object_id },
        protected_action: 'send_payment',
        proposed_action: 'Member should not request protected payment approval.',
        step_up_required: true
      }
    });
    expect(memberApproval.statusCode).toBe(403);

    const memberExternalGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'payment_intent', id: standaloneObject.object_id },
        participant: { name: 'Supplier Viewer', email: 'supplier@example.com', role: 'supplier' },
        scopes: ['view_payment_intent'],
        reason: 'Member should not grant external access.'
      }
    });
    expect(memberExternalGrant.statusCode).toBe(403);

    const memberExport = await app.inject({
      method: 'POST',
      url: '/v1/ledger/export',
      headers: authHeaders(roleOrgId),
      payload: { trade_ids: [standaloneObject.object_id] }
    });
    expect(memberExport.statusCode).toBe(403);

    await setCurrentUserRole(roleOrgId, 'auditor');
    const auditorCreate = await app.inject({
      method: 'POST',
      url: '/v1/objects/document',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Auditor write attempt',
        origin_workspace: 'clearance',
        payload: { note: 'Auditors should inspect proof, not mutate alpha objects.' }
      }
    });
    expect(auditorCreate.statusCode).toBe(403);

    await setCurrentUserRole(roleOrgId, 'ops');
    const opsApproval = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'payment_intent', id: standaloneObject.object_id },
        protected_action: 'send_payment',
        proposed_action: 'Ops can request protected approval but must keep human gates.',
        step_up_required: true
      }
    });
    expect(opsApproval.statusCode).toBe(200);
    const opsApprovalBody = opsApproval.json<{ approval: { object_id: string; status: string } }>();
    expect(opsApprovalBody.approval.status).toBe('approval_required');

    await setCurrentUserRole(roleOrgId, 'finance');
    const rejectedWithoutStepUp = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${opsApprovalBody.approval.object_id}/decision`,
      headers: authHeaders(roleOrgId),
      payload: { decision: 'rejected', notes: 'Finance rejects the protected payment before execution.' }
    });
    expect(rejectedWithoutStepUp.statusCode).toBe(200);
    const rejectedBody = rejectedWithoutStepUp.json<{ approval: { status: string }; execution_task: unknown | null }>();
    expect(rejectedBody.approval.status).toBe('rejected');
    expect(rejectedBody.execution_task).toBeNull();

    const manualAccount = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(roleOrgId),
      payload: {
        iban: 'PT50002700000001234567833',
        currency: 'EUR',
        name: 'RBAC manual execution account',
        bank_name: 'Scenario Manual Bank'
      }
    });
    expect(manualAccount.statusCode).toBe(200);
    const manualAccountBody = manualAccount.json<{ account_id: string }>();

    const executablePayment = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Approved payment intent',
        summary: 'Payment intent that can move into governed execution only after approval.',
        status: 'approval_required',
        origin_workspace: 'finance',
        payload: {
          amount: 12500,
          currency: 'EUR',
          beneficiary: 'RBAC Supplier',
          beneficiary_iban: 'PT50002700000001234567833',
          purpose: 'Supplier advance',
          protected_action: 'send_payment'
        }
      }
    });
    expect(executablePayment.statusCode).toBe(200);
    const executablePaymentObject = executablePayment.json<{ object: { object_id: string } }>().object;

    const executableApproval = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'payment_intent', id: executablePaymentObject.object_id },
        protected_action: 'send_payment',
        proposed_action: 'Execute supplier advance after finance approval and beneficiary checks.',
        evidence_refs: [{ object_id: executablePaymentObject.object_id, role: 'payment_intent' }],
        step_up_required: true
      }
    });
    expect(executableApproval.statusCode).toBe(200);
    const executableApprovalBody = executableApproval.json<{ approval: { object_id: string; status: string } }>();
    expect(executableApprovalBody.approval.status).toBe('approval_required');

    const blockedExecution = await app.inject({
      method: 'POST',
      url: `/v1/payments/intents/${executablePaymentObject.object_id}/execute`,
      headers: { ...authHeaders(roleOrgId), 'X-Idempotency-Key': 'idem-before-approval' },
      payload: {
        approval_id: executableApprovalBody.approval.object_id,
        route_id: 'r_manual',
        from_account_id: manualAccountBody.account_id
      }
    });
    expect(blockedExecution.statusCode).toBe(400);

    const executableDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${executableApprovalBody.approval.object_id}/decision`,
      headers: authHeaders(roleOrgId),
      payload: {
        decision: 'approved',
        step_up_verified: true,
        residual_risks_acknowledged: true,
        notes: 'Finance approves the governed payment execution path.'
      }
    });
    expect(executableDecision.statusCode).toBe(200);

    const executionPayload = {
      approval_id: executableApprovalBody.approval.object_id,
      route_id: 'r_manual',
      from_account_id: manualAccountBody.account_id
    };
    const executedPayment = await app.inject({
      method: 'POST',
      url: `/v1/payments/intents/${executablePaymentObject.object_id}/execute`,
      headers: { ...authHeaders(roleOrgId), 'X-Idempotency-Key': 'idem-approved-payment' },
      payload: executionPayload
    });
    expect(executedPayment.statusCode).toBe(200);
    const executedPaymentBody = executedPayment.json<{
      payment_intent: { status: string; payload_json: Record<string, any>; permissions_json: Record<string, any> };
      approval: { object_id: string; status: string };
      payment: { payment_id: string; status: string; scheme: string };
    }>();
    expect(executedPaymentBody.approval.status).toBe('approved');
    expect(executedPaymentBody.payment.status).toBe('created');
    expect(executedPaymentBody.payment.scheme).toBe('MANUAL_TRANSFER');
    expect(executedPaymentBody.payment_intent.status).toBe('in_progress');
    expect(executedPaymentBody.payment_intent.payload_json.payment_execution).toEqual(
      expect.objectContaining({
        payment_id: executedPaymentBody.payment.payment_id,
        approval_object_id: executableApprovalBody.approval.object_id,
        protected_action: 'send_payment',
        operator_confirmed: true,
        external_action_performed_by_traibox: false
      })
    );
    expect(executedPaymentBody.payment_intent.permissions_json.payment_execution_approved).toBe(true);

    const repeatedExecution = await app.inject({
      method: 'POST',
      url: `/v1/payments/intents/${executablePaymentObject.object_id}/execute`,
      headers: { ...authHeaders(roleOrgId), 'X-Idempotency-Key': 'idem-approved-payment' },
      payload: executionPayload
    });
    expect(repeatedExecution.statusCode).toBe(200);
    expect(repeatedExecution.json<{ payment: { payment_id: string } }>().payment.payment_id).toBe(executedPaymentBody.payment.payment_id);

    const paymentDetails = await app.inject({
      method: 'GET',
      url: `/v1/payments/${executedPaymentBody.payment.payment_id}`,
      headers: authHeaders(roleOrgId)
    });
    expect(paymentDetails.statusCode).toBe(200);
    expect(paymentDetails.json<{ creditor_name: string; amount: string | number }>().creditor_name).toBe('RBAC Supplier');

    await setCurrentUserRole(roleOrgId, 'ops');
    const task = await app.inject({
      method: 'POST',
      url: '/v1/execution/tasks',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Coordinate supplier evidence',
        target: { type: 'payment_intent', id: standaloneObject.object_id },
        assigned_to_role: 'ops',
        external_participant: {
          name: 'Supplier Viewer',
          email: 'supplier@example.com',
          role: 'supplier',
          scopes: ['view_task', 'submit_task_update', 'upload_requested_document']
        }
      }
    });
    expect(task.statusCode).toBe(200);
    const taskBody = task.json<{
      task: { object_id: string; payload_json: Record<string, unknown> };
      external_access_grant: { type: string; status: string; payload_json: Record<string, any>; permissions_json: Record<string, any> } | null;
      external_access_token?: string;
      external_access_url?: string;
    }>();
    expect(taskBody.task.payload_json.external_action_performed_by_traibox).toBe(false);
    expect(taskBody.external_access_grant?.type).toBe('external_access_grant');
    expect(taskBody.external_access_grant?.status).toBe('approved');
    expect(taskBody.external_access_grant?.permissions_json.external_access).toBe(true);
    expect(taskBody.external_access_grant?.payload_json.target).toEqual({ type: 'execution_task', id: taskBody.task.object_id });
    expect(taskBody.external_access_grant?.payload_json.scopes).toEqual(['view_task', 'submit_task_update', 'upload_requested_document']);
    expect(taskBody.external_access_token).toMatch(/^txp_/);
    expect(taskBody.external_access_url).toContain('/external-access?token=');

    const taskParticipantSession = await app.inject({
      method: 'GET',
      url: `/v1/external-participants/session?token=${encodeURIComponent(taskBody.external_access_token!)}`,
      headers: {}
    });
    expect(taskParticipantSession.statusCode).toBe(200);
    const taskParticipantSessionBody = taskParticipantSession.json<{ target: { object_id: string; type: string } | null; scopes: string[]; allowed_actions: string[]; participant: { role: string }; visible_objects: Array<{ object_id: string; type: string }> }>();
    expect(taskParticipantSessionBody.target?.object_id).toBe(taskBody.task.object_id);
    expect(taskParticipantSessionBody.target?.type).toBe('execution_task');
    expect(taskParticipantSessionBody.participant.role).toBe('supplier');
    expect(taskParticipantSessionBody.allowed_actions).toEqual(expect.arrayContaining(['view_execution_task', 'submit_task_update', 'submit_requested_document']));
    expect(taskParticipantSessionBody.visible_objects).toEqual(expect.arrayContaining([expect.objectContaining({ object_id: taskBody.task.object_id, type: 'execution_task' })]));

    const taskParticipantUpdate = await app.inject({
      method: 'POST',
      url: `/v1/external-participants/execution-tasks/${taskBody.task.object_id}/updates`,
      headers: {},
      payload: {
        token: taskBody.external_access_token,
        status: 'ready_for_review',
        note: 'Supplier has reviewed the scoped task and confirms requested evidence is being provided.'
      }
    });
    expect(taskParticipantUpdate.statusCode).toBe(200);
    const taskParticipantUpdateBody = taskParticipantUpdate.json<{ task: { status: string; payload_json: Record<string, any> } }>();
    expect(taskParticipantUpdateBody.task.status).toBe('ready_for_review');
    expect(taskParticipantUpdateBody.task.payload_json.external_participant_updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'ready_for_review', external_action_performed_by_traibox: false })])
    );

    const unsupportedScopeGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'execution_task', id: taskBody.task.object_id },
        participant: { email: 'unsafe@example.com', role: 'supplier' },
        scopes: ['view_task', 'send_payment'],
        reason: 'Unsupported protected-action-like scope must be rejected.'
      }
    });
    expect(unsupportedScopeGrant.statusCode).toBe(400);

    const expiredGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'execution_task', id: taskBody.task.object_id },
        participant: { email: 'expired@example.com', role: 'supplier' },
        scopes: ['view_task'],
        expires_at: '2024-01-01T00:00:00.000Z',
        reason: 'Expired external access grants must fail closed.'
      }
    });
    expect(expiredGrant.statusCode).toBe(400);

    const request = await app.inject({
      method: 'POST',
      url: '/v1/document-requests',
      headers: authHeaders(roleOrgId),
      payload: {
        task_id: taskBody.task.object_id,
        title: 'Upload beneficiary evidence',
        requested_items: ['supplier_invoice', 'beneficiary_iban_proof'],
        requested_from: {
          name: 'Supplier Viewer',
          email: 'supplier@example.com',
          role: 'supplier'
        }
      }
    });
    expect(request.statusCode).toBe(200);
    const requestBody = request.json<{
      request: { object_id: string; status: string };
      external_access_grant: { type: string; payload_json: Record<string, any> } | null;
      external_access_token?: string;
      external_access_url?: string;
    }>();
    expect(requestBody.request.status).toBe('pending_input');
    expect(requestBody.external_access_grant?.payload_json.target).toEqual({ type: 'document_request', id: requestBody.request.object_id });
    expect(requestBody.external_access_grant?.payload_json.scopes).toEqual(['view_document_request', 'upload_requested_document']);
    expect(requestBody.external_access_token).toMatch(/^txp_/);

    const requestSession = await app.inject({
      method: 'GET',
      url: `/v1/external-participants/session?token=${encodeURIComponent(requestBody.external_access_token!)}`,
      headers: {}
    });
    expect(requestSession.statusCode).toBe(200);
    const requestSessionBody = requestSession.json<{ target: { object_id: string; type: string; status: string } | null; allowed_actions: string[]; scopes: string[] }>();
    expect(requestSessionBody.target?.object_id).toBe(requestBody.request.object_id);
    expect(requestSessionBody.target?.type).toBe('document_request');
    expect(requestSessionBody.target?.status).toBe('pending_input');
    expect(requestSessionBody.allowed_actions).toEqual(expect.arrayContaining(['view_document_request', 'submit_requested_document']));

    const badTokenSession = await app.inject({
      method: 'GET',
      url: '/v1/external-participants/session?token=txp_invalid',
      headers: {}
    });
    expect(badTokenSession.statusCode).toBe(401);

    const otherRequest = await app.inject({
      method: 'POST',
      url: '/v1/document-requests',
      headers: authHeaders(roleOrgId),
      payload: {
        task_id: taskBody.task.object_id,
        title: 'Different document request',
        requested_items: ['different_evidence']
      }
    });
    expect(otherRequest.statusCode).toBe(200);
    const otherRequestBody = otherRequest.json<{ request: { object_id: string } }>();
    const wrongScopedSubmission = await app.inject({
      method: 'POST',
      url: `/v1/external-participants/document-requests/${otherRequestBody.request.object_id}/submissions`,
      headers: {},
      payload: {
        token: requestBody.external_access_token,
        filename: 'wrong-scope.txt',
        text: 'Attempt to submit to a request outside the grant target.'
      }
    });
    expect(wrongScopedSubmission.statusCode).toBe(403);

    const externalSubmission = await app.inject({
      method: 'POST',
      url: `/v1/external-participants/document-requests/${requestBody.request.object_id}/submissions`,
      headers: {},
      payload: {
        token: requestBody.external_access_token,
        filename: 'supplier-invoice-and-iban.txt',
        text: 'Supplier invoice INV-900 for RBAC payment intent. Supplier: RBAC Supplier. Beneficiary IBAN PT50002700000001234567833. Amount EUR 12500. Payment terms net 30.',
        submitted_by: {
          name: 'Supplier Viewer',
          email: 'supplier@example.com',
          role: 'supplier'
        }
      }
    });
    expect(externalSubmission.statusCode).toBe(200);
    const externalSubmissionBody = externalSubmission.json<{ request: { status: string; payload_json: Record<string, any> }; document: { type: string }; extraction_result: { type: string }; proof_bundle: { type: string } }>();
    expect(externalSubmissionBody.request.status).toBe('completed');
    expect(externalSubmissionBody.request.payload_json.submitted_by).toEqual(expect.objectContaining({ email: 'supplier@example.com', role: 'supplier' }));
    expect(externalSubmissionBody.document.type).toBe('document');
    expect(externalSubmissionBody.extraction_result.type).toBe('extraction_result');
    expect(externalSubmissionBody.proof_bundle.type).toBe('proof_bundle');

    const repeatedSubmission = await app.inject({
      method: 'POST',
      url: `/v1/external-participants/document-requests/${requestBody.request.object_id}/submissions`,
      headers: {},
      payload: {
        token: requestBody.external_access_token,
        filename: 'duplicate.txt',
        text: 'Duplicate submission should fail because the document request is terminal.'
      }
    });
    expect(repeatedSubmission.statusCode).toBe(400);

    const roleOrgActivity = await app.inject({
      method: 'GET',
      url: '/v1/query?type=external_access_grant&limit=20',
      headers: authHeaders(roleOrgId)
    });
    expect(roleOrgActivity.statusCode).toBe(200);
    const roleOrgActivityBody = roleOrgActivity.json<{ objects: Array<{ type: string }>; memory_events: Array<{ kind: string; signal: string }> }>();
    expect(roleOrgActivityBody.objects).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'external_access_grant' })]));
    expect(roleOrgActivityBody.memory_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'external_access.granted',
          signal: 'external_access.supplier'
        })
      ])
    );

    const externalUseActivity = await app.inject({
      method: 'GET',
      url: '/v1/query?limit=100',
      headers: authHeaders(roleOrgId)
    });
    expect(externalUseActivity.statusCode).toBe(200);
    const externalUseActivityBody = externalUseActivity.json<{ memory_events: Array<{ kind: string; signal: string; payload_json: Record<string, unknown> }> }>();
    expect(externalUseActivityBody.memory_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'payment.intent.execution',
          signal: 'payment.created'
        }),
        expect.objectContaining({
          kind: 'external_access.used',
          signal: 'external_access.document_submitted'
        })
      ])
    );

    const networkCounterparty = await app.inject({
      method: 'POST',
      url: '/v1/objects/counterparty',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Counterparty: Portal Components SL',
        origin_workspace: 'network',
        status: 'pending_input',
        payload: {
          name: 'Portal Components SL',
          role: 'supplier',
          country: 'ES',
          corridor: 'PT-ES',
          identifiers_missing: ['lei']
        }
      }
    });
    expect(networkCounterparty.statusCode).toBe(200);
    const networkCounterpartyBody = networkCounterparty.json<{ object: { object_id: string } }>();
    const networkOnboarding = await app.inject({
      method: 'POST',
      url: '/v1/objects/onboarding_flow',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Onboard Portal Components SL',
        origin_workspace: 'network',
        status: 'pending_input',
        payload: {
          counterparty_id: networkCounterpartyBody.object.object_id,
          required_fields: ['registration_number', 'authorized_contact', 'lei'],
          completed_fields: ['registration_number']
        },
        evidence_refs: [{ object_id: networkCounterpartyBody.object.object_id, role: 'counterparty' }]
      }
    });
    expect(networkOnboarding.statusCode).toBe(200);
    const networkOnboardingBody = networkOnboarding.json<{ object: { object_id: string } }>();
    const networkScreening = await app.inject({
      method: 'POST',
      url: '/v1/objects/screening_result',
      headers: authHeaders(roleOrgId),
      payload: {
        title: 'Screen Portal Components SL',
        origin_workspace: 'network',
        status: 'ready_for_review',
        payload: {
          counterparty_id: networkCounterpartyBody.object.object_id,
          sanctions: 'clear',
          pep: 'clear',
          adverse_media: 'none_found'
        },
        evidence_refs: [{ object_id: networkCounterpartyBody.object.object_id, role: 'counterparty' }]
      }
    });
    expect(networkScreening.statusCode).toBe(200);
    const networkScreeningBody = networkScreening.json<{ object: { object_id: string } }>();
    const networkTrust = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${networkCounterpartyBody.object.object_id}/trust-context`,
      headers: authHeaders(roleOrgId),
      payload: {
        onboarding_flow_id: networkOnboardingBody.object.object_id,
        screening_result_id: networkScreeningBody.object.object_id,
        passport_visibility: 'controlled_external',
        match_context: { corridor: 'PT-ES', domain: 'supplier' }
      }
    });
    expect(networkTrust.statusCode).toBe(200);
    const networkTrustBody = networkTrust.json<{ trade_passport: { object_id: string; type: string } }>();
    const passportGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'trade_passport', id: networkTrustBody.trade_passport.object_id },
        participant: {
          name: 'Portal Supplier Contact',
          email: 'portal-supplier@example.com',
          role: 'supplier'
        },
        scopes: ['view_trade_passport', 'submit_onboarding_evidence'],
        reason: 'Allow scoped supplier portal access to reusable Trade Passport onboarding evidence.'
      }
    });
    expect(passportGrant.statusCode).toBe(200);
    const passportGrantBody = passportGrant.json<{ access_token: string; grant: { object_id: string; payload_json: Record<string, any>; permissions_json: Record<string, any> } }>();
    expect(passportGrantBody.grant.payload_json.access_policy.policy_id).toBe('external-access-alpha-v1');
    expect(passportGrantBody.grant.permissions_json.external_scopes).toEqual(['view_trade_passport', 'submit_onboarding_evidence']);

    const incompatibleGrant = await app.inject({
      method: 'POST',
      url: '/v1/external-access/grants',
      headers: authHeaders(roleOrgId),
      payload: {
        target: { type: 'trade_passport', id: networkTrustBody.trade_passport.object_id },
        participant: { email: 'proof-scope@example.com', role: 'supplier' },
        scopes: ['view_artifact_manifest'],
        reason: 'Proof scopes must not be granted to Trade Passport targets.'
      }
    });
    expect(incompatibleGrant.statusCode).toBe(400);

    const passportSession = await app.inject({
      method: 'GET',
      url: `/v1/external-participants/session?token=${encodeURIComponent(passportGrantBody.access_token)}`,
      headers: {}
    });
    expect(passportSession.statusCode).toBe(200);
    const passportSessionBody = passportSession.json<{
      allowed_actions: string[];
      visible_objects: Array<{ object_id: string; type: string }>;
      portal_summary: { trust_score?: number; pending_actions: string[] };
    }>();
    expect(passportSessionBody.allowed_actions).toEqual(expect.arrayContaining(['view_trade_passport', 'submit_onboarding_evidence']));
    expect(passportSessionBody.portal_summary.pending_actions).toEqual(expect.arrayContaining(['submit_onboarding_evidence']));
    expect(passportSessionBody.visible_objects).toEqual(expect.arrayContaining([expect.objectContaining({ object_id: networkTrustBody.trade_passport.object_id, type: 'trade_passport' })]));
    expect(passportSessionBody.visible_objects).toEqual(expect.arrayContaining([expect.objectContaining({ object_id: networkCounterpartyBody.object.object_id, type: 'counterparty' })]));

    const wrongOnboardingSubmission = await app.inject({
      method: 'POST',
      url: '/v1/external-participants/onboarding-evidence',
      headers: {},
      payload: {
        token: requestBody.external_access_token,
        filename: 'wrong-onboarding-scope.txt',
        text: 'A document request token must not submit Trade Passport onboarding evidence.'
      }
    });
    expect(wrongOnboardingSubmission.statusCode).toBe(403);

    const onboardingSubmission = await app.inject({
      method: 'POST',
      url: '/v1/external-participants/onboarding-evidence',
      headers: {},
      payload: {
        token: passportGrantBody.access_token,
        filename: 'portal-onboarding-evidence.txt',
        text: 'Counterparty onboarding evidence for Portal Components SL. Registration number ES-B-88319921. Authorized contact Maria Alvarez. LEI 959800PORTALCOMPONENTS1.',
        evidence_type: 'counterparty_onboarding',
        completed_fields: ['authorized_contact', 'lei'],
        submitted_by: {
          name: 'Portal Supplier Contact',
          email: 'portal-supplier@example.com',
          role: 'supplier'
        }
      }
    });
    expect(onboardingSubmission.statusCode).toBe(200);
    const onboardingSubmissionBody = onboardingSubmission.json<{
      onboarding_flow?: { status: string; payload_json: Record<string, any> } | null;
      trade_passport?: { status: string } | null;
      document: { type: string };
      extraction_result: { type: string };
      proof_bundle: { type: string; status: string };
      readiness: { overall: string };
    }>();
    expect(onboardingSubmissionBody.onboarding_flow?.payload_json.completed_fields).toEqual(expect.arrayContaining(['registration_number', 'authorized_contact', 'lei']));
    expect(onboardingSubmissionBody.trade_passport?.status).toBe('ready_for_review');
    expect(onboardingSubmissionBody.document.type).toBe('document');
    expect(onboardingSubmissionBody.extraction_result.type).toBe('extraction_result');
    expect(onboardingSubmissionBody.proof_bundle.status).toBe('completed');

    const passportActivity = await app.inject({
      method: 'GET',
      url: '/v1/query?limit=160',
      headers: authHeaders(roleOrgId)
    });
    expect(passportActivity.statusCode).toBe(200);
    const passportActivityBody = passportActivity.json<{ memory_events: Array<{ kind: string; signal: string }> }>();
    expect(passportActivityBody.memory_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'external_access.used',
          signal: 'external_access.onboarding_evidence_submitted'
        })
      ])
    );

    const auditChain = await app.inject({
      method: 'GET',
      url: '/v1/governance/audit-chain?limit=500',
      headers: authHeaders(roleOrgId)
    });
    expect(auditChain.statusCode).toBe(200);
    const auditChainBody = auditChain.json<{ valid: boolean; checked_events: number; failures: unknown[]; head_hash?: string }>();
    expect(auditChainBody.valid).toBe(true);
    expect(auditChainBody.checked_events).toBeGreaterThan(0);
    expect(auditChainBody.failures).toHaveLength(0);
    expect(auditChainBody.head_hash).toEqual(expect.any(String));

    await setCurrentUserRole(roleOrgId, 'member');
    const memberAuditChain = await app.inject({
      method: 'GET',
      url: '/v1/governance/audit-chain?limit=50',
      headers: authHeaders(roleOrgId)
    });
    expect(memberAuditChain.statusCode).toBe(403);
    await setCurrentUserRole(roleOrgId, 'ops');

    const revokedPassportGrant = await app.inject({
      method: 'POST',
      url: `/v1/external-access/grants/${passportGrantBody.grant.object_id}/revoke`,
      headers: authHeaders(roleOrgId),
      payload: {
        reason: 'Scenario confirms revocation disables token while preserving audit and memory.'
      }
    });
    expect(revokedPassportGrant.statusCode).toBe(200);
    const revokedPassportGrantBody = revokedPassportGrant.json<{ grant: { status: string; payload_json: Record<string, any>; permissions_json: Record<string, any> }; revoked_tokens: number }>();
    expect(revokedPassportGrantBody.grant.status).toBe('cancelled');
    expect(revokedPassportGrantBody.grant.payload_json.external_access_status).toBe('revoked');
    expect(revokedPassportGrantBody.grant.permissions_json.external_access).toBe(false);
    expect(revokedPassportGrantBody.revoked_tokens).toBe(1);

    const revokedPassportSession = await app.inject({
      method: 'GET',
      url: `/v1/external-participants/session?token=${encodeURIComponent(passportGrantBody.access_token)}`,
      headers: {}
    });
    expect(revokedPassportSession.statusCode).toBe(403);
  });

  it('enforces lifecycle transition guards for protected alpha objects', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Lifecycle Guard Org', country: 'PT' }
    });
    expect(created.statusCode).toBe(200);
    const lifecycleOrgId = created.json<{ org_id: string }>().org_id;

    const invalidAttachedCreate = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        title: 'Invalid attached create',
        origin_workspace: 'finance',
        status: 'attached',
        payload: { amount: 1000, currency: 'EUR' }
      }
    });
    expect(invalidAttachedCreate.statusCode).toBe(400);

    const invalidApprovalCreate = await app.inject({
      method: 'POST',
      url: '/v1/objects/approval',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        title: 'Invalid approval create',
        origin_workspace: 'operations',
        status: 'draft',
        payload: { protected_action: 'send_payment' }
      }
    });
    expect(invalidApprovalCreate.statusCode).toBe(400);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        title: 'Lifecycle payment intent',
        origin_workspace: 'finance',
        status: 'draft',
        payload: { amount: 7200, currency: 'EUR' }
      }
    });
    expect(payment.statusCode).toBe(200);
    const paymentObject = payment.json<{ object: { object_id: string } }>().object;

    const parsed = await app.inject({
      method: 'POST',
      url: '/v1/trade/parse',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        intent_text: 'Lifecycle guard trade for attaching one standalone payment intent.',
        hints: { currency: 'EUR' }
      }
    });
    expect(parsed.statusCode).toBe(200);
    const tradeId = parsed.json<{ trade_id: string }>().trade_id;

    const firstAttach = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        object_id: paymentObject.object_id,
        target: { type: 'trade_room', id: tradeId },
        mode: 'attach',
        reason: 'Lifecycle guard first attach.'
      }
    });
    expect(firstAttach.statusCode).toBe(200);
    expect(firstAttach.json<{ object: { status: string } }>().object.status).toBe('attached');

    const repeatedAttach = await app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        object_id: paymentObject.object_id,
        target: { type: 'trade_room', id: tradeId },
        mode: 'attach',
        reason: 'Lifecycle guard repeated attach should fail.'
      }
    });
    expect(repeatedAttach.statusCode).toBe(400);

    const task = await app.inject({
      method: 'POST',
      url: '/v1/execution/tasks',
      headers: authHeaders(lifecycleOrgId),
      payload: {
        title: 'Lifecycle execution task',
        target: { type: 'payment_intent', id: paymentObject.object_id },
        assigned_to_role: 'ops'
      }
    });
    expect(task.statusCode).toBe(200);
    const taskBody = task.json<{ task: { object_id: string; status: string } }>();
    expect(taskBody.task.status).toBe('in_progress');

    const invalidTaskTransition = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${taskBody.task.object_id}/status`,
      headers: authHeaders(lifecycleOrgId),
      payload: {
        status: 'approval_required',
        note: 'Execution tasks should not jump to approval_required directly.'
      }
    });
    expect(invalidTaskTransition.statusCode).toBe(400);

    const blockedTask = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${taskBody.task.object_id}/status`,
      headers: authHeaders(lifecycleOrgId),
      payload: {
        status: 'blocked',
        execution_action: 'mark_blocked',
        note: 'Blocked pending missing operator information.'
      }
    });
    expect(blockedTask.statusCode).toBe(200);
    expect(blockedTask.json<{ task: { status: string } }>().task.status).toBe('blocked');

    const invalidBlockedCompletion = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${taskBody.task.object_id}/status`,
      headers: authHeaders(lifecycleOrgId),
      payload: {
        status: 'completed',
        note: 'Blocked tasks must resume before completion.',
        operator_confirmation: true,
        residual_risks_acknowledged: true
      }
    });
    expect(invalidBlockedCompletion.statusCode).toBe(400);

    const resumedTask = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${taskBody.task.object_id}/status`,
      headers: authHeaders(lifecycleOrgId),
      payload: {
        status: 'in_progress',
        execution_action: 'start_controlled_execution',
        note: 'Operator resumed controlled execution after resolving blocker.'
      }
    });
    expect(resumedTask.statusCode).toBe(200);
    expect(resumedTask.json<{ task: { status: string } }>().task.status).toBe('in_progress');
  });

  it('runs Intelligence Copilot and a governed replayable agent task', async () => {
    const intelligence = await app.inject({
      method: 'POST',
      url: '/v1/intelligence/run',
      headers: authHeaders(orgId),
      payload: {
        message: 'Prepare a payment intent and identify approval gates before execution.',
        workspace: 'intelligence'
      }
    });
    expect(intelligence.statusCode).toBe(200);
    const intelligenceBody = intelligence.json<{
      created_objects: Array<{ object_id: string; type: string }>;
      structured_outputs: Array<Record<string, unknown>>;
      trace_id: string;
    }>();
    expect(intelligenceBody.created_objects[0]?.type).toBe('payment_intent');
    expect(intelligenceBody.structured_outputs.some((output) => output.kind === 'workflow_classification')).toBe(true);
    expect(intelligenceBody.structured_outputs.some((output) => output.kind === 'execution_plan')).toBe(true);
    expect(intelligenceBody.structured_outputs.some((output) => output.kind === 'agent_task_draft')).toBe(true);
    expect(intelligenceBody.structured_outputs.some((output) => output.kind === 'ai_observability')).toBe(true);
    expect(intelligenceBody.structured_outputs.some((output) => output.kind === 'ai_eval_result')).toBe(true);
    expect(intelligence.json<{ eval_result: { type: string; payload_json: Record<string, unknown> } }>().eval_result.type).toBe('ai_eval_result');
    expect(intelligence.json<{ eval_result: { payload_json: Record<string, unknown> } }>().eval_result.payload_json.suite).toBe('intelligence-copilot-alpha-v1');

    const paymentId = intelligenceBody.created_objects[0]!.object_id;
    const approval = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(orgId),
      payload: {
        target: { type: 'payment_intent', id: paymentId },
        protected_action: 'send_payment',
        proposed_action: 'Approve prepared payment execution only after step-up and residual-risk acknowledgement.',
        evidence_refs: [{ object_id: paymentId, role: 'payment_intent' }],
        policy_refs: ['protected-actions-alpha-v1'],
        step_up_required: true,
        rationale: 'Payment execution is externally consequential.',
        approval_chain: [
          { key: 'finance_review', label: 'Finance review', required_role: 'finance', status: 'approval_required' },
          { key: 'ops_release', label: 'Operations release', required_role: 'ops', status: 'pending_input' }
        ],
        current_approval_step: 'finance_review'
      }
    });
    expect(approval.statusCode).toBe(200);
    const approvalBody = approval.json<{ approval: { object_id: string; payload_json: Record<string, unknown> } }>();
    expect(approvalBody.approval.payload_json.remaining_risks).toEqual(expect.arrayContaining(['wrong beneficiary']));

    const unsafeDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalBody.approval.object_id}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Trying to approve without required confirmations.',
        step_up_verified: false,
        residual_risks_acknowledged: false
      }
    });
    expect(unsafeDecision.statusCode).toBe(400);

    const firstStepDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalBody.approval.object_id}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Evidence reviewed, step-up completed, residual risks acknowledged.',
        step_up_verified: true,
        residual_risks_acknowledged: true,
        approval_step: 'finance_review'
      }
    });
    expect(firstStepDecision.statusCode).toBe(200);
    const firstStepBody = firstStepDecision.json<{ approval: { status: string; payload_json: Record<string, any> }; execution_task: { type: string } | null }>();
    expect(firstStepBody.approval.status).toBe('approval_required');
    expect(firstStepBody.execution_task).toBeNull();
    expect(firstStepBody.approval.payload_json.current_approval_step).toBe('ops_release');
    expect(firstStepBody.approval.payload_json.approval_chain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'finance_review', status: 'approved' }),
        expect.objectContaining({ key: 'ops_release', status: 'approval_required' })
      ])
    );

    const safeDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalBody.approval.object_id}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Operations release reviewed and residual risks remain acceptable.',
        step_up_verified: true,
        residual_risks_acknowledged: true,
        approval_step: 'ops_release'
      }
    });
    expect(safeDecision.statusCode).toBe(200);
    const safeDecisionBody = safeDecision.json<{ approval: { status: string }; execution_task: { type: string } | null }>();
    expect(safeDecisionBody.approval.status).toBe('approved');
    expect(safeDecisionBody.execution_task?.type).toBe('execution_task');
    const executionTaskId = (safeDecision.json<{ execution_task: { object_id: string } | null }>().execution_task?.object_id)!;

    const duplicateDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalBody.approval.object_id}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Trying to approve the same gate twice.',
        step_up_verified: true,
        residual_risks_acknowledged: true
      }
    });
    expect(duplicateDecision.statusCode).toBe(400);

    const unsafeExecutionCompletion = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${executionTaskId}/status`,
      headers: authHeaders(orgId),
      payload: {
        status: 'completed',
        execution_action: 'mark_external_completed',
        note: 'Trying to complete without operator confirmation.',
        operator_confirmation: false,
        residual_risks_acknowledged: false
      }
    });
    expect(unsafeExecutionCompletion.statusCode).toBe(400);

    const missingIdempotencyCompletion = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${executionTaskId}/status`,
      headers: authHeaders(orgId),
      payload: {
        status: 'completed',
        execution_action: 'mark_external_completed',
        note: 'Trying to complete a payment execution without idempotency proof.',
        operator_confirmation: true,
        residual_risks_acknowledged: true,
        external_reference: 'sandbox-payment-ref-missing-idem'
      }
    });
    expect(missingIdempotencyCompletion.statusCode).toBe(400);

    const safeExecutionCompletion = await app.inject({
      method: 'POST',
      url: `/v1/execution/tasks/${executionTaskId}/status`,
      headers: authHeaders(orgId),
      payload: {
        status: 'completed',
        execution_action: 'mark_external_completed',
        note: 'Operator completed the controlled external payment step manually.',
        operator_confirmation: true,
        residual_risks_acknowledged: true,
        external_reference: 'sandbox-payment-ref-001',
        idempotency_key: 'alpha-payment-idem-001'
      }
    });
    expect(safeExecutionCompletion.statusCode).toBe(200);
    const executionBody = safeExecutionCompletion.json<{ task: { status: string; payload_json: Record<string, unknown> } }>();
    expect(executionBody.task.status).toBe('completed');
    expect(executionBody.task.payload_json.external_action_performed_by_traibox).toBe(false);
    expect(executionBody.task.payload_json.operator_marked_external_action_completed).toBe(true);
    expect(executionBody.task.payload_json.execution_lifecycle).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'mark_external_completed' })]));

    const agent = await app.inject({
      method: 'POST',
      url: '/v1/agents/tasks',
      headers: authHeaders(orgId),
      payload: {
        objective: 'Review selected payment intent, prepare next action, and do not execute protected actions.',
        input_objects: [paymentId],
        permitted_tools: ['readiness.evaluate', 'proof.prepare', 'approvals.request'],
        data_access: ['selected_objects', 'organization_memory_l2'],
        write_permissions: ['create_agent_task', 'create_agent_work_result'],
        approval_gates: ['send_payment'],
        time_budget_seconds: 60
      }
    });
    expect(agent.statusCode).toBe(200);
    const agentBody = agent.json<{
      task: { agent_task_id: string; task_object_id?: string; status: string; replay_log: unknown[]; result: { outputs: Record<string, any> } };
      work_result: { object_id: string; type: string; status: string };
    }>();
    expect(agentBody.task.status).toBe('completed');
    expect(agentBody.task.task_object_id).toMatch(uuidPattern);
    expect(agentBody.task.replay_log.length).toBeGreaterThanOrEqual(5);
    expect(agentBody.task.replay_log).toEqual(expect.arrayContaining([expect.objectContaining({ step: 'scope.normalized' })]));
    expect(agentBody.task.result.outputs.runtime_policy).toEqual(
      expect.objectContaining({
        scope_version: 'agent-scope-alpha-v2',
        protected_actions_blocked: true,
        approval_gates: expect.arrayContaining(['send_payment'])
      })
    );
    expect(agentBody.work_result.type).toBe('agent_work_result');
    expect(agentBody.work_result.status).toBe('completed');
    expect(agent.json<{ eval_result: { type: string; payload_json: Record<string, unknown> } }>().eval_result.type).toBe('ai_eval_result');
    expect(agent.json<{ eval_result: { payload_json: Record<string, unknown> } }>().eval_result.payload_json.suite).toBe('governed-agent-alpha-v1');

    const deniedAgent = await app.inject({
      method: 'POST',
      url: '/v1/agents/tasks',
      headers: authHeaders(orgId),
      payload: {
        objective: 'Try to wire money without governance.',
        input_objects: [paymentId],
        permitted_tools: ['wire.money.now'],
        data_access: ['selected_objects'],
        write_permissions: ['create_agent_task', 'create_agent_work_result'],
        approval_gates: ['send_payment']
      }
    });
    expect(deniedAgent.statusCode).toBe(400);

    const query = await app.inject({
      method: 'GET',
      url: '/v1/query?origin_workspace=intelligence&type=agent_task&limit=20',
      headers: authHeaders(orgId)
    });
    expect(query.statusCode).toBe(200);
    const queryBody = query.json<{ objects: Array<{ object_id: string; type: string }> }>();
    expect(queryBody.objects.some((object) => object.object_id === agentBody.task.task_object_id)).toBe(true);

    const evalQuery = await app.inject({
      method: 'GET',
      url: '/v1/query?origin_workspace=intelligence&type=ai_eval_result&limit=20',
      headers: authHeaders(orgId)
    });
    expect(evalQuery.statusCode).toBe(200);
    const evalQueryBody = evalQuery.json<{ objects: Array<{ type: string; payload_json: Record<string, unknown> }> }>();
    expect(evalQueryBody.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_eval_result',
          payload_json: expect.objectContaining({
            status: 'pass',
            replayable: true
          })
        })
      ])
    );
  });
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authHeaders(orgId?: string) {
  return {
    Authorization: 'Bearer dev',
    ...(orgId ? { 'X-Org-Id': orgId } : {})
  };
}

function multipartDocumentPayload(input: {
  fields: Record<string, string>;
  filename: string;
  contentType: string;
  text: string;
}) {
  const boundary = `----traibox-alpha-${randomUUID()}`;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(input.fields)) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  chunks.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.filename}"\r\nContent-Type: ${input.contentType}\r\n\r\n${input.text}\r\n`
  );
  chunks.push(`--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.from(chunks.join(''), 'utf8')
  };
}

function assertLocalTestDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Refusing to reset non-local integration database: ${url.hostname}`);
  }
  if (!/test|traibox/i.test(url.pathname)) {
    throw new Error(`Refusing to reset database without test/traibox in name: ${url.pathname}`);
  }
}

function sampleTradeBrainEvalReport(suiteId: string): TradeBrainEvalReport {
  return {
    run_id: randomUUID(),
    generated_at: '2026-05-25T10:00:00Z',
    harness_version: 'trade-brain-eval-harness-alpha-v1',
    service_version: 'trade-brain-alpha-v0',
    suite_id: suiteId,
    case_count: 4,
    passed: 4,
    failed: 0,
    score: 100,
    status: 'pass',
    results: [
      {
        id: 'copilot_payment_intent',
        dataset: 'copilot_classification',
        kind: 'copilot_structure',
        tags: ['copilot', 'payment'],
        status: 'pass',
        checks: [{ case: 'object_type', status: 'pass', finding: 'Classified as payment_intent.' }],
        summary: { object_type: 'payment_intent', confidence: 0.82 }
      },
      {
        id: 'agent_payment_scope_aliases',
        dataset: 'agent_scope_safety',
        kind: 'agent_scope',
        tags: ['agent_scope', 'payment'],
        status: 'pass',
        checks: [{ case: 'approval_gates', status: 'pass', finding: 'send_payment gate present.' }],
        summary: { approval_gates: ['send_payment'], violations: [] }
      },
      {
        id: 'document_invoice_missing_trade_terms',
        dataset: 'document_intelligence',
        kind: 'document_intelligence',
        tags: ['document_intelligence', 'invoice', 'missing_fields'],
        status: 'pass',
        checks: [{ case: 'missing_fields', status: 'pass', finding: 'Detected missing invoice trade terms.' }],
        summary: {
          document_type: 'commercial_invoice',
          confidence: 0.84,
          missing_fields: ['buyer_tax_id', 'incoterm', 'payment_terms'],
          quality_signals: {
            document_type_detected: true,
            required_field_count: 7,
            extracted_field_count: 4,
            missing_field_count: 3,
            ready_for_readiness: false
          }
        }
      },
      {
        id: 'missing_proof_payment_approval_and_bundle',
        dataset: 'missing_proof_detection',
        kind: 'missing_proof_detection',
        tags: ['missing_proof', 'payment', 'protected_action'],
        status: 'pass',
        checks: [{ case: 'missing_items', status: 'pass', finding: 'Detected approval and proof bundle gaps.' }],
        summary: {
          overall: 'blocked',
          score: 68,
          missing_items: ['approval', 'proof_bundle'],
          quality_signals: {
            required_count: 5,
            available_count: 3,
            missing_count: 2,
            protected_approval_missing: true,
            proof_ready: false
          }
        }
      }
    ]
  };
}

async function setCurrentUserRole(orgId: string, role: string) {
  if (!TEST_DB_URL) throw new Error('ALPHA_INTEGRATION_DATABASE_URL is required');
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    await client.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', [role, orgId, DEV_USER_ID]);
  } finally {
    await client.end();
  }
}

async function resetDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

async function applyMigrations(connectionString: string) {
  const client = new pg.Client({ connectionString });
  const migrationsDir = path.join(findRepoRoot(), 'packages/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }));

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(current, 'packages/db/migrations');
    try {
      if (readdirSync(candidate).some((file) => file.endsWith('.sql'))) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate repo root from ${process.cwd()}`);
}
