# Backend Services

This repository is the backend monorepo for the eBay Inventory Manager. It is intentionally in a phased state:

- `services/sidecar` is the only implemented runtime package today.
- The other service directories are planning placeholders that document future boundaries without pretending to be production-ready packages.

## Current Status

| Service | Status | Notes |
| --- | --- | --- |
| `sidecar` | Implemented | Canonical MCP/eBay server package with tests, linting, and Docker support. |
| `watcher-service` | Planned | Event ingestion and workflow triggering. |
| `image-service` | Planned | Image transforms, metadata extraction, and thumbnail generation. |
| `r2-service` | Planned | Cloudflare R2 uploads and signed URL issuance. |
| `gemini-service` | Planned | Gemini-backed enrichment and structured listing analysis. |
| `ebay-service` | Planned | Shared eBay-specific domain workflows beyond the sidecar. |
| `job-runner` | Planned | Background jobs, retries, and queue orchestration. |

## Canonical Layout

```text
backend-services/
  services/
    sidecar/              # Active package
    watcher-service/      # Planned boundary
    image-service/        # Planned boundary
    r2-service/           # Planned boundary
    gemini-service/       # Planned boundary
    ebay-service/         # Planned boundary
    job-runner/           # Planned boundary
  docs/                   # Shared reference material
  scripts/                # Repo-level guardrails
```

The root package is orchestration-only. It does not own application runtime code.

## Workspace Commands

From the repo root:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm check
pnpm dev
```

These commands target the canonical `services/sidecar` package through the workspace configuration.

## Sidecar

End-user setup, local development, and MCP-specific usage now live in [services/sidecar/README.md](services/sidecar/README.md).

Useful root-level convenience commands:

```bash
pnpm setup
pnpm diagnose
pnpm sync
pnpm update:api-status
pnpm dev:sidecar
```

## Guardrails

- The repo-level layout check fails if a duplicate root runtime tree or placeholder service package manifests reappear.
- Only `services/sidecar` participates in active CI validation.
- Planned services should be documented first, then promoted into workspace packages when they have real behavior and tests.

## Related Docs

- [SERVICES.md](SERVICES.md) for service responsibilities and promotion criteria
- [AGENTS.md](AGENTS.md) for architecture intent and implementation boundaries
- [docs/API_STATUS.md](docs/API_STATUS.md) for the current eBay API status snapshot
