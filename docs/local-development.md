# Local Development

## Environment

- Shared runtime env lives at repo root: `.env`
- Machine-local secrets and tokens live at repo root: `.env.local`
- Do not document or expect `services/sidecar/.env` as canonical.
- For DB-only local work, disable eBay paths with `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`.

## Root Commands

```bash
pnpm install
pnpm validate:env
pnpm dev
pnpm dev:sidecar:stdio
pnpm setup
```

## Service Commands

| Area | Command |
| --- | --- |
| Sidecar HTTP | `pnpm dev` or `pnpm dev:sidecar` |
| Sidecar MCP stdio | `pnpm dev:sidecar:stdio` |
| Sidecar prod-style start | `pnpm --filter sidecar start` |
| Watcher dev | `pnpm --filter @ebay-inventory/watcher-service dev` |
| Watcher start | `pnpm --filter @ebay-inventory/watcher-service start` |
| Image service validation | `pnpm --filter @ebay-inventory/image-service check` |

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

- `pnpm dev` starts `services/sidecar/src/server-http.ts`.
- `pnpm dev:sidecar:stdio` starts `services/sidecar/src/index.ts` for MCP clients only.
- Sidecar job-runner loop starts with HTTP sidecar unless `SIDECAR_JOB_RUNNER_ENABLED=false`.
- Companion UI lives outside this workspace; run it separately if needed.
