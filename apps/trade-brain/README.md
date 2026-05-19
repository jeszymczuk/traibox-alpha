# TRAIBOX Trade Brain

Python FastAPI service boundary for the alpha intelligence plane.

This service is intentionally thin in the internal alpha. It exposes stable boundaries for:

- Copilot workflow structuring.
- Governed scoped agent policy.
- AI eval logging.
- Deterministic replay previews.

The TypeScript API keeps a deterministic local fallback. Set `TRADE_BRAIN_URL=http://localhost:8010` to route `/v1/intelligence/run` through this service boundary.

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
