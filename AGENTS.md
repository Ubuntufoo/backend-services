Backend Services (backend-services)

Overview

This repository provides the server-side components for the eBay Inventory Manager. The codebase follows a phased monorepo model:

- `services/sidecar` is the only implemented runtime package today.
- The other service directories document intended boundaries and should not be treated as active packages until they own real behavior.

Service layout

backend-services/
services/
  sidecar/          # canonical MCP + eBay runtime package
  watcher-service/  # planned asset event ingestion
  image-service/    # planned image transforms and metadata extraction
  r2-service/       # planned Cloudflare R2 adapter
  gemini-service/   # planned Gemini adapter/proxy
  ebay-service/     # planned eBay-domain extraction target
  job-runner/       # planned background jobs and retries
docs/              # architecture, auth, and boundary notes

Responsibilities and contract

- `sidecar`: owns the MCP server, eBay auth flow, tool definitions, HTTP transport, setup scripts, and the full active test suite.
- `watcher-service`: will consume local or Supabase-driven asset events and enqueue follow-up work.
- `image-service`: will own image transforms, thumbnail generation, and metadata extraction.
- `r2-service`: will encapsulate Cloudflare R2 storage interactions and signed URL issuance.
- `gemini-service`: will wrap Gemini requests with validation, caching, and rate limiting.
- `ebay-service`: will own shared eBay-domain workflows if they become large enough to extract from the sidecar.
- `job-runner`: will execute background jobs, retries, and monitoring workflows.

Repo rules

- Treat `services/sidecar` as the only canonical runtime package until another service is explicitly promoted.
- Do not reintroduce a root `src/`, `tests/`, or `public/` tree. The repo root is orchestration-only.
- Do not add placeholder service `package.json` or `tsconfig.json` files just to reserve names. Planned services stay documentation-only until implementation begins.
- Root scripts should orchestrate workspace commands or repo guardrails only.

Run & local dev

- Run the active package from the repo root:

```bash
pnpm install
pnpm dev
```

- Sidecar-specific commands are available through root passthrough scripts:

```bash
pnpm setup
pnpm diagnose
pnpm sync
```

Security

- Keep runtime credentials out of source control.
- Restrict local-only endpoints to localhost in development.
- Use service-to-service authentication before promoting planned services into deployable runtime packages.
