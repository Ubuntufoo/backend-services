# Sidecar HTTP Contract

The Express HTTP sidecar mounts the data router at `/api` and the
Streamable-HTTP MCP transport at `/`. Defaults are `MCP_HOST=localhost` and
`MCP_PORT=3000`, so local URLs are `http://localhost:3000/api/...` and
`http://localhost:3000/`. `GET /health` is a small unauthenticated health
response. OAuth protects MCP and `/api` when `OAUTH_ENABLED` is not `false`;
keep the HTTP server on a trusted local boundary when OAuth is disabled.

## Routes

All JSON request bodies and `:listingId` parameters are validated. A malformed
request returns `400` with `{ "error": "invalid_request", "details": [...] }`.
Not-found responses use `404` and `{ "error": "not_found", "message": "..." }`;
workflow and safety conflicts use `409` or `422` with an operation-specific
error code. Unexpected failures return `500` with `error: "server_error"`.

| Method and path | Purpose and success response |
| --- | --- |
| `GET /api/listings` | List serialized listings, including latest pricing context. |
| `GET /api/listings/:listingId` | Return one serialized listing; `404` when absent. |
| `GET /api/gemini-usage` | Return current usage, limit, remaining quota, reset time, and latest attempt. |
| `GET /api/ebay-environment` | Return the configured eBay environment summary. |
| `POST /api/listings` | Create a listing from the editable listing body; returns `201` and the serialized listing. |
| `PATCH /api/listings/:listingId` | Update seller-editable listing fields; returns the serialized listing. |
| `PATCH /api/listings/:listingId/image-urls` | Replace validated public image URLs; returns the serialized listing. |
| `PATCH /api/listings/:listingId/workflow-state` | Apply a valid workflow transition; approving with `approved_for_export` + `publish_queued` also enqueues publish. |
| `POST /api/listings/:listingId/generate-ai` | Body includes `autoPricingEnabled` and optional `sellerHints`; returns `{ alreadyQueued, job, listing }` with `201` for a new job or `200` when already queued. |
| `POST /api/listings/:listingId/abandon` | Requires `{ "confirmed": true }`; abandons an eligible listing and returns `{ abandoned, listingId }`. |
| `POST /api/listings/:listingId/delete-sandbox` | Requires `{ confirmed: true, expectedSku, expectedUpdatedAt }`; runs the sandbox-only guarded cleanup and returns its result. |
| `POST /api/listings/:listingId/retry` | Retry the eligible listing workflow and return `{ ...result, listing }`. |
| `POST /api/listings/:listingId/retry-pricing-analysis` | Re-run only LLM pricing analysis against persisted comps; returns `{ listing, warning_resolved }`. |
| `POST /api/listings/:listingId/retry-pricing` | Re-run the provider-backed pricing review; returns `{ ...result, listing }`. |
| `POST /api/listings/:listingId/pricing-analysis-warnings/dismiss` | Body is `{ "codes": ["..."] }`; persist applicable warning dismissals and return `{ listing }`. |
| `GET /api/app-settings` | Return the default app-settings row with normalized pricing mode and SoldComps usage summary. |
| `PATCH /api/app-settings` | Body is `{ "pricingProviderMode": "off" | "soldcomps" }`; return updated app settings. |

Listing IDs are path values and should be URL-encoded by clients. The
`delete-sandbox` route is not a general listing delete endpoint: the domain
workflow still enforces sandbox environment, eligibility, exact SKU, current
`updated_at`, and other safety checks before mutation.

## MCP HTTP endpoints

The MCP transport uses `POST /` for initialization and requests, with
`Mcp-Session-Id` required for subsequent `GET` or `DELETE` session operations.
These endpoints are separate from the `/api` data routes. OAuth metadata is
served at `/.well-known/oauth-protected-resource` (and MCP server information
at `/.well-known/mcp-server-info`) before the protected route middleware.

The route table above is intentionally compact; Zod schemas in
`services/sidecar/src/schemas/data-api.ts` and `services/sidecar/src/http/data-router.ts`
remain the implementation source of truth for field-level request details.
