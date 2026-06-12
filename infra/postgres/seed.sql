-- Demo project used by the local dev stack and the demo app.
-- The plaintext key is 'demo-api-key-dev' (matches VITE_API_KEY in
-- docker-compose.yml); only its SHA-256 hash is stored.
INSERT INTO projects (api_key_hash, name)
VALUES ('8d4ac96ea7089706ac61fff9192ba3297131ac52e04440265a495518689e8207', 'Demo Project')
ON CONFLICT (api_key_hash) DO NOTHING;
