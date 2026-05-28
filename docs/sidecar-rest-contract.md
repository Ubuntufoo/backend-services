# Sidecar REST Contract

This document records the backend-owned HTTP contract exposed by `services/sidecar` for the listing workflow UI.

## Source of truth

Contract verified from:

- `services/sidecar/src/http/data-router.ts`
- `services/sidecar/src/schemas/data-api.ts`
- `services/sidecar/src/workflow/listing-workflow.ts`
- `packages/data/src/database.ts`
- `packages/data/src/database-generated.ts`

## Base URL

- Routes are mounted under `/api`
- Local create-listing endpoint: `POST /api/listings`

## `GET /api/listings`

Returns the current listing collection sorted by the backend repository layer.

### Success response

HTTP `200 OK`

```json
{
  "listings": []
}
```

The route returns a `listings` array and uses the shared data repository directly.

### Errors

- `404 not_found` is not used by this route.
- Unexpected persistence failures return `500 server_error` with the standard JSON shape below.

## `GET /api/listings/:listingId`

Returns one listing by `listingId`.

### Path parameters

- `listingId`: required non-empty string

### Success response

HTTP `200 OK`

Returns the full `listings` row.

### Not found

HTTP `404 Not Found`

```json
{
  "error": "not_found",
  "message": "Listing \"LIST-404\" was not found."
}
```

## `PATCH /api/listings/:listingId`

Updates the seller-editable listing fields only.

### Accepted request body fields

Only these fields are accepted:

- `sellerHints`
- `title`
- `description`
- `price`
- `categoryId`
- `itemSpecifics`
- `conditionId`
- `conditionNotes`

### Rejected fields

This route rejects workflow and system fields such as:

- `status`
- `subStatus`
- `captureMode`
- `listingType`
- `shippingProfile`
- `sku`
- `imageUrls`
- `merchantLocationKey`
- `packageType`
- `eseEligible`
- `estimatedWeightOz`
- `handlingDays`

Unknown top-level keys are also rejected.

## `PATCH /api/listings/:listingId/workflow-state`

Updates only the workflow `status`/`subStatus` pair.

### Request body

```json
{
  "status": "approved_for_export",
  "subStatus": "publish_queued"
}
```

The route validates that the pair is valid before persistence. It is separate from the seller-editable listing PATCH route and is the only backend route in this phase that can change workflow state.

## `POST /api/listings/:listingId/generate-ai`

Enqueues a `generate_ai` job for a listing that is already `assets_ready`.

### Request body

```json
{
  "sellerHints": "optional seller hints"
}
```

`sellerHints` is optional. If provided, the backend persists it before enqueueing the job.

### Success response

HTTP `201 Created` for a new job or HTTP `200 OK` when an active job already exists.

```json
{
  "alreadyQueued": false,
  "job": {},
  "listing": {}
}
```

The route returns the created or existing active job plus the listing row after the generation-ready workflow update.

### Invalid state

HTTP `409 Conflict`

```json
{
  "error": "listing_not_assets_ready",
  "message": "Listing \"LIST-001\" must be assets_ready before generate_ai can be enqueued."
}
```

### Stale or raced update

HTTP `409 Conflict`

```json
{
  "error": "listing_state_stale",
  "message": "Listing \"LIST-001\" changed before generate_ai could be enqueued. Refresh and retry."
}
```

## `GET /api/app-settings`

Reads the singleton `app_settings` row with `id = "default"`.

### Success response

HTTP `200 OK`

Returns the full `app_settings` row.

### Not found

HTTP `404 Not Found`

```json
{
  "error": "not_found",
  "message": "App settings \"default\" were not found."
}
```

## `POST /api/listings`

Creates a listing row in the shared `listings` table for the sidecar-driven workflow.

### Request body

Accepted JSON body:

```json
{
  "listingId": "optional-client-supplied-id",
  "captureMode": "single_2_image",
  "categoryId": "optional-category-id",
  "conditionId": "optional-condition-id",
  "conditionNotes": "optional condition notes",
  "description": "optional description",
  "eseEligible": true,
  "estimatedWeightOz": 12,
  "handlingDays": 2,
  "imageUrls": ["https://example.com/image-1.jpg"],
  "itemSpecifics": {
    "Brand": "Acme"
  },
  "listingType": "single",
  "merchantLocationKey": "optional-location-key",
  "packageType": "optional-package-type",
  "price": 19.99,
  "sellerHints": "optional seller hints",
  "shippingProfile": "optional shipping profile",
  "sku": "optional-sku",
  "title": "optional title"
}
```

