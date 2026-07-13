"""Canonical deterministic hashing (directive B4).

Canonical form: sorted keys, normalized decimal strings, ISO dates, uppercase
currency codes, explicit null (missing keys are omitted BEFORE hashing by the
engine's normalization — null and absent are distinct at the model layer),
no locale formatting. Same normalized input + calculator/formula version ⇒
same input hash, across processes.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from .decimal_policy import serialize_decimal


def _canonize(value: Any) -> Any:
    if isinstance(value, Decimal):
        return {"$dec": serialize_decimal(value)}
    if isinstance(value, datetime):
        return {"$dt": value.isoformat()}
    if isinstance(value, date):
        return {"$date": value.isoformat()}
    if isinstance(value, dict):
        return {key: _canonize(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonize(item) for item in value]
    if isinstance(value, float):
        # Valid financial values never reach hashing as floats (the model
        # boundary rejects them); this branch exists so REJECTED inputs can
        # still be hashed deterministically for audit, tagged explicitly.
        return {"$float": repr(value)}
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(_canonize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sort_unordered_paths(data: dict[str, Any], unordered_paths: tuple[str, ...]) -> dict[str, Any]:
    """§6.3: canonically sort ONLY lists whose order is semantically
    meaningless (declared per calculator). Ordered lists (e.g. cash-flow
    sequences) are never globally sorted."""
    if not unordered_paths:
        return data
    import copy

    result = copy.deepcopy(data)
    for path in unordered_paths:
        parts = path.split(".")
        current: Any = result
        for part in parts[:-1]:
            if not isinstance(current, dict) or part not in current:
                current = None
                break
            current = current[part]
        if isinstance(current, dict):
            leaf = parts[-1]
            value = current.get(leaf)
            if isinstance(value, list):
                current[leaf] = sorted(value, key=canonical_json)
    return result


def deterministic_hash(value: Any, *, calculator_id: str = "", calculator_version: str = "", formula_version: str = "") -> str:
    payload = canonical_json({"calc": calculator_id, "calc_v": calculator_version, "formula_v": formula_version, "data": value})
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
