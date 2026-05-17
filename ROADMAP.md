# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

| Phase | Area | Task | Output |
|---:|---|---|---|
<!-- | 0 | BE | Set up pnpm workspace scripts | Can run services from root |
| 0 | BE | Add shared TypeScript config | Consistent TS across services |
| 0 | BE | Add shared env validation package | Each service can validate required env vars |
| 0 | BE | Add shared types package | Shared `ListingStatus`, `JobType`, `CaptureMode` types |
| 0 | FE | Set up app shell | Basic dashboard route loads | -->
| 1 | DB | Create listings table | Core listing data exists |
| 1 | DB | Create jobs table | Background work can be queued |
| 1 | DB | Create orders table | Order checks can be stored later |
| 1 | DB | Create daily_usage table | Gemini/order sync usage can be tracked |
| 1 | DB | Create app_settings table | Typed single-row config exists |
| 1 | BE | Add Supabase service client | Backend services can read/write DB |
| 1 | FE | Add Supabase browser client | UI can display listings |
| 1 | FE | Create basic listings table view | Listings visible in UI |
| 2 | FE | Add Create Test Listing form | Can manually create listing row |
| 2 | FE | Add fields for `seller_hints`, `title`, `description`, `price`, `category_id`, `item_specifics` | Review/edit UI starts taking shape |
| 2 | FE | Add status controls for test flow | Can manually move status through early stages |
| 2 | BE | Add basic listing API endpoints or server actions | UI can create/update listings safely |
| 2 | DB | Add seed `app_settings` row | Default config exists |
| 3 | BE | `r2-service`: implement `uploadImage()` | Image can upload to R2 |
| 3 | BE | `r2-service`: return public URL and object key | `image_urls` and `r2_object_keys` populated |
| 3 | FE | Add manual image upload/test input | Listing can receive image URLs |
| 3 | DB | Store `image_urls[]` and `r2_object_keys[]` on listings | No separate asset table needed |
| 3 | FE | Display listing images in review UI | Visual review works |
| 4 | BE | `gemini-service`: implement `generateListingDraft()` | Gemini returns structured draft |
| 4 | BE | Add Zod schema for AI output | Invalid AI responses are rejected |
| 4 | BE | `job-runner`: add `generate_ai` job | AI generation runs as job |
| 4 | FE | Add Generate button from `assets_ready` | Manual AI generation works |
| 4 | FE | Show generating locked state | Prevents duplicate edits |
| 4 | FE | Show `needs_review` state | User can review generated draft |
| 4 | FE | Add Pricing buttons to UI that build structured URL strings | External link to pricing websites|
| 4 | DB | Track `generated_at`, `last_error` fields | Basic AI debugging exists |
| 5 | BE | `watcher-service`: read `capture_mode` from `app_settings` | Watcher knows grouping size |
| 5 | BE | `watcher-service`: watch `/incoming` | New files detected |
| 5 | BE | `watcher-service`: group images by mode | Complete group identified |
| 5 | BE | `watcher-service`: assign `listing_id` | `Single-000123` or `Lot-000124` created |
| 5 | BE | `watcher-service`: rename and move to `/processed` | Local folder organized |
| 5 | BE | `watcher-service`: create listing row | `status = record_created` |
| 5 | BE | `image-service`: minimal process step | Can pass through or strip EXIF only |
| 5 | BE | `job-runner`: queue R2 upload | Status moves to `assets_ready` |
| 5 | FE | Show new watcher-created rows | User sees incoming listings |
| 6 | BE | `ebay-service`: validate OAuth/env | eBay credentials work |
| 6 | BE | `ebay-service`: fetch/use account policy IDs | Payment/fulfillment/return policy defaults known |
| 6 | BE | `ebay-service`: implement `publishListing()` | Internal API hides Inventory API details |
| 6 | BE | Inventory API adapter: create/update inventory item | First publish step works |
| 6 | BE | Inventory API adapter: create offer | Offer created |
| 6 | BE | Inventory API adapter: publish offer | Listing published in sandbox |
| 6 | DB | Save `ebay_offer_id`, `ebay_listing_id`, `ebay_listing_url` | Publish traceability exists |
| 6 | FE | Add Approve For Export button | `status = approved_for_export` |
| 6 | BE | `job-runner`: publish approved listings | Status moves to `exported` |
| 7 | FE | Add final review checklist | Pre-publish safety gate |
| 7 | BE | Add required field validation before publish | Bad listings blocked |
| 7 | BE | Add daily usage checks | Gemini and order sync limits enforced |
| 7 | BE | Add publish throttling | No API burst publishing |
| 7 | FE | Add queue panel | Shows `needs_review`, `approved_for_export`, publish queue, errors |
| 7 | BE | Add retry behavior for recoverable errors | Manual retry supported |
| 8 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work |
| 8 | BE | `job-runner`: schedule 4 order checks/day | Controlled API usage |
| 8 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date` |
| 8 | BE | Match order SKU to `listing_id` | Sold listing identified |
| 8 | DB | Update listing status to `sold` | Sale tracked |
| 8 | FE | Add Unshipped Orders panel | Packing queue visible |
| 8 | FE | Show due today/overdue warnings | 1-day handling support |
| 9 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist |
| 9 | BE | On `sold`, set `r2_delete_after` | `sold_at + configured retention days` |
| 9 | BE | `r2-service`: `deleteObjects()` | R2 cleanup works |
| 9 | BE | `job-runner`: cleanup eligible sold listings | Images deleted after retention |
| 9 | FE | Show cleanup status lightly | Optional UI visibility |
| 10 | FE | Add Sync Now buttons | Manual watcher/order sync control |
| 10 | FE | Add settings screen | Edit `app_settings` safely |
| 10 | BE | Add service health checks | UI can show service status |
| 10 | BE | Add structured logs | Debuggability improves |
| 10 | BE | Add tests for status transitions | Workflow protection |
| 10 | BE | Add tests for publish validation | Prevent bad eBay calls |
| 10 | Docs | Add OPERATIONS.md | How to run/use system |