Supported fields and constraints:

- `listingId`: optional non-empty string. If omitted, the backend generates one with `randomUUID()`.
- `captureMode`: optional. Enum from `@ebay-inventory/types` `CAPTURE_MODES`.
- `listingType`: optional. Enum: `"single" | "lot"`.
- `imageUrls`: optional array of non-empty trimmed strings.
- `itemSpecifics`: optional object with string keys and arbitrary JSON-compatible values.
- `eseEligible`: optional boolean.
- `estimatedWeightOz`: optional number, finite, `>= 0`.
- `handlingDays`: optional integer, `>= 0`.
- `price`: optional number, finite, `>= 0`.
- `categoryId`, `conditionId`, `conditionNotes`, `description`, `merchantLocationKey`, `packageType`, `sellerHints`, `shippingProfile`, `sku`, `title`: optional non-empty strings or `null`.

Fields not accepted by this route:

- Workflow fields such as `status` and `subStatus`
- Persistence-only fields such as `id`, timestamps, eBay IDs, R2 fields, and error fields
- Any unknown top-level keys

### Minimal valid payload

The smallest valid request body is:

```json
{}
```

### Backend defaults applied on create

The route applies these defaults before inserting the row:

- `listing_id`: generated as `randomUUID()` when `listingId` is omitted
- `status`: always `"record_created"`
- `sub_status`: always `"idle"`
- `image_urls`: `[]` when `imageUrls` is omitted
- `r2_object_keys`: `[]`
- `item_specifics`: `{}` when `itemSpecifics` is omitted

Client input cannot override `status` or `sub_status` on this route.

### Success response

HTTP `201 Created`

Returns the full inserted `listings` table row, not a reduced DTO. Shape:

```json
{
  "approved_for_export_at": null,
  "capture_mode": null,
  "category_id": null,
  "condition_id": null,
  "condition_notes": null,
  "created_at": "2026-05-17T00:00:00.000Z",
  "description": null,
  "ebay_listing_id": null,
  "ebay_listing_status": null,
  "ebay_listing_url": null,
  "ebay_offer_id": null,
  "ese_eligible": null,
  "estimated_weight_oz": null,
  "exported_at": null,
  "handling_days": null,
  "id": "listing-row-id",
  "image_urls": [],
  "item_specifics": {},
  "last_error_at": null,
  "last_error_code": null,
  "listing_id": "123e4567-e89b-12d3-a456-426614174000",
  "listing_type": null,
  "merchant_location_key": null,
  "package_type": null,
  "price": null,
  "r2_delete_after": null,
  "r2_deleted_at": null,
  "r2_object_keys": [],
  "r2_retention_policy": null,
  "seller_hints": null,
  "shipping_profile": null,
  "sku": null,
  "sold_at": null,
  "status": "record_created",
  "sub_status": "idle",
  "title": null,
  "updated_at": "2026-05-17T00:00:00.000Z"
}
```

Notes:

- Response keys are snake_case because the route returns the database row directly.
- `captureMode`, `listingType`, and the other camelCase request fields are persisted and returned as snake_case database columns such as `capture_mode` and `listing_type`.

### Validation errors

HTTP `400 Bad Request`

Validation failures use this shape:

```json
{
  "error": "invalid_request",
  "details": [
    {
      "message": "title must be a string",
      "path": "title"
    }
  ]
}
```

Observed validation rules:

- Empty object is valid and creates a listing with backend defaults.
- Wrong types return schema-specific messages. Example: numeric fields use Zod's default message such as `"Expected number, received string"`, while trimmed string fields use messages such as `"title must be a string"`.
- Empty strings for trimmed string fields return `"... is required"`.
- Unknown top-level fields are rejected because the schema is strict. Example:

```json
{
  "error": "invalid_request",
  "details": [
    {
      "message": "Unrecognized key(s) in object: 'status'",
      "path": ""
    }
  ]
}
```

### Other errors

Unexpected persistence or server failures return HTTP `500`:

```json
{
  "error": "server_error",
  "message": "An unexpected server error occurred."
}
```

## Create behavior

The route creates a draft workflow record with optional listing fields only. The backend always starts the listing in:

- `status: "record_created"`
- `sub_status: "idle"`
