## Repo Overview

Murphy Family Hobby's eBay Inventory Manager — a local-first desktop/web app for creating and managing eBay listings.
This repository provides the server-side components for the eBay Inventory Manager. The backend holds long-running, platform-level responsibilities that are intentionally separated from the UI. ROADMAP.md is a rolling plan for the project's dev. When altered, commit the changes to new feature branches.

## Responsibilities and Contract

- `watcher-service`: consumes local or Supabase-driven events about new assets, stores records in Supabase, and enqueues jobs for `image-service` and `r2-service`.
- `image-service`: performs safe image operations (resize, strip EXIF, generate thumbnails), writes derivatives to local storage and/or forwards to `r2-service` for upload.
- `r2-service`: encapsulates Cloudflare R2 interactions and returns signed URLs or serves proxied assets when required.
- `gemini-service`: wraps calls to Gemini with request/response validation, caching, and rate-limiting; produces structured JSON used to populate listing drafts.
- `ebay-service`: centralizes eBay OAuth token management, publish and inventory endpoints, error handling, and sandbox/test mode toggles.
- `job-runner`: executes background jobs (publish, sync, retry) and exposes HTTP endpoints for enqueueing and monitoring.

## Assessment of Current Repo Structure

- The repository already contains `src/api`, `src/auth`, `src/mcp`, `src/utils` and a `server-http.ts` entrypoint — these map well to a sidecar-style service. Splitting into the proposed micro-services can be implemented as:
  - A single-process sidecar with modular folders (current codebase), or
  - A small monorepo with each service under `services/` (recommended for separation and independent scaling).
- For local development, a monorepo with `docker-compose` or `pnpm` workspaces simplifies running the UI + backend-services together.

## MCP Usage Contract

The sidecar is the canonical local runtime for eBay API access and MCP tool exposure.

### Purpose

Use `services/sidecar` when an assistant or local tool needs to:

- access eBay APIs
- expose eBay-related MCP tools
- run local HTTP endpoints for development/testing
- centralize eBay auth, env loading, and API behavior

Do not duplicate eBay API logic in the UI package.

### Transport Modes

The sidecar supports two local modes:

| Mode         | Command                          | Use case                               |
| ------------ | -------------------------------- | -------------------------------------- |
| MCP stdio    | `pnpm dev:stdio`                 | Local assistant/MCP client integration |
| HTTP sidecar | `pnpm dev` or `pnpm dev:sidecar` | Browser/UI/API testing                 |

Use stdio for MCP clients. Use HTTP when the frontend or local scripts need REST-style access.

### Startup Contract

Start the sidecar from the repo root using the documented package scripts.

Do not invoke TypeScript entry files directly unless debugging. Use the package scripts so env loading, tsx/runtime behavior, and workspace resolution stay consistent.

### Environment Contract

The sidecar owns eBay runtime configuration, including:

- eBay credentials
- marketplace settings
- auth/token behavior
- local runtime mode settings

The UI should call the sidecar or database contract; it should not own eBay credentials.

### Assistant Connection Contract

Local assistants should connect to the sidecar MCP server over stdio.

The assistant should:

- start the sidecar using the repo-root command
- treat the sidecar as the canonical eBay tool provider
- avoid bypassing the sidecar with direct eBay SDK/API calls
- use HTTP mode only for local app/runtime integration, not MCP tool transport

### Source of Truth

For sidecar usage:

1. `AGENTS.md` defines the assistant/contributor contract.
2. `services/sidecar/README.md` defines operational setup.
3. `README.md` only points readers to the correct docs.

## Run & Local Dev

- Example: run the sidecar locally from the repo root:

```bash
pnpm install
pnpm dev
```

- Or run individual services via workspaces / `node ./services/<service>/index.js` after splitting into `services/`.

## Security

- Keep service credentials out of source control and restrict sidecar endpoints to localhost in development.
- Use service-level API keys or mTLS for production communication between UI and backend services.
