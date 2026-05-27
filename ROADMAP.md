# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

| Phase | Area | Task | Output |
|---:|---|---|---|
<!-- | 0 | BE | Set up pnpm workspace scripts | Can run services from root |
| 0 | BE | Add shared TypeScript config | Consistent TS across services |
| 0 | BE | Add shared env validation package | Each service can validate required env vars |
| 0 | BE | Add shared types package | Shared `ListingStatus`, `JobType`, `CaptureMode` types |
| 0 | FE | Set up app shell | Basic dashboard route loads | 
| 1 | DB | Create listings table | Core listing data exists |
| 1 | DB | Create jobs table | Background work can be queued |
| 1 | DB | Create orders table | Order checks can be stored later |
| 1 | DB | Create daily_usage table | Gemini/order sync usage can be tracked |
| 1 | DB | Create app_settings table | Typed single-row config exists |
| 1 | BE | Add REST API routes in sidecar backed by shared repository service layer | Frontend can read/write listings, jobs, orders, and app_settings through sidecar REST endpoints |  
| 1 | BE | Replace temporary Database type with generated Supabase types | Shared data layer uses generated table types instead of hand-written temporary types |
| 1 | FE | Add sidecar REST API client | UI can fetch listings and app settings through sidecar REST endpoints |
| 1 | FE | Create basic listings table view | Listings visible in UI | 
| 2 | FE | Add Create Test Listing form | Can manually create listing row | 
| 2 | FE | Add fields for `seller_hints`, `title`, `description`, `price`, `category_id`, `item_specifics` | Review/edit UI starts taking shape | 
| 2 | FE | Add status controls for test flow | Can manually move status through early stages | 
| 2 | BE | Add basic listing API endpoints or server actions | UI can create/update listings safely |
| 2 | DB | Add seed `app_settings` row | Default config exists |  
| 3 | BE | `r2-service`: implement `uploadImage()` using R2 S3 API and env-based public URL | Backend can upload one image to R2 and return `{ publicUrl, objectKey }` | 
| 3 | BE | `r2-service`: return public URL and object key | `image_urls` and `r2_object_keys` populated | 
| 3 | FE | Add manual image upload/test input | Listing can receive image URLs |
| 3 | DB | Store `image_urls[]` and `r2_object_keys[]` on listings | No separate asset table needed | 
| 3 | FE | Display listing images in review UI | Visual review works |. 
| 4 | BE | `gemini-service`: implement `generateListingDraft()` | Gemini returns structured draft |
| 4 | BE | Add Zod schema for AI output | Invalid AI responses are rejected | 
| 4 | BE | `job-runner`: add `generate_ai` job | AI generation runs as job | 
| 4 | FE | Add Generate button from `assets_ready` | Manual AI generation works | 
| 4 | FE | Show generating locked state | Prevents duplicate edits |     
| 4 | FE | Show `needs_review` state | User can review generated draft | 
| 4 | FE | Milestone | Create one listing manually in the UI, attach image URLs, run Gemini, review/edit, and save needs_review. | 
| 4 | FE | Add Pricing buttons to UI that build structured URL strings | External pricing links available from review UI | 
| 4 | DB | Track `generated_at`, `last_error` fields | Basic AI debugging exists | 
| 5 | BE | watcher-service: define watcher config and path conventions | Incoming/processed paths and supported modes standardized |
| 5 | BE | watcher-service: read capture_mode from app_settings | Watcher knows grouping size |       
| 5 | BE | watcher-service: assign listing_id | Single-000123 or Lot-000124 created |
| 5 | BE | watcher-service: group images by mode | Complete group identified |
| 5 | BE | `watcher-service`: orchestrate one incoming image batch | Complete batch ready to process | 
| 5 | BE | watcher-service: rename and move to /processed | Local folder organized |
| 5 | DB | Add/verify unique constraint on `listings.listing_id` | Duplicate watcher IDs blocked at database level |
| 5 | BE | `watcher-service`: create listing row with collision-safe `listing_id` insert | `status = record_created`, unique `listing_id` persisted |
| 5 | BE | watcher-service: watch /image-incoming | New files automatically trigger processing | 
| 5 | BE | `image-service`: minimal process step | Can pass through or strip EXIF only |
| 5 | BE | job-runner: process images and queue R2 upload | Processed image assets uploaded; listing moves to `assets_ready` | 
| 5 | FE | Show watcher-created intake rows | User sees `record_created` and `assets_ready` listings with image/upload state | 
| 5 | BE | sidecar job-runner loop for queued jobs | Queued jobs processed by sidecar job-runner |
| 6 | BE | R2 public URL update | Before sandbox publish, switch `R2_PUBLIC_BASE_URL` from `r2.dev` to a custom-domain R2 URL | 
| 6 | BE | `ebay-service`: validate OAuth/env | eBay credentials work |
| 6 | BE | ebay-service: fetch/use account policy IDs | Implemented; live sandbox blocked by Business Policy eligibility | 
| 6 | BE | Add eBay sandbox diagnostics command | Auth/account/policy eligibility can be checked without running bootstrap 
| 6 | BE | ebay-service: implement publishListing() orchestration | Internal publish API validates listing, builds Inventory/Offer calls, and persists export result 
| 6 | BE | Inventory API adapter: create/update inventory item | First publish step works |
| 6 | BE | Inventory API adapter: create offer | Offer created | 
| 6 | BE | Inventory API adapter: publish offer | Listing published in sandbox |  
| 6 | DB | Save `ebay_offer_id`, `ebay_listing_id`, `ebay_listing_url` | Publish traceability exists | 
| 6 | FE | Add Approve For Export button | `status = approved_for_export` | 
| 6 | BE | `job-runner`: publish approved listings | Status moves to `exported` | 
| 7 | FE | Add final review checklist | Pre-publish safety gate | 
| 7 | BE | Add required field validation before publish | Bad listings blocked |  
| 7 | BE/FE | Milestone: run full local-to-eBay sandbox pipeline test | One listing can move from image intake → R2 → DB → Gemini draft → review → approve → publish/export result | 
| 7 | BE | Map `condition_id` to eBay Inventory API condition enum | Inventory item upsert sends a serializable eBay `condition` value | GPT-5.5 | Medium | Immediate backend publish blocker from manual test |
| 7 | BE | Filter internal Gemini suggestion fields from eBay item specifics | Review-only AI hints are not sent as eBay item specifics | GPT-5.5 mini | Low-Medium | Last manual DB cleanup required before successful sandbox export |
| 7 | BE | Clear stale publish errors on successful export | Exported listings do not retain old failure context | GPT-5.5 mini | Low | Small correctness cleanup after successful export | 
| 7 | BE | Validate eBay app_settings policy IDs before offer creation | Mock/missing payment, fulfillment, return policy, marketplace, and location settings are blocked before eBay Offer API call | GPT-5.5 | Medium | Prevents known config failure from recurring | 
| 7 | BE | Add eBay sandbox config diagnostic command | Sandbox policy/location config can be inspected without guessing | GPT-5.5 | Medium | Operational command for future sandbox resets | 
| 7 | BE | Harden sandbox setup/bootstrap for policies and inventory location | `app_settings.default` can be populated with real sandbox policy/location IDs | GPT-5.5 | Medium | Makes local setup repeatable | 
| 7 | BE | Add `generate_ai` enqueue endpoint/action | UI can safely start Gemini generation from `assets_ready` | GPT-5.5 mini | Medium | Backend support for FE action |
| 7 | FE | Add Generate AI Draft action for `assets_ready` listings | User can enter seller hints and enqueue Gemini generation from UI | GPT-5.5 mini | Medium | Removes manual SQL job insert | 
| 7 | FE | Enable seller hints before generation | User can guide Gemini before draft generation | GPT-5.5 mini | Low-Medium | Bundle with Generate AI Draft if practical | 
| 7 | FE | Fix listing realtime refresh after backend job transitions | UI updates when Gemini/job-runner changes listing status/data | GPT-5.5 mini | Medium | Removes reload requirement | 
| 7 | FE | Remove unsafe manual `Generating` status control | `generating` can only be entered through the Generate AI Draft enqueue action | GPT-5.5 mini | Low-Medium | Prevents listings from entering `generating / idle` with no `generate_ai` job | 
| 7A.1 | BE | Add typed job errors, attempts/max_attempts, due queued jobs, and stale running recovery for existing jobs | `process_images` and `generate_ai` use retry/stale recovery without changing publish architecture | 
| 7A.2 | BE | Normalize publish execution into jobs table | Publish uses job retries, stale recovery, duplicate active-job guard, and backfill from `publish_queued` |
| 7A.3 | BE | Add manual retry endpoint and orphan workflow repair | Failed/retryable listings can be safely retried and active-looking orphan states are repaired | 
| 7A | BE | Add publish throttling | No API burst publishing | GPT-5.5 mini | Low-Medium | Prevents repeated eBay API error loops | .   -->
| 7A | BE | Add trading-card condition descriptor support | Trading-card listings satisfy eBay category-specific condition requirements | GPT-5.5 | Medium-High | Production hardening for trading cards before serious publish testing |
| 7A | BE | Add daily usage checks | Gemini and order sync limits enforced | GPT-5.5 | Medium | Guardrail against accidental API overuse |
| 7B | DB | Track Gemini model attempts | AI model usage and fallback outcomes are auditable per listing | GPT-5.5 mini | Low-Medium | Should come before Gemini fallback router |
| 7B | BE | Implement Dynamic Gemini Model Discovery & Fallback Router | Replace hardcoded Gemini model strings with a dynamic discovery engine that detects, scores, and cascades through available free-tier models on rate/quota/unavailable errors | GPT-5.5 | Medium-High | Gemini robustness; should consume model-attempt tracking |
| 7C | FE | Add queue/error panel | Shows `assets_ready`, `generating`, `needs_review`, `approved_for_export`, publish queue, and persisted errors | GPT-5.5 mini | Low-Medium | Operational visibility; not aesthetic QOL |
| 8	 | BE |	Implement explicit SQL API Table Grants & Security Advisor Review	Audit all existing tables using the Supabase Security Advisor ahead of the Oct 30, 2026 enforcement deadline; update table-creation flows / DB migrations to explicitly grant PostgREST/API access to the public schema.
| 8 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, `sale_price` | GPT-5.5 mini | Medium | Storage foundation before scheduled order sync |
| 8 | FE | Improve listing image preview gallery | All listing images are visible at usable review size | GPT-5.5 mini | Low-Medium | Deferred QOL/review usability |
| 8 | BE | Normalize image orientation during asset processing | R2 images display with correct orientation | GPT-5.5 mini | Low-Medium | Defer unless EXIF issue is confirmed |
| 8 | FE | Show cleanup status lightly | Optional UI visibility | GPT-5.5 mini | Low | Deferred QOL visibility |
| 8 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work | GPT-5.5 | Medium | Begin post-listing order workflow |
| 8 | BE | Match order SKU to `listing_id` | Sold listing identified | GPT-5.5 mini | Medium | Required before updating listings to sold |
| 8 | DB/BE | Update listing status to `sold` | Sale tracked | GPT-5.5 mini | Medium | Enables cleanup and fulfillment workflows |
| 8 | BE | `job-runner`: schedule 4 order checks/day | Controlled API usage | GPT-5.5 mini | Medium | Schedule only after order storage and matching exist |
| 8 | FE | Add Unshipped Orders panel | Packing queue visible | GPT-5.5 mini | Low-Medium | Operational UI, not polish |
| 8 | FE | Show due today/overdue warnings | 1-day handling support | GPT-5.5 mini | Low-Medium | Operational guardrail for fulfillment |
| 9 | BE | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior defined and enforced | GPT-5.5 mini | Low-Medium | Local disk cleanup guardrail |
| 9 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist | GPT-5.5 mini | Low-Medium | Required before R2 deletion automation |
| 9 | BE | On `sold`, set `r2_delete_after` | `sold_at + configured retention days` | GPT-5.5 mini | Low-Medium | Connects sold state to cleanup eligibility |
| 9 | BE | `r2-service`: `deleteObjects()` | R2 cleanup works | GPT-5.5 mini | Medium | Deletion primitive before scheduled cleanup |
| 9 | BE | `job-runner`: cleanup eligible sold listings | Images deleted after retention | GPT-5.5 | Medium | Automated cleanup after retention window |
| 10 | FE | Add Sync Now buttons | Manual watcher/order sync control |
| 10 | FE | Add settings screen | Edit `app_settings` safely |
| 10 | BE | Add service health checks | UI can show service status |
| 10 | BE | Add structured logs | Debuggability improves |
| 10 | BE | Add production job-runner configuration | Tune polling interval, batch size, stale-running recovery, and worker enablement for production-like operation |
| 10 | BE | Add tests for status transitions | Workflow protection |
| 10 | BE | Add tests for publish validation | Prevent bad eBay calls |
| 10 | Docs | Add OPERATIONS.md | How to run/use system |
| 11 | BE | Add read-only eBay query services | Messages, orders, listings, and inventory can be queried without LLM dependency |
| 11 | BE | Add assistant tool registry | Allowed read-only tools are centrally defined |
| 11 | BE | Add assistant intent router | Common user queries map to approved read-only tools |
| 11 | BE | Add assistant response schemas | UI receives typed assistant results |
| 11 | BE | Add read-only guardrails | Assistant cannot mutate eBay account state |
| 11 | BE | Add assistant audit logs | Assistant tool calls are traceable |
| 11 | BE | Add Gemini assistant bridge | Gemini can route/summarize approved read-only queries |
| 12 | FE | Add Read-only eBay Assistant panel | User can query seller account data from UI |
| 12 | FE | Add assistant quick actions | Common queries work without model reasoning |
| 12 | FE | Render assistant result cards | Messages, orders, listings, and inventory display cleanly |
| 12 | FE | Show assistant read-only mode | User understands assistant cannot publish, revise, reply, refund, or cancel |
| 12 | BE | Add tests for assistant routing and guardrails | Unsafe or unsupported assistant actions are blocked |
| 12 | BE | BE audit: clean up and review for refactoring | Eliminate checklist scripts, stale tests, other development artifacts |
| 12 | Docs | Document Read-only eBay Assistant contract | Future assistant architecture is clear |
13 | Marketing/SEO | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition |