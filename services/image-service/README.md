# Image Service

`services/image-service` handles local-only listing image processing after watcher-service has already grouped, renamed, moved, and persisted the listing row.

## Commands

From this package:

```bash
pnpm build
pnpm test
pnpm typecheck
```

From the repo root:

```bash
pnpm --filter @ebay-inventory/image-service build
pnpm --filter @ebay-inventory/image-service test
pnpm --filter @ebay-inventory/image-service typecheck
```

## Scope

- Processes local files only.
- Supports `passthrough` and `strip_exif` modes.
- Preserves watcher-assigned filenames.
- Writes processed copies into a distinct output directory.

## Non-Goals

- No R2 uploads.
- No Supabase image URL updates.
- No resizing, compression, or derivative generation in this phase.
