# TRAIBOX Trade Brain

Python FastAPI service boundary for the alpha intelligence plane.

This service is intentionally thin in the internal alpha. It exposes stable boundaries for:

- Copilot workflow structuring.
- Governed scoped agent policy.
- Document intelligence and missing-proof checks.
- AI eval logging.
- Deterministic replay previews.

The TypeScript API keeps a deterministic local fallback. Set `TRADE_BRAIN_URL=http://localhost:8010` to route alpha intelligence flows through this service boundary:

- `/v1/copilot/structure` for Copilot workflow classification and structured outputs.
- `/v1/agents/scope` for governed scoped agent runtime policy.
- `/v1/documents/intelligence` for document classification, field extraction, missing fields, confidence, and provenance.
- `/v1/proofs/missing` for proof-gap detection, readiness/proof quality signals, risks, and next actions.
- `/v1/replay/build` for deterministic replay previews.
- `/v1/evals/run` for eval payload generation and normalization.

## Local Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

## Tests

The core tests use only the Python standard library so they can run before FastAPI dependencies are installed:

```bash
PYTHONPATH=apps/trade-brain python3 -m unittest discover -s apps/trade-brain/tests
```

## Eval Harness

Versioned JSONL eval suites live in `apps/trade-brain/evals`. Current alpha suites cover Copilot classification, scoped agent safety, document intelligence, missing-proof detection, replay, and eval payload quality.

Run the full regression gate:

```bash
pnpm eval:trade-brain
```

Run the CI/release gate and write the durable report artifact:

```bash
pnpm eval:trade-brain:ci
```

The CI artifact is written to `artifacts/trade-brain-evals/latest.json` and uploaded by GitHub Actions as `trade-brain-eval-report`.

List suites:

```bash
PYTHONPATH=apps/trade-brain python3 -m app.eval_harness --list
```

Run one suite:

```bash
PYTHONPATH=apps/trade-brain python3 -m app.eval_harness --suite copilot_classification
```

When the FastAPI service is running, eval suites are also available through:

- `GET /v1/evals/suites`
- `POST /v1/evals/suites/run` with `{ "suite_id": "all" }`

The TRAIBOX API can persist those service reports as product artifacts:

- `GET /v1/evals/trade-brain/suites`
- `POST /v1/evals/trade-brain/run` with `{ "suite_id": "all", "persist": true }`
- `GET /v1/evals/trade-brain/runs`

Persisted reports create an `ai_eval_result` alpha object, an `alpha_eval_runs` row, an L2 memory event, an audit event, and an Operations Center event.
