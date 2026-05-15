-- Demo project used by the local dev stack and the demo app.
-- api_key matches VITE_API_KEY in docker-compose.yml.
INSERT INTO projects (api_key, name)
VALUES ('demo-api-key-dev', 'Demo Project')
ON CONFLICT (api_key) DO NOTHING;
