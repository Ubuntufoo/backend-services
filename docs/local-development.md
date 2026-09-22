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

## Feature-branch three-process launch

Use three terminals, with the explicit endpoint values below. The UI owns
port 3000; only the Sidecar owns port 3002; the watcher is a client and binds
no HTTP listener.

```bash
# 1. backend-services — Sidecar HTTP
MCP_HOST=localhost MCP_PORT=3002 SIDECAR_API_URL=http://localhost:3002 OAUTH_ENABLED=false EBAY_PUBLISH_ENABLED=false pnpm dev:sidecar

# 2. backend-services — watcher client (no listener)
SIDECAR_API_URL=http://localhost:3002 MCP_PORT=3002 pnpm --filter @ebay-inventory/watcher-service dev

# 3. ebay-ui-app — Next.js UI
SIDECAR_API_URL=http://localhost:3002 PORT=3000 pnpm dev
```

Stop each process with `Ctrl-C`. After changing `.env`, `.env.local`, or a
shell override, stop and restart all three processes; running processes keep
their already-loaded environment. The watcher loads `.env` before
`.env.local`, while shell variables remain highest precedence. The explicit
launch commands prevent an older local `3001` setting from taking effect.

Read-only checks:

```bash
curl --fail-with-body http://localhost:3002/health
curl --fail-with-body http://localhost:3002/api/variation-listings/f6364eb4-489b-450b-9a83-ced85526b90f
curl --fail-with-body http://localhost:3000/api/variation-listings

# Compare the same ProductionPilot02 group through the UI proxy and Sidecar.
GROUP_ID=f6364eb4-489b-450b-9a83-ced85526b90f
curl --fail-with-body http://localhost:3000/api/variation-listings \
  | jq --arg id "$GROUP_ID" '.groups[] | select(.groupId == $id) | {groupId, desiredRevision, lifecycleState, journal}'
curl --fail-with-body "http://localhost:3002/api/variation-listings/$GROUP_ID" \
  | jq '{groupId, desiredRevision, lifecycleState, journal}'
```

Compare `groupId`, `desiredRevision`, `lifecycleState`, and the `journal`
summary (especially its latest revision/checkpoint state). These commands are
GET-only; they do not publish, retry, reconcile, or otherwise mutate state.

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

- `pnpm dev` starts `services/sidecar/src/server-http.ts`. For this
  feature-branch workflow the effective Sidecar URL is
  `http://localhost:3002`; `MCP_HOST` and `MCP_PORT` override code defaults,
  and shell values override dotenv files.
- HTTP MCP is served at `/`; health is `/health`; data routes are mounted at
  `/api`. OAuth is enabled unless `OAUTH_ENABLED=false`.
- `pnpm dev:sidecar:stdio` starts `services/sidecar/src/index.ts` for MCP
  clients over stdio; HTTP OAuth settings do not apply to stdio.
- Sidecar job-runner loop starts only when `SIDECAR_JOB_RUNNER_ENABLED=true`.
- Do not expose an HTTP sidecar with `OAUTH_ENABLED=false` beyond a trusted
  local boundary; the MCP and `/api` surfaces are then unauthenticated.
- Companion UI lives outside this workspace; run it separately if needed.
