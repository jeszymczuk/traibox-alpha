"""Evidence policy (Phase 2 scaffold).

Phase 2 carries the policy contract; claim/bundle PERSISTENCE lives in the
TypeScript API layer (Phase 1 tables) and outcome-level evidence assembly
arrives with Phase 4. The invariant this module pins now: material numeric
values must trace to deterministic calculation runs — the LLM is never an
authoritative calculator.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EvidencePolicy:
    policy_id: str = "default"
    material_values_require_calculation_run: bool = True
    unknown_stays_unknown: bool = True
    contradictions_stay_visible: bool = True
