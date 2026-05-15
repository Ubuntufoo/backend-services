# Services

This repository uses a phased monorepo model.

## Active Package

| Directory | Status | Purpose |
| --- | --- | --- |
| `services/sidecar` | Active | MCP server and canonical eBay integration runtime. |

## Planned Boundaries

| Directory | Status | Planned responsibility |
| --- | --- | --- |
| `services/watcher-service` | Planned | Consume asset events and trigger downstream workflows. |
| `services/image-service` | Planned | Image normalization, EXIF stripping, derivatives, and metadata extraction. |
| `services/r2-service` | Planned | Cloudflare R2 uploads, proxying, and signed URL issuance. |
| `services/gemini-service` | Planned | AI enrichment, validation, caching, and rate limiting around Gemini requests. |
| `services/ebay-service` | Planned | Shared eBay-domain orchestration that may be extracted from the sidecar later. |
| `services/job-runner` | Planned | Queue-backed jobs, retries, monitoring, and workflow execution. |

## Promotion Rules

A planned service should only become an active workspace package when all of the following are true:

1. It owns real runtime behavior that is no longer sidecar-local.
2. It has a concrete interface boundary, not just a future idea.
3. It includes build, lint, typecheck, and test coverage suitable for CI.
4. Its documentation explains env vars, commands, and integration expectations.

Until then, planned services remain documentation-only directories.

## Local Development

The active package is the sidecar:

```bash
pnpm install
pnpm dev
```

Docker-based local development also targets the sidecar:

```bash
docker-compose up --build sidecar
```

## Shared Infrastructure

- `docs/` remains shared for architecture notes, auth docs, and API status snapshots.
- `scripts/verify-canonical-layout.mjs` guards against duplicate runtime ownership.
- The root `package.json` orchestrates workspace commands but does not own app code.
