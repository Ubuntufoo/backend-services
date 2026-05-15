Backend Services (backend-services)

Overview

This repository provides the server-side components for the eBay Inventory Manager. The codebase follows a phased monorepo model tuned for a local-only, single-user workflow:

- `services/sidecar` is the only implemented runtime package today.
- Other responsibilities are planned boundaries and should stay inside the sidecar or the main app until real extraction pressure exists.

Service layout

backend-services/
services/
  sidecar/          # canonical MCP + eBay runtime package
docs/              # architecture, auth, and boundary notes

Responsibilities and contract

- `sidecar`: owns the MCP server, eBay auth flow, tool definitions, HTTP transport, setup scripts, and the full active test suite.
- `watcher-service`: planned boundary for local or Supabase-driven asset events and follow-up work.
- `image-service`: planned boundary for image transforms, thumbnail generation, and metadata extraction.
- `r2-service`: planned boundary for Cloudflare R2 storage interactions and signed URL issuance.
- `gemini-service`: planned boundary for Gemini requests, validation, caching, and rate limiting.
- `ebay-service`: planned boundary for shared eBay-domain workflows if they become large enough to extract from the sidecar.
- `job-runner`: planned boundary for retries, scheduling, and background workflows if app- or Supabase-driven automation stops being enough.

Repo rules

- Treat `services/sidecar` as the only canonical runtime package until another service is explicitly promoted.
- Do not reintroduce a root `src/`, `tests/`, or `public/` tree. The repo root is orchestration-only.
- Do not add placeholder service `package.json` or `tsconfig.json` files just to reserve names. Planned boundaries stay documentation-only until implementation begins.
- Root scripts should orchestrate workspace commands or repo guardrails only.
- Prefer one local Node process plus hosted Supabase over local container stacks or extra worker processes.
- Only extract a new service when the boundary needs a separate deployment, lifecycle, scaling profile, or security context.

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
