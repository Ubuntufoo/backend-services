# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

Future Consideration:
Maintain workflow, pricing, and publish abstractions so listing types can expand beyond single and lot. Anticipated future support includes eBay "You Pick" style inventory listings where one listing may represent multiple underlying inventory items.

| Phase | Area | Task | Output |
|---:|---|---|---|
<!--
| 9A.1 | BE/Types | Add `research_price` job type | `packages/types` recognizes pricing jobs; no runtime behavior yet |
| 9A.2 | DB | Add pricing research table | `listing_price_research` stores deterministic stats, normalized comps, raw provider output, and LLM reasoning fields |
| 9A.3 | BE/Data | Add pricing research repository | Data package can create, read, mark succeeded, and mark failed pricing research rows |
| 9A.4 | BE/Data | Add `research_price` enqueue helper | One active pricing job per listing is idempotent; default `maxAttempts=1` |
| 9A.5 | BE/Env | Add disabled-by-default Apify config | Blank Apify env values do not block startup; token/actor required only when enabled; `APIFY_MIN_SOLD_COMPS=12` |
| 9B.1 | BE/Pricing | Add pricing provider interface and fixture provider | Pricing tests can run without Apify or live network calls; fixture returns at least 12 sold comps |
| 9B.2 | BE/Pricing | Add sold-comps normalizer | Raw provider records normalize into stable comp objects with price, shipping, total, sold date, title, and URL |
| 9B.3 | BE/Pricing | Add deterministic pricing stats | Service computes sold count, median, low, high, and deterministic fallback price |
| 9B.4 | BE/Pricing | Add confidence scoring | Pricing output includes confidence only; no single/lot recommendation logic |
| 9B.5 | BE/Tests | Add normalizer fixture tests | Noisy Apify-like records are parsed, filtered, and priced predictably |
| 9C.1 | BE/Jobs | Add `runResearchPriceJob` fixture path | A `needs_review` single listing can run pricing and complete |
| 9C.2 | BE/Jobs | Keep pricing workflow-safe | Pricing failures do not alter listing workflow, block review, or write to `listing.last_error_*` |
| 9C.3 | BE/Jobs | Update listing price on pricing success | `listings.price` is overwritten only from a valid suggested price; listing stays `needs_review/review_pending` |
| 9C.4 | BE/Jobs | Reject unsupported pricing inputs safely | Lot and non-review listings fail pricing job without disrupting listing state |
| 9C.5 | BE/Tests | Add job-runner pricing tests | Success, lot reject, non-review reject, provider failure, and price update behavior are covered |
| 9D.1 | BE/Pricing | Audit LLM pricing architecture | Confirm Gemma 4 31B can plug into existing model/task routing safely; document seams, config impact, and risks |
| 9D.2 | BE/Pricing | Add LLM pricing reasoning schema | Pricing analyst output is strictly validated before it can affect price |
| 9D.3 | BE/Pricing | Add compact LLM pricing prompt builder | LLM receives listing facts, deterministic stats, and normalized comps; never raw provider output |
| 9D.4 | BE/Pricing | Add fixture LLM pricing analyst | Tests can exercise LLM-assisted pricing without provider calls |
| 9D.5 | BE/Models | Add per-model usage windows | Pricing model limits can enforce 15 RPM and 1.5k RPD safely across workers |
| 9D.6 | BE/Models | Add Gemma 4 31B pricing route config | Pricing reasoning has explicit `pricing_reasoning` route config for `gemma-4-31b-it` |
| 9D.7 | BE/Jobs | Wire validated LLM pricing behind deterministic fallback | Valid LLM output can affect suggested price; invalid/failing LLM falls back to deterministic pricing |
| 9D.8 | BE/Tests | Harden LLM pricing validation coverage | Bad LLM output cannot corrupt price, confidence, selected/rejected comps, or listing workflow |
| 9E.1 | BE/Jobs | Enqueue pricing after successful Gemini generation | `generate_ai` completion creates or ensures one `research_price` job for single listings |
| 9E.2 | BE/Jobs | Make pricing enqueue failure non-blocking | Gemini job still completes if pricing enqueue fails |
| 9E.3 | BE/Jobs | Add pricing job observability logs | Logs show listing ID, comp count, confidence, suggested price, and provider failure details |
| 9E.4 | BE/Tests | Add post-Gemini enqueue tests | Successful draft generation queues pricing without duplicate active pricing jobs |
| 9F.1 | BE/Apify | Add Apify provider adapter shell | Adapter constructs Actor input and parses Actor output behind `APIFY_ENABLED` |
| 9F.2 | BE/Apify | Add Apify actor config diagnostics | CLI/API can verify token, actor ID, min comps, timeout, and enabled state |
| 9F.3 | BE/Apify | Add Apify rate-limit/failure classification | Rate-limit/provider failures fail only the pricing job; listing pipeline continues |
| 9F.4 | BE/Apify | Add live Apify smoke script | One selected listing can run live pricing from CLI when `APIFY_ENABLED=true` |
| 9F.5 | $BE/Tests$ | Add Apify adapter fixture coverage | Adapter handles rate limits, malformed responses, and fewer-than-12-comp responses without spending credits |
| 9G.0 | BE/API | Add global pricing-service enable setting | Backend exposes and persists a global pricing-service enabled flag so FE can display and toggle pricing on/off safely |
| 9G.1 | FE | Add manual toggle for price service on/off in UI | In the UI, reviewers can enable or disable the price service globally |
| 9G.2 | $BE/Docs$ | Add controlled Apify pricing pilot notes | Minimal instructions for first live pricing tests from CLI |
| 9G.3 | $BE/Ops$ | Add one-listing live pricing command | Specific listing IDs can be priced without waiting for the runner loop |
| 9G.4 | $BE/Pricing$ | Tune trading-card query builder | Query builder uses player, year, set, card number, parallel, and raw/graded signals |  
| 9G.5 | BE/Gemini | Canonicalize trading-card metadata for pricing | Gemini and backend normalization capture pricing-critical aspects, including Card Number, Year, Manufacturer, Set, and aliases |
| 9G.6 | BE/Pricing | Normalize Apify trading-card pricing queries | Sold-comps queries use concise canonical metadata and avoid duplicate player/year/card-number terms |
| 9G.7 | BE/Pricing | Simplify Apify sold-comp request count source | Normal Apify pricing paths request 20 comps from one canonical constant; diagnostic env checks stay isolated |
| 9J.1 | BE/Pricing | Extract provider-neutral sold-comps query builder | Apify and SoldComps can reuse canonical trading-card query construction without provider-specific duplication |
| 9J.2 | BE/SoldComps | Add SoldComps provider adapter and config | SoldComps authenticates, requests 50 comps, maps responses into the shared pricing contract, and classifies failures safely |
| 9J.3 | BE/API | Replace pricing boolean with provider-mode setting | App settings persist and expose `off`, `soldcomps`, or `apify`; migrate the legacy boolean safely; `soldcomps` is the default enabled mode and the persisted mode becomes the sole runtime authority |
| 9J.4 | BE/Pricing | Add provider resolver and wire queued pricing | Normal queued `research_price` jobs resolve the persisted mode, use SoldComps by default, classify either live provider safely, and never silently use fixtures; provider fallback remains deferred |
<!-- | 9J.5 | BE/Ops | Switch `pricing:price-one` to SoldComps | One-listing live pricing uses SoldComps with focused config diagnostics and smoke coverage; output identifies the selected and actual provider | -->
COMPLETED TASKS COMMENTED OUT -->
| 9J.6 | FE | Add pricing provider dashboard selector | Dashboard segmented control selects Pricing Off, SoldComps, or Apify; reflects persisted mode and handles loading, saving, disabled, and backend configuration-error states |
| 9J.7 | BE/Tests | Add multi-provider selection and runtime wiring coverage | Tests prove `off` skips enqueue/execution safely, each live mode selects the intended provider, failures remain workflow-safe, and queued jobs never silently use fixtures |
| 9J.8 | BE/Pricing | Harden price update policy | Listing price updates only after a validated positive result and successfully stored research row, regardless of selected provider |
| 9J.9 | BE/Pricing | Add provider fallback routing | Deferred: optionally fall back between SoldComps and Apify after live provider behavior is understood |
| 9H.1 | $BE/API$ | Expose latest pricing research on listings API | FE can later display pricing context without direct table access |
| 9H.2 | $FE$ | Display pricing research summary in review UI | Review UI shows suggested price, confidence, explanation, and selected/rejected comps |
| 9H.3 | BE/FE | Display pricing failures without blocking approval | Rate-limit/provider failures are visible but do not block export |
| 9I.1 | $BE/Archi$ | Eval extracting pricing into `services/pricing-service` | Decision based on live Apify latency, failure isolation needs, local dev overhead, and pricing module coupling |
| 9I.2 | BE/Archi | Extract pricing worker to dedicated service if justified | Pricing runs its own workspace service while preserving shared data contracts and non-blocking listing workflow |
| 9I.3 | $BE/Pricing$ | Add Apify pricing eligibility gate | Low-value or low-confidence lot candidates skip live Apify; only likely singles or manually selected listings spend Apify credits | GPT-5.5 mini | Medium | Protects monthly Apify budget; use listing metadata, Gemini draft confidence, estimated value threshold, duplicate-cache checks, and manual override |
| 9I.4 | BE/Pricing | Add Apify usage budget guard | Live Apify calls stop before daily/monthly local caps are exceeded | GPT-5.5 mini | Low-Medium | Track run count/estimated spend; default conservative caps; allow CLI override only for smoke/manual testing |
| 9I.5 | $DOCS$ | Repo docs need a macro review to reflect the new pricing service and its integration with the existing architecture | General doc cleanup should also be done in this pass |
--------------- READY FOR LIVE PILOT --------------
| 10 | $BE/FE$ | Remove 'assets_ready' (seller hints) step for singles | Single listings skip AI generation and go straight from watcher intake to review | GPT-5.5 mini | Medium | Simplifies single listing flow for pilot; lot listings keep full flow with seller hints and Gemini draft |
| 10 | $BE/DB$ | Add manual listing status reconciliation tool | Exported listings can later be batch-marked listed/sold after Seller Hub-managed pilot | GPT-5.5 mini | Low-Medium | Defer until after initial live testing; useful before order sync exists |
| 10 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, and `sale_price` are persisted | GPT-5.5 mini | Medium | Storage foundation before scheduled order sync |
| 10 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work against eBay API | GPT-5.5 | Medium | Begin post-listing order workflow |
| 10 | BE | Match order SKU to `listing_id` | Sold listing is identified from order SKU | GPT-5.5 mini | Medium | Required before updating listings to sold |
| 10 | DB/BE | Update listing status to `sold` | Sale is tracked and listing status moves to `sold` when matched order data confirms sale | GPT-5.5 mini | Medium | Enables cleanup and fulfillment workflows |
| 10 | $BE$ | `job-runner`: schedule 4 order checks/day | Controlled order sync runs 4 times per day | GPT-5.5 mini | Medium | Schedule only after order storage and matching exist |
| 10 | $FE$ | Show due today/overdue warnings | 1-day handling risks are visible | GPT-5.5 mini | Low-Medium | Operational guardrail for fulfillment |
| 10 | $FE$ | Improve listing image preview gallery | All listing images are visible at usable review size | GPT-5.5 mini | Low-Medium | Deferred QOL/review usability |
| 10 | $BE$ | Normalize image orientation during asset processing | R2 images display with correct orientation | GPT-5.5 mini | Low-Medium | Defer unless EXIF issue is confirmed |
| 10 | BE/DB | Add `ai_model_attempts` cleanup policy | Old AI attempt audit rows are pruned after listings are sold/closed and retention window passes | GPT-5.5 mini | Low-Medium | Prevents long-term audit-table growth while preserving active-listing troubleshooting history |
| 11 | $BE/FE$ | Wire lot intake mode end-to-end | Lot listings can be intentionally created, reviewed, published, and shipped | GPT-5.5 mini | Medium | Connect UI Single/Lot intent to watcher/backend; validate lot image grouping, quantity, title/description, weight/shipping, SKU finalization, and publish behavior |
| 11 | $BE$ | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior is defined and enforced | GPT-5.5 mini | Low-Medium | Local disk cleanup guardrail |
| 11 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist | GPT-5.5 mini | Low-Medium | Required before R2 deletion automation |
| 11 | BE | On `sold`, set `r2_delete_after` | `r2_delete_after` is set from `sold_at + configured retention days` | GPT-5.5 mini | Low-Medium | Connects sold state to cleanup eligibility |
| 11 | $FE$ | Show cleanup status lightly | Cleanup status is visible without becoming a major UI surface | GPT-5.5 mini | Low | Better after cleanup fields exist |
| 11 | $BE$ | `r2-service`: `deleteObjects()` | R2 cleanup primitive works | GPT-5.5 mini | Medium | Deletion primitive before scheduled cleanup |
| 11 | BE | `job-runner`: cleanup eligible sold listings | Images are deleted after retention window | GPT-5.5 | Medium | Automated cleanup after retention window |
| 12 | $FE$ | Add Sync Now buttons | Manual watcher/order sync control |
| 12 | FE | Add settings screen | Edit `app_settings` safely |
| 12 | $BE$ | Add service health checks | UI can show service status |
| 12 | $BE$ | Add structured logs | Debuggability improves |
| 12 | BE | Add production job-runner configuration | Tune polling interval, batch size, stale-running recovery, and worker enablement for production-like operation |
| 12 | $BE$ | Add tests for status transitions | Workflow protection |
| 12 | $BE$ | Add tests for publish validation | Prevent bad eBay calls |
| 12 | $Docs$ | Add OPERATIONS.md | How to run/use system |
| 12 | BE | Add read-only eBay query services | Messages, orders, listings, and inventory can be queried without LLM dependency |
| 12 | BE | Add assistant tool registry | Allowed read-only tools are centrally defined |
| 12 | BE | Add assistant intent router | Common user queries map to approved read-only tools |
| 12 | BE | Add assistant response schemas | UI receives typed assistant results |
| 12 | BE | Add read-only guardrails | Assistant cannot mutate eBay account state |
| 12 | BE | Add assistant audit logs | Assistant tool calls are traceable |
| 12 | BE | Add Gemini assistant bridge | Gemini can route/summarize approved read-only queries |
| 13 | FE | Add Read-only eBay Assistant panel | User can query seller account data from UI |
| 13 | $FE$ | Add assistant quick actions | Common queries work without model reasoning |
| 13 | FE | Render assistant result cards | Messages, orders, listings, and inventory display cleanly |
| 13 | $FE$ | Show assistant read-only mode | User understands assistant cannot publish, revise, reply, refund, or cancel |
| 13 | $BE$ | Add tests for assistant routing and guardrails | Unsafe or unsupported assistant actions are blocked |
| 13 | BE | BE audit: clean up and review for refactoring | Eliminate checklist scripts, stale tests, other development artifacts |
| 13 | $Docs$ | Document Read-only eBay Assistant contract | Future assistant architecture is clear |
| 13 | $Cleanup$ | Pare down tests | Remove unnecessary or redundant test cases for high-confidence/hardened test scenarios |
| 14 | $Marketing/SEO$ | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition |
