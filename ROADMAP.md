# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

| Phase | Area | Task | Output |
|---:|---|---|---|
<!--
| 0 | BE | Set up pnpm workspace scripts | Can run services from root |
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
| 7A | BE | Add publish throttling | No API burst publishing | GPT-5.5 mini | Low-Medium | Prevents repeated eBay API error loops | 
| 7A | FE | Add eBay title length validation | Prevent approval/export when title exceeds 80 characters | GPT-5.5 mini | Low-Medium | Catches user-fixable publish errors before backend/eBay API call |
| 7A | FE | Split exported/live listings into read-only panel | Completed listings leave edit/review panel and appear in compact Exported/Live table with eBay URL | GPT-5.5 mini | Medium | Keeps active workflow UI clean after successful publish |
| 7A | BE | Add trading-card condition descriptor support | Trading-card listings satisfy eBay category-specific condition requirements | GPT-5.5 | Medium-High | Production hardening for trading cards before serious publish testing |
| 7A | FE | Add trading-card condition review controls | User can review/edit Gemini card condition token and condition notes before approval/export | GPT-5.5 mini | Medium | Completes frontend support for BE trading-card condition descriptors |
| 7 | FE | Add queue/error panel | Shows `assets_ready`, `generating`, `needs_review`, `approved_for_export`, publish queue, and persisted errors | GPT-5.5 mini | Low-Medium | Operational visibility; not aesthetic QOL |
| 7 | DB/BE | Implement explicit SQL API Table Grants & Security Advisor Review | Supabase Security Advisor is reviewed; existing tables are audited; migrations explicitly grant required PostgREST/API access to public schema tables | GPT-5.5 mini | Low-Medium | Move earlier because new tables should follow the corrected grant pattern |
| 7 | BE | Add eBay required item-specific validation | Category-required aspects are detected before publish and returned as user-fixable review errors | GPT-5.5 | Medium-High | Prevents eBay publish-time missing-aspect failures | 
| 7 | DB | Track AI model attempts | Provider/model usage and fallback outcomes are auditable per listing | GPT-5.5 mini | Medium | Supports current direct Gemini path and future OpenRouter/fallback routing |  
| 7 | BE | Expose AI attempt summary on listings API | UI can display model attempt counts without direct table access | GPT-5.5 mini | Low-Medium | Keeps `ai_model_attempts` backend-only while surfacing useful audit status |
| 7 | FE | Display AI attempt counts in listing review UI | Listing rows/review panel show AI attempt count and latest model attempt status | GPT-5.5 mini | Low-Medium | Makes generation audit visible during review | 
| 7 | BE | Add daily usage checks | Gemini and order sync limits are enforced | GPT-5.5 | Medium | Guardrail before fallback/router automation increases API call paths
| 7 | DB/BE | Add Gemini model catalog and resolver shell | Gemini client resolves task-specific model target from DB configuration instead of hardcoded model strings | GPT-5.5 | Medium | Enables SQL-driven model ordering before fallback execution logic |
| 7 | BE | Implement Gemini fallback execution router | Gemini generation cascades through configured eligible models on quota/rate-limit/unavailable errors | GPT-5.5 | Medium-High | Consumes model catalog, daily usage checks, and ai_model_attempts | 
| 7 | BE/FE | Display daily Gemini usage in UI | Dashboard/review UI shows today’s Gemini calls used, effective daily limit, remaining calls, and reset time, in local time | GPT-5.5 mini | Low-Medium | Gives visibility into free-tier usage before generation attempts fail | 
| 8 | BE/FE | Add sandbox environment visual indicator | UI clearly shows when sandbox eBay environment is active | GPT-5.5 mini | Low-Medium | Add thin red viewport border and small `SANDBOX` badge when backend reports `EBAY_ENVIRONMENT=sandbox`; no border in production |
| 8 | BE | Expose runtime eBay environment status | FE can display sandbox/live environment state safely | GPT-5.5 mini | Low | Add read-only sidecar endpoint returning environment, marketplace, API base, and production-publish-enabled flag; redact secrets |  
| 8 | BE | Recover existing eBay offer during publish | Re-publishing a SKU with an existing remote offer persists the offer ID and continues safely | GPT-5.5 mini | Medium | Handles sandbox/live drift when local DB was reset or previous publish partially succeeded | 
| 8 | BE | Add generated SKU-range sandbox cleanup mode | Predictable watcher SKUs can be cleaned without eBay inventory list endpoint | GPT-5.5 mini | Low-Medium | Add `--prefix Single- --from 1 --to 100`; generates `Single-000001` etc. and cleans only existing remote matches |  
| 8 | BE/FE | Display latest Gemini model in usage UI | Gemini usage chip shows the most recent real provider model next to the daily call counter | GPT-5.5 mini | Low-Medium | Extend `/api/gemini-usage` with latest `ai_model_attempts` model info; UI shows compact copy such as `Gemini: 12 / 540 used · Last: Gemini 3.5 Flash`; do not restore old AI Attempts counter |
| 8 | BE | Add live eBay publish config discovery CLI | Exact production policy IDs and merchant location keys can be discovered without using Seller Hub UI guesses | GPT-5.5 mini | Low-Medium | Read-only CLI lists live payment/fulfillment/return policies and inventory locations as sanitized JSON for updating app_settings.default; no listing, offer, policy, or location mutations | 
| 8 | BE | Add live eBay readiness diagnostics | Production OAuth, seller eligibility, policies, location, marketplace, and publish config can be checked before first real listing | GPT-5.5 | Medium | Extend sandbox diagnostics pattern for production; no listing mutation |  
| 8 | BE | Simplify raw card condition scale to eBay-supported values | Gemini and publish mapper only use eBay-compatible card condition values | GPT-5.5 mini | Low-Medium | Replace over-granular raw grading tokens with category-supported values: Near mint or better, Excellent, Very good, Poor; prevents publish failures like unsupported `EX-MT` | 
| 8 | FE | Update card condition UI to eBay-supported condition scale | Review form only displays and saves backend-supported raw card condition tokens | GPT-5.5 mini | Low-Medium | Replace legacy `EX - Excellent` style options with `Near mint or better`, `Excellent`, `Very good`, `Poor`; normalize old saved values in the UI so existing drafts can be corrected |
| 8 | BE | Harden pre-publish required-field validation | Bad listings are blocked before eBay API calls with user-fixable errors | GPT-5.5 mini | Medium | Foundation added: centralized validator now checks title, description, price, category ID, condition ID, image URLs, SKU, quantity, policy IDs, merchant location key, marketplace; live publish wiring still pending |
| 8 | BE | Validate category-required item specifics | Missing eBay-required aspects are surfaced before publish | GPT-5.5 | Medium | Important for trading-card categories; can rely on eBay validation details first if Taxonomy integration is deferred | 
| 8 | FE | Add first-live-listing review checklist | First production publish has explicit manual safety gate | GPT-5.5 mini | Low-Medium | Confirm title, price, category, condition, images, item specifics, policies, and production target | 
| 8 | BE | Add live publish duplicate-protection check | Re-publishing does not accidentally create dup live listings | GPT-5.5 mini | Medium | Respect existing SKU, `ebay_offer_id`, `ebay_listing_id`; publish should be idempotent/retry-safe | 
| 8 | BE | Add image URL eBay readiness check | R2-hosted images are verified before publish | GPT-5.5 mini | Low-Medium | Check HTTPS, public access, supported extension, non-empty response, and custom-domain URL | 
| 8 | Docs | Add controlled live pilot notes | First real listings can be tested safely while admin remains in eBay Seller Hub | GPT-5.5 mini | Low | Minimal notes only; avoid heavy runbook |
| 8 | BE | Add structured SKU parser and formatter | SKU format is centralized and validated | GPT-5.5 mini | Medium | Support BSKBL-Single-000002, BSBL-Lot-000002, OTHER-Single-000002; preserve existing numeric sequence; reject malformed category/type/sequence values |
| 8 | DB | Align listing SKU data for structured SKUs | Listings can store category-prefixed SKUs consistently | GPT-5.5 mini | Low-Medium | Confirm existing SKU/listing_id columns; add only minimal fields if unavoidable; no extra storage-location model; migration may normalize all current local records since no live listings exist | 
| 8 | BE | Add Gemini SKU category suggestion | AI draft returns one controlled SKU prefix | GPT-5.5 mini | Medium | Gemini may suggest only BSKBL, BSBL, or OTHER; backend validates/normalizes; uncertain cards default to OTHER; Gemini must not generate full SKU text | 
| 8 | BE | Finalize structured SKU before export approval | Reviewed listing gets locked category-prefixed SKU before publish | GPT-5.5 mini | Medium | On needs_review → approved_for_export, concatenate reviewed prefix + existing Single/Lot sequence; keep operation idempotent; do not change SKU after exported/listed/sold 
| 8 | BE | Update publish and duplicate-protection paths for structured SKUs | eBay receives the finalized structured SKU safely | GPT-5.5 mini | Medium | Publish uses BSKBL-Single-000002 style SKU; duplicate checks respect existing sku, ebay_offer_id, ebay_listing_id; retry does not create new SKU or duplicate offer | 
| 8 | FE | Review structured SKU prefix in needs_review | User can verify category prefix before approval | GPT-5.5 mini | Low-Medium | Show SKU preview such as BSKBL-Single-000002; allow prefix selection from BSKBL/BSBL/OTHER only; approval uses backend-derived final SKU, not free-text FE input | 
| 8 | Tests | Add end-to-end SKU workflow coverage | Structured SKU behavior is protected across intake, AI, review, approval, and publish | GPT-5.5 mini | Medium | Cover Single and Lot, all 3 prefixes, Gemini uncertainty → OTHER, manual override, idempotent approval, publish retry, malformed SKU rejection, no mutation after exported/listed/sold | 
| 8 | Docs | Reminder for personal spec in my google sheets -->
--------------- READY FOR LIVE PILOT --------------
| 8 | BE | Remove legacy required eBay access-token env vars | Server startup relies on refresh-token flow only | GPT-5.5 mini | Low | EBAY_USER_ACCESS_TOKEN and EBAY_APP_ACCESS_TOKEN should not be required if refresh-token OAuth is configured; update env validation and docs |
| 8 | BE/DB | Add manual listing status reconciliation tool | Exported listings can later be batch-marked listed/sold after Seller Hub-managed pilot | GPT-5.5 mini | Low-Medium | Defer until after initial live testing; useful before order sync exists |
| 8 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, and `sale_price` are persisted | GPT-5.5 mini | Medium | Storage foundation before scheduled order sync |
| 8 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work against eBay API | GPT-5.5 | Medium | Begin post-listing order workflow |
| 8 | BE | Match order SKU to `listing_id` | Sold listing is identified from order SKU | GPT-5.5 mini | Medium | Required before updating listings to sold |
| 8 | DB/BE | Update listing status to `sold` | Sale is tracked and listing status moves to `sold` when matched order data confirms sale | GPT-5.5 mini | Medium | Enables cleanup and fulfillment workflows |
| 8 | BE | `job-runner`: schedule 4 order checks/day | Controlled order sync runs 4 times per day | GPT-5.5 mini | Medium | Schedule only after order storage and matching exist |
| 8 | FE | Show due today/overdue warnings | 1-day handling risks are visible | GPT-5.5 mini | Low-Medium | Operational guardrail for fulfillment |
| 8 | FE | Improve listing image preview gallery | All listing images are visible at usable review size | GPT-5.5 mini | Low-Medium | Deferred QOL/review usability |
| 8 | BE | Normalize image orientation during asset processing | R2 images display with correct orientation | GPT-5.5 mini | Low-Medium | Defer unless EXIF issue is confirmed |
| 8 | BE/DB | Add `ai_model_attempts` cleanup policy | Old AI attempt audit rows are pruned after listings are sold/closed and retention window passes | GPT-5.5 mini | Low-Medium | Prevents long-term audit-table growth while preserving active-listing troubleshooting history |
| 9 | BE/FE | Wire lot intake mode end-to-end | Lot listings can be intentionally created, reviewed, published, and shipped | GPT-5.5 mini | Medium | Connect UI Single/Lot intent to watcher/backend; validate lot image grouping, quantity, title/description, weight/shipping, SKU finalization, and publish behavior |

| 9 | BE | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior is defined and enforced | GPT-5.5 mini | Low-Medium | Local disk cleanup guardrail |
| 9 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist | GPT-5.5 mini | Low-Medium | Required before R2 deletion automation |
| 9 | BE | On `sold`, set `r2_delete_after` | `r2_delete_after` is set from `sold_at + configured retention days` | GPT-5.5 mini | Low-Medium | Connects sold state to cleanup eligibility |
| 9 | FE | Show cleanup status lightly | Cleanup status is visible without becoming a major UI surface | GPT-5.5 mini | Low | Better after cleanup fields exist |
| 9 | BE | `r2-service`: `deleteObjects()` | R2 cleanup primitive works | GPT-5.5 mini | Medium | Deletion primitive before scheduled cleanup |
| 9 | BE | `job-runner`: cleanup eligible sold listings | Images are deleted after retention window | GPT-5.5 | Medium | Automated cleanup after retention window |
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
| 12 | Cleanup | Pare down tests | Remove unnecessary or redundant test cases for high-confidence/hardened test scenarios |
| 13 | Marketing/SEO | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition |
