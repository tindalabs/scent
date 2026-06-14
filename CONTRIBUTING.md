# Contributing to Scent

Thank you for your interest in contributing! This document covers everything you need to get started.

## Development setup

Scent is a pnpm monorepo managed with Turborepo. Node.js ≥ 18, pnpm ≥ 9, Docker, and Docker Compose are required.

```bash
git clone <repo-url>
cd scent
pnpm install
pnpm build
```

Start the local stack (Postgres, Redis, server):

```bash
cd infra && docker compose up -d
pnpm dev
```

## Workspace packages

| Package | Path | Description |
|---------|------|-------------|
| `@tindalabs/scent-engine` | `packages/engine` | Core identity resolution logic |
| `@tindalabs/scent-sdk` | `packages/sdk` | Browser SDK |
| `@tindalabs/scent-server` | `packages/server` | REST API server |

## Workflow

```bash
pnpm build         # build all packages
pnpm test          # run test suites
pnpm type-check    # TypeScript check
pnpm lint          # ESLint across all packages
pnpm format        # Prettier
```

To work on a specific package:

```bash
pnpm --filter @tindalabs/scent-sdk build
pnpm --filter @tindalabs/scent-server dev
```

### Running server tests against the local stack

The server integration suites talk to a real Postgres + Redis. If you have the full
docker-compose stack running, **stop the worker before running them**:

```bash
docker compose stop scent-worker
pnpm --filter @tindalabs/scent-server test
docker compose start scent-worker   # restore when done
```

`scent-worker` consumes the shared Redis `ingest` queue, so a running worker will pull
the test suite's enqueued jobs and resolve them into the tests' projects — polluting
fixtures and causing spurious failures. CI is unaffected (it uses isolated service
containers with no long-running worker).

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes with tests where appropriate.
3. Run `pnpm lint && pnpm test && pnpm build` locally.
4. Open a PR against `main` with a clear description of what changed and why.

## Reporting bugs

Open a GitHub issue. Include: browser/Node version, server version, a minimal reproduction, and the observed vs expected behaviour.

## Security vulnerabilities

**Do not open a public issue.** Email [ikerlaforga@gmail.com](mailto:ikerlaforga@gmail.com) instead. See [SECURITY.md](SECURITY.md).

## Code style

- TypeScript strict mode throughout.
- New signal collectors live under `packages/engine/src/collectors/` and must extend `BaseCollector`.
- Database migrations go in `packages/server/src/db/migrations/` as numbered SQL files.

## License

By contributing you agree that your work will be released under the [MIT License](LICENSE).
