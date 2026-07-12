from __future__ import annotations

import hmac
import os
from collections.abc import Mapping


_TRUTHY = {"1", "true", "yes", "on"}


def service_auth_required(env: Mapping[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    return source.get("TRADE_BRAIN_REQUIRE_AUTH", "").strip().lower() in _TRUTHY


def validate_service_auth_configuration(env: Mapping[str, str] | None = None) -> None:
    source = env if env is not None else os.environ
    token = source.get("TRADE_BRAIN_SERVICE_TOKEN", "").strip()
    if service_auth_required(source) and len(token) < 32:
        raise RuntimeError("TRADE_BRAIN_SERVICE_TOKEN must contain at least 32 characters when service auth is required")


def service_request_authorized(authorization: str | None, env: Mapping[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    expected = source.get("TRADE_BRAIN_SERVICE_TOKEN", "").strip()
    if not expected:
        return not service_auth_required(source)
    if not authorization or not authorization.startswith("Bearer "):
        return False
    supplied = authorization.removeprefix("Bearer ").strip()
    return bool(supplied) and hmac.compare_digest(supplied, expected)
