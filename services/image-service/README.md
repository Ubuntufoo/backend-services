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
- `enhance_crop` auto-orients before deterministic multi-scale crop analysis and uses a crop-first policy: one plausible detector rectangle is enough to crop. Contrast, edge support, symmetry, and modest crop reduction rank candidates but do not veto sane geometry; only tiny, invalid, or destructive rectangles fall back to the oriented full frame. Natural margins are clamped to source pixels (never synthesized). A detected sideways card is rotated 90° after extraction so finalized card output is portrait; no-candidate fallback remains the original oriented frame. Both paths encode JPEG quality 95 with 4:2:0 chroma subsampling and strip EXIF metadata.
- Preserves watcher-assigned filenames.
- Writes processed copies into a distinct output directory.

## Non-Goals

- No R2 uploads.
- No Supabase image URL updates.
- Watcher-managed `record_created` listings use `enhance_crop` when every local source is JPEG; mixed or non-JPEG inputs retain the `strip_exif` compatibility path.
