-- Manual fallback for EU pilots:
-- Allows creating "manual" bank accounts and executing "manual" payment routes
-- when AIS/PIS is not available for a given bank/country.

INSERT INTO bank_providers(provider_id, name, type, status)
  VALUES ('manual', 'Manual bank transfer', 'manual', 'active')
  ON CONFLICT DO NOTHING;

