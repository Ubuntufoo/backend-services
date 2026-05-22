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

The watcher reads repo-root `backend-services/.env` and overlays `backend-services/.env.local`.

Set the local incoming folder path in the repo-root env file:

```bash
WATCHER_INCOMING_DIR=/Users/timothymurphy/image-incoming
```

Optional overrides:

```bash
# WATCHER_BASE_DIR=./watcher
# WATCHER_PROCESSED_DIR=./watcher/processed
```

## Runtime Behavior

- Watches only the configured incoming directory.
- Uses Chokidar with `ignoreInitial: true`, `awaitWriteFinish: true`, and `depth: 0`.
- Processes new file `add` events sequentially through `processIncomingImageBatch()`.
- Preserves grouping state across batches.
- Ignores startup-existing files in this step.
- Remains alive after batch failures; failed snapshots are logged and dropped.
