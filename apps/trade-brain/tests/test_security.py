from __future__ import annotations

import unittest

from app.security import service_auth_required, service_request_authorized, validate_service_auth_configuration


class TradeBrainServiceAuthTest(unittest.TestCase):
    def test_allows_local_requests_when_service_auth_is_not_configured(self) -> None:
        env: dict[str, str] = {}

        self.assertFalse(service_auth_required(env))
        self.assertTrue(service_request_authorized(None, env))

    def test_requires_a_strong_token_when_service_auth_is_enabled(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "at least 32 characters"):
            validate_service_auth_configuration({"TRADE_BRAIN_REQUIRE_AUTH": "true", "TRADE_BRAIN_SERVICE_TOKEN": "short"})

    def test_compares_bearer_tokens_without_accepting_missing_or_wrong_values(self) -> None:
        token = "service-token-with-at-least-thirty-two-characters"
        env = {"TRADE_BRAIN_REQUIRE_AUTH": "true", "TRADE_BRAIN_SERVICE_TOKEN": token}

        validate_service_auth_configuration(env)
        self.assertFalse(service_request_authorized(None, env))
        self.assertFalse(service_request_authorized("Bearer wrong-token", env))
        self.assertTrue(service_request_authorized(f"Bearer {token}", env))


if __name__ == "__main__":
    unittest.main()
