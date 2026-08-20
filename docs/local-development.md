# Local Development

## Environment

- Copy `.env.example` to the repo root as `.env` on first setup, then fill the
  required Supabase values and any credentials for the services you will run.
- Sidecar and setup code read the repo-root `.env` only; the watcher CLI also
  overlays the repo-root `.env.local`. `services/sidecar/.env` is not loaded.
- `EBAY_ENABLED=false` disables eBay client/tool creation and eBay credential
  requirements. It does not disable HTTP authentication.
- `OAUTH_ENABLED=false` disables OAuth protection for the HTTP MCP transport and
  `/api` routes. It does not disable eBay tools or eBay API calls.
- For DB-only local work, set both `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`.
- The HTTP sidecar job runner is opt-in. Leave
  `SIDECAR_JOB_RUNNER_ENABLED=false` (or unset) during ordinary development;
  set it to `true` only when background job polling is intentional.

## Root Commands

```bash
pnpm install
pnpm validate:env
pnpm dev
pnpm dev:sidecar:stdio
pnpm setup
```

Run `pnpm setup` only when configuring eBay credentials/OAuth; it is an
interactive wizard that persists the resulting eBay values into the repo-root
`.env`. It is not required for a DB-only sidecar with `EBAY_ENABLED=false`.

## Service Commands

| Area | Command |
| --- | --- |
| Sidecar HTTP | `pnpm dev` or `pnpm dev:sidecar` |
| Sidecar MCP stdio | `pnpm dev:sidecar:stdio` |
| Sidecar prod-style start | `pnpm --filter sidecar start` |
| Watcher dev | `pnpm --filter @ebay-inventory/watcher-service dev` |
| Watcher start | `pnpm --filter @ebay-inventory/watcher-service start` |
| Image service validation | `pnpm --filter @ebay-inventory/image-service check` |
| Companion GPT-MCP-Local connect | Run `npm run connect` from the companion `gpt-repo-mcp` repository; `connect` is not a script in this backend repo. |

## Validation

```bash
pnpm check
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter sidecar typecheck
pnpm --filter sidecar test
pnpm --filter @ebay-inventory/watcher-service check
pnpm --filter @ebay-inventory/image-service check
```

## Notes

- `pnpm dev` starts `services/sidecar/src/server-http.ts`. Its code default is
  `http://localhost:3000`; the checked-in `.env.example` sets `MCP_PORT=3001`.
  `MCP_HOST` and `MCP_PORT` override the code defaults.
- HTTP MCP is served at `/`; health is `/health`; data routes are mounted at
  `/api`. OAuth is enabled unless `OAUTH_ENABLED=false`.
- `pnpm dev:sidecar:stdio` starts `services/sidecar/src/index.ts` for MCP
  clients over stdio; HTTP OAuth settings do not apply to stdio.
- Sidecar job-runner loop starts only when `SIDECAR_JOB_RUNNER_ENABLED=true`.
- Do not expose an HTTP sidecar with `OAUTH_ENABLED=false` beyond a trusted
  local boundary; the MCP and `/api` surfaces are then unauthenticated.
- Companion UI lives outside this workspace; run it separately if needed.
