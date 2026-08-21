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
- Supports `passthrough`, `strip_exif`, and opt-in `enhance_crop` modes.
- `enhance_crop` auto-orients before deterministic multi-scale crop analysis, crops only when every conservative safety gate passes, otherwise emits the uncropped oriented image, and encodes both paths as JPEG quality 95 with 4:2:0 chroma subsampling.
- Preserves watcher-assigned filenames.
- Writes processed copies into a distinct output directory.

## Non-Goals

- No R2 uploads.
- No Supabase image URL updates.
- Does not switch watcher-managed processing; existing mode remains until explicitly wired.
