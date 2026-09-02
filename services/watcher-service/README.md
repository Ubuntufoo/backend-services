# Watcher Service

`services/watcher-service` is the local filesystem watcher runtime for incoming listing images.

## Commands

From this package:

```bash
pnpm dev
pnpm build
pnpm start
pnpm test
```

From the repo root:

```bash
pnpm --filter @ebay-inventory/watcher-service dev
pnpm --filter @ebay-inventory/watcher-service build
pnpm --filter @ebay-inventory/watcher-service start
pnpm --filter @ebay-inventory/watcher-service test
```

## Environment

The watcher CLI loads repo-root `backend-services/.env`, then `backend-services/.env.local` for
unset variables. Existing `.env` values are not overwritten by the local file.

Set the local incoming folder path in the repo-root env file:

```bash
WATCHER_INCOMING_DIR=/Users/timothymurphy/image-incoming
```

For variation-listing intake, configure one stable station/source identity in the same repo-root environment used by both Sidecar and watcher:

```bash
WATCHER_CAPTURE_SOURCE_KEY=station-main
```

When this value is absent, the watcher remains on the existing Single/Lot path and the variation intake API fails closed. When present, the watcher reads the durable variation intake session for this exact key before deciding whether each new image belongs to variation intake or the unchanged legacy path.

If the watcher calls a Sidecar URL other than its default local `MCP_PORT`, set `SIDECAR_API_URL`. If that Sidecar requires a bearer token, set `SIDECAR_API_BEARER_TOKEN` for the watcher process; do not expose the token to browser code.

Optional overrides:

```bash
# WATCHER_BASE_DIR=./watcher
# WATCHER_PROCESSED_DIR=./watcher/processed
```

## Capture Guidance

- All-JPEG watcher groups use `enhance_crop` downstream. The finalized profile is JPEG q95,
  4:2:0 chroma subsampling, and no sharpening; a conservative uncropped fallback is valid.
- Use fixed overhead/square framing, a smooth uniform matte white or black high-contrast
  backdrop, even diffused light, minimal glare/shadow, full item edges, and generous clean
  margin.
- Textured or linty backgrounds can reduce crop acceptance; never weaken safety gates to force
  a crop.

## Runtime Behavior

- Watches only the configured incoming directory.
- Uses Chokidar with `ignoreInitial: true`, `awaitWriteFinish: true`, and `depth: 0`.
- Processes new file `add` events sequentially through `processIncomingImageBatch()`.
- Preserves grouping state across batches.
- Ignores startup-existing files in this step.
- Supports `single_2_image` and `lot_3_image` capture modes.
- Variation listing does not extend the legacy capture-mode union. With `WATCHER_CAPTURE_SOURCE_KEY` configured, each image is first routed against the durable variation intake session; only `legacy` outcomes proceed to Single/Lot grouping.
- An armed variation first image persists the durable pending pair. Its back image uses the existing variation Gemini identity, R2 ownership, and completion transaction seams; failures retain only the unprocessed retry suffix and never replay already-consumed variation images into legacy grouping.
- Accepts `.jpg`, `.jpeg`, `.png`, and `.webp` image files (case-insensitive extension check).
- Remains alive after batch failures. Retryable batch failures retain grouping state and retry
  inputs and pause queue draining; other failures are logged without terminating the runtime.
