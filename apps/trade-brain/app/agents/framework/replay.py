"""Deterministic replay/event log (directive B7).

Events carry a monotonic sequence and stable field ordering so two runs over
identical inputs produce identical logs (timestamps come from an injectable
clock; tests pin it).
"""

from __future__ import annotations

from typing import Any, Callable


class ReplayLog:
    def __init__(self, trace_id: str, clock: Callable[[], str] | None = None) -> None:
        self._trace_id = trace_id
        self._clock = clock
        self._seq = 0
        self._events: list[dict[str, Any]] = []

    def append(self, step: str, **fields: Any) -> dict[str, Any]:
        self._seq += 1
        event: dict[str, Any] = {"seq": self._seq, "step": step, "trace_id": self._trace_id}
        if self._clock is not None:
            event["at"] = self._clock()
        event.update(dict(sorted(fields.items())))
        self._events.append(event)
        return event

    @property
    def events(self) -> list[dict[str, Any]]:
        return list(self._events)
