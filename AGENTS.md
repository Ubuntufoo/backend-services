Backend Services (backend-services)

Overview

This repository provides the server-side components for the eBay Inventory Manager. The backend holds long-running, platform-level responsibilities that are intentionally separated from the UI.

Proposed service layout

backend-services/
sidecar/
watcher-service # listens for asset events and enqueues processing
image-service # image transforms, thumbnails, and metadata extraction
r2-service # Cloudflare R2 upload helpers & signed URL issuance
gemini-service # adapter/proxy to Gemini AI for image analysis & generation
ebay-service # eBay API client layer: OAuth, publish, inventory, orders
job-runner # worker queue and retry/backoff logic for publishes and syncs

Responsibilities and contract

- `watcher-service`: consumes local or Supabase-driven events about new assets, stores records in Supabase, and enqueues jobs for `image-service` and `r2-service`.
- `image-service`: performs safe image operations (resize, strip EXIF, generate thumbnails), writes derivatives to local storage and/or forwards to `r2-service` for upload.
- `r2-service`: encapsulates Cloudflare R2 interactions and returns signed URLs or serves proxied assets when required.
- `gemini-service`: wraps calls to Gemini with request/response validation, caching, and rate-limiting; produces structured JSON used to populate listing drafts.
- `ebay-service`: centralizes eBay OAuth token management, publish and inventory endpoints, error handling, and sandbox/test mode toggles.
- `job-runner`: executes background jobs (publish, sync, retry) and exposes HTTP endpoints for enqueueing and monitoring.

Assessment of current repo structure

- The repository already contains `src/api`, `src/auth`, `src/mcp`, `src/utils` and a `server-http.ts` entrypoint — these map well to a sidecar-style service. Splitting into the proposed micro-services can be implemented as:
  - A single-process sidecar with modular folders (current codebase), or
  - A small monorepo with each service under `services/` (recommended for separation and independent scaling).
- For local development, a monorepo with `docker-compose` or `pnpm` workspaces simplifies running the UI + backend-services together.

Recommendations

- Rename repository to `backend-services` for clarity. If you prefer a monorepo, create `services/` and move each service into its own package with clear `package.json` scripts.
- Keep Supabase as the canonical data store; services should operate idempotently against Supabase events and expose HTTP endpoints for UI-triggered actions.
- Start with a single sidecar binary (existing `server-http.ts`) that implements `watcher`, `r2`, and `ebay` responsibilities, then extract `gemini` and `job-runner` into separate services as needed.
- Add small `README.md` files under each service describing run commands and env vars.

Run & local dev

- Example: run the sidecar locally from the repo root:

```bash
pnpm install
pnpm dev
```

- Or run individual services via workspaces / `node ./services/<service>/index.js` after splitting into `services/`.

Env vars (examples)

- `SIDECAR_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GEMINI_API_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_OAUTH_REDIRECT`

Security

- Keep service credentials out of source control and restrict sidecar endpoints to localhost in development.
- Use service-level API keys or mTLS for production communication between UI and backend services.
