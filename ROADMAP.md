# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

| Phase | Area | Task | Output |
| ----: | ---- | ---- | ------ |
<!--PREVIOUS ROADMAP TASKS ARCHIVED
| Fix |  BE/Pricing | Skip comp API and LLM reasoning for known sports-card singles | Add a new `skip_comp_api` checkbox beside the generate button that bypasses the comp API call and LLM reasoning step, returning only the Gemini listing output. |
COMPLETED TASKS COMMENTED OUT -->
| Fix | BE/Listing | Add listing abandonment workflow | Add a new "Abandon Listing" button in the review UI that allows users to permanently delete a listing and all associated data, including persisted AI attempts, R2 images, and database rows. Ensure that this action is irreversible and prompts for confirmation before proceeding. |
--------------- READY FOR LIVE PILOT: SPORTS CARD SINGLES --------------
| 10A.1 | BE/Discovery | Confirm read-only production Browse search entitlement | Verify the production eBay keyset can mint an application token and call `GET /buy/browse/v1/item_summary/search`; record the effective Browse quota and any Buy API license or Developer Support prerequisites without adding transactional buying capabilities. |
| 10A.2 | BE/Discovery | Validate seller exclusion identifier in production | Resolve the authenticated seller identity through the existing user-token path, test the exact value accepted by Browse `excludeSellers`, and prove a known own listing is excluded from marketplace results. |
| 10A.3 | BE/Discovery | Validate exact-card active-search recall | Run sanitized production searches for several known sports cards, compare Browse candidates with visible eBay results, and confirm category, condition, fixed-price, query, and local title-filter behavior before implementation. |
| 10A.4 | BE/Architecture | Finalize exact active-market result contract | Define exhaustive pagination, unique-listing deduplication by `legacyItemId`, exact competitor count, completeness state, candidate/accepted/rejected counts, pages fetched, failure reasons, and the rule that partial scans never produce an exact count. |
| 10B.1 | BE/eBay API | Add explicit application-token REST request mode | Extend the existing eBay REST client with a narrow app-token request path that uses `getOrRefreshAppAccessToken()` for initial authentication and auth retry while preserving all existing user-token seller API behavior. |
| 10B.2 | BE/eBay API | Add typed Browse active-listing adapter | Implement a read-only Browse `item_summary/search` adapter with marketplace, canonical query, leaf category, fixed-price, condition, seller-exclusion, limit, offset/next, timeout, and strict response parsing support. |
| 10B.3 | BE/Tests | Cover app-token and Browse request contracts | Add focused tests for app-token selection when user credentials exist, app-token refresh after `401`, request/filter encoding, response validation, API errors, malformed responses, and existing seller API regression safety. |
| 10C.1 | BE/Pricing | Extract shared exact-card title rejection predicate | Refactor graded, selection, complete-set, range, conflicting year, conflicting card number, player, and base set/manufacturer checks into one reusable active/sold title predicate without changing current SoldComps acceptance behavior. |
| 10C.2 | BE/Tests | Prove active and sold exact-card filter parity | Add focused parity tests showing active candidates and sold comps apply the same card-identity title rules while active listings remain independent from sold-date and sold-price outlier checks. |
| 10D.1 | BE/Pricing | Implement exhaustive exact competitor-count service | Build the active-market service that follows every Browse `next` page, evaluates every candidate locally, excludes the seller, deduplicates accepted results by `legacyItemId`, and returns the exact unique competitor count only when the scan completes. |
| 10D.2 | BE/Pricing | Add bounded failure and completeness handling | Add dependency-injected timeout/page safeguards and convert `401`, `403`, `429`, `5xx`, timeout, malformed response, missing seller identity, pagination overflow, and incomplete traversal into an unavailable result with `exactCompetitorCount: null`. |
| 10D.3 | BE/Tests | Cover exact counting, pagination, and deduplication | Test zero, one, and many exact competitors; multi-page exhaustion; duplicate variation/item IDs collapsing by `legacyItemId`; own-listing exclusion; no-next completion; offset ceiling; timeout; partial-page failure; and unavailable-not-zero semantics. |
| 10E.1 | BE/Pricing | Replace blanket competitive discount with active-market adjustment | Replace the unconditional competitive `-5%` adjustment with exact-count tiers: zero competitors `+10%`, one competitor `0%`, and two or more competitors `-5%`; preserve the separate sales-velocity adjustment and round currency once after all deterministic multipliers. |
| 10E.2 | BE/Pricing | Wire active search concurrently into research-price job | Start the active-market lookup after canonical pricing input construction and run it concurrently with provider fetch, normalization, and LLM work; await it only at final price composition and never fail `research_price` when the active lookup is unavailable. |
| 10E.3 | BE/Pricing | Persist active-market audit diagnostics | Store canonical query, seller-exclusion status, candidate count, exact accepted competitor count, pages fetched, completeness, deduplication count, tier, multiplier, latency, and failure reason in existing pricing `raw_result_json` without a schema migration. |
| 10E.4 | BE/Tests | Cover pricing composition and failure isolation | Prove exact-count tier math, interaction with sales-velocity discounts, single final rounding, unavailable lookup using a neutral active-market multiplier, unchanged SoldComps/LLM behavior, and persistence of complete diagnostics. |
| 10F.1 | BE/MCP | Add optional read-only active-market diagnostic tool | Expose the shared Browse adapter through a bounded MCP tool for manual diagnostics, returning sanitized query/count/completeness data only and reusing the production adapter rather than duplicating search logic. |
| 10F.2 | BE/Tests | Cover MCP active-market guardrails | Verify the MCP tool is read-only, uses the application-token Browse path, redacts credentials, enforces bounded pagination/timeout behavior, and reports incomplete scans without returning false exact counts. |
| 10G.1 | FE/Pricing UI | Display active competitor diagnostics | Show exact active competitor count, derived pricing adjustment, lookup completeness, and concise unavailable reason in the existing pricing research panel without adding a separate workflow. |
| 10G.2 | FE/Tests | Add active-market pricing UI coverage | Add focused tests for exact counts, zero/one/many adjustments, unavailable lookup state, and unchanged rendering of existing SoldComps and sales-velocity diagnostics. |
| 10H.1 | BE/Live Pilot | Run production exact-count shadow pilot | Execute active-market lookup in shadow mode on live sports-card singles, persist diagnostics without changing price, and compare exact accepted counts against manual eBay searches across representative low- and high-result cards. |
| 10H.2 | BE/Live Pilot | Enable active-market pricing modifier after validation | Enable the exact-count modifier only after production entitlement, seller exclusion, exhaustive count accuracy, latency, quota usage, failure isolation, and shadow-pilot acceptance are confirmed. |
| 11A.1 COMPLETED | BE/Docs | Reconfirm card-adjacent eBay taxonomy metadata | Recheck live `EBAY_US` taxonomy, leaf status, item aspects, and condition metadata for card singles/lots categories before behavior changes; confirm at minimum `261328`, `261329`, `183050`, `183051`, `183454`, `183455`, `2611`, `104049`, `38292`, `19113`, `31395`, and `49209`. Sealed packs are out of scope.
| 11A.2 | BE/Docs | Update category ID reference for multi-category card support | Update `backend-services/docs/ebay-category-ids.md` with refreshed results, explicitly separating sports cards, non-sport entertainment cards, and CCG/TCG cards; document that only singles/lots are planned long-term. |
| 11A.3 | BE/Architecture | Audit sports-card pipeline seams for category-family expansion | Document current impact areas for category families: capture modes, AI draft schema/prompt, category resolver, item-specific validation, pricing query/normalizer, condition mapping, publish payload, and SKU/category code behavior. No runtime behavior changes. |
| 11A.4 | BE/Architecture | Draft category-family foundation plan | Produce the Phase 1 backend plan for category-family support with sports-card behavior preserved as the regression baseline and non-sport entertainment card singles as the first implementation target.
| 11B.1 | BE/Architecture | Add category-family domain model | Introduce a small backend category-family model for `sports_card`, `non_sport_card`, `ccg_card`, `sports_memorabilia`, and `comic_book`; keep sports-card behavior as the default/regression baseline and do not expose new FE controls yet. |
| 11B.2 | BE/Architecture | Centralize eBay category metadata constants | Move card singles/lots category IDs and family mappings into one backend module, using the refreshed Phase 0 taxonomy docs as source material; exclude sealed-pack categories from supported runtime mappings. |
| 11B.3 | BE/Gemini | Make draft generation category-family aware internally | Prepare the AI draft contracts/prompt builder for family-specific aspect targets while preserving the current sports-card prompt output and parser compatibility. No non-sport runtime behavior change yet. |
| 11B.4 | BE/Listing Resolver | Refactor trading-card ID resolver behind category-family resolver seam | Keep existing sports-card category/condition resolution intact, but route through a category-family-aware resolver that can later support non-sport entertainment cards and CCG/TCG cards without duplicating ad hoc regex logic. |
| 11B.5 | BE/Pricing | Introduce category-family pricing identity seam | Extract current sports-card pricing identity assumptions into a sports-card adapter/target builder, leaving current query and normalizer behavior unchanged while creating the seam for non-sport card identity fields. |
| 11B.6 | BE/Publish | Introduce category-family publish validation seam | Keep current trading-card raw condition and item-specific validation behavior unchanged, but isolate category-family-specific required-aspect and condition handling so non-sport card support can be added incrementally. |
| 11B.7 | BE/Tests | Add regression tests around unchanged sports-card flow | Add focused tests proving sports-card singles still generate category IDs, raw condition IDs/descriptors, pricing queries, normalization, and publish validation as before after the category-family seam refactor. |
| 11C.1 | BE/Gemini | Add non-sport entertainment card draft target | Add backend support for non-sport entertainment card singles such as Marvel, Garbage Pail Kids, movie/TV, and pop-culture cards using fields like character, subject, franchise, year, manufacturer, set, and card number. |
| 11C.2 | BE/Resolver | Resolve non-sport entertainment card categories | Map non-sport entertainment card singles/lots to the confirmed non-sport card category IDs from Phase 0 while keeping sports-card and CCG/TCG routing separate. |
| 11C.3 | BE/Pricing | Add non-sport entertainment card pricing identity | Build pricing query and normalization identity for non-sport cards around franchise/character/subject/year/manufacturer/set/card number instead of player/sport assumptions. |
| 11C.4 | BE/Publish | Support non-sport entertainment card publish validation | Add required item-specific and raw card condition handling for non-sport entertainment cards based on refreshed eBay metadata, preserving existing sports-card publish behavior. |
| 11C.5 | BE/Tests | Add non-sport entertainment card backend coverage | Add focused tests for Marvel/Garbage Pail Kids-style singles through draft parsing, category resolution, pricing identity, and publish validation without adding FE behavior yet. |
| 11D.1 | FE/UX | Add controlled non-sport card intake intent | Add the minimal FE control needed to intentionally create/review non-sport entertainment card singles while keeping sports-card intake as the default path. |
| 11D.2 | FE/Review UI | Show non-sport card aspect fields | Display/edit non-sport card aspects such as character, subject, franchise, year, manufacturer, set, and card number in the review workflow. |
| 11D.3 | FE/Pricing UI | Display non-sport pricing diagnostics | Reuse the existing pricing research panel for non-sport cards while surfacing family-specific query, accepted/rejected comp counts, and failure reasons. |
| 11D.4 | FE/Tests | Add non-sport card frontend regression coverage | Add focused FE tests proving sports-card review remains unchanged and non-sport card review exposes only the intended new fields/controls. |
| 11E.1 | BE/Gemini | Add CCG/TCG draft target | Add backend support for CCG/TCG singles using card name, game, set, collector number, rarity, finish, language, and franchise/game-specific identity fields. |
| 11E.2 | BE/Resolver | Resolve CCG/TCG singles and lots categories | Map Pokémon, MTG, Yu-Gi-Oh!, and generic CCG singles/lots to confirmed category IDs from Phase 0; sealed packs remain unsupported. |
| 11E.3 | BE/Pricing | Add CCG/TCG pricing identity | Build CCG/TCG pricing query and normalization around card name, game, set, collector number, rarity, finish, and language instead of sports-card identity fields. |
| 11E.4 | BE/Publish | Support CCG/TCG publish validation | Add CCG/TCG item-specific and raw card condition handling based on refreshed eBay metadata, preserving existing sports-card and non-sport-card behavior. |
| 11E.5 | BE/Tests | Add CCG/TCG backend coverage | Add focused tests for Pokémon and MTG singles through draft parsing, category resolution, pricing identity, and publish validation. |
| 11F.1 | FE/UX | Add controlled CCG/TCG intake intent | Add the minimal FE control needed to intentionally create/review CCG/TCG singles after backend support is stable. |
| 11F.2 | FE/Review UI | Show CCG/TCG aspect fields | Display/edit CCG/TCG fields such as card name, game, set, collector number, rarity, finish, and language in the review workflow. |
| 11F.3 | FE/Pricing UI | Display CCG/TCG pricing diagnostics | Reuse the existing pricing research panel for CCG/TCG cards while surfacing family-specific query and rejected-comp diagnostics. |
| 11F.4 | FE/Tests | Add CCG/TCG frontend regression coverage | Add focused FE tests proving CCG/TCG review works and sports/non-sport card flows are not regressed. |
| 11G.1 | BE/Docs | Explore sports memorabilia taxonomy and publish constraints | Research eBay categories, condition IDs, required aspects, image needs, packaging assumptions, autograph/authenticity concerns, and pricing feasibility for plaques, programs, and autographed sports paraphernalia. |
| 11G.2 | BE/Architecture | Draft sports memorabilia implementation plan | Produce a separate backend plan for sports memorabilia without forcing it through trading-card assumptions; no runtime behavior changes yet. |
| 11H.1 | BE/Docs | Explore comic book taxonomy and publish constraints | Research eBay categories, condition IDs, required aspects, image needs, issue identity fields, raw/slab handling, and pricing feasibility for comic books. |
| 11H.2 | BE/Architecture | Draft comic book implementation plan | Produce a separate backend plan for comics without forcing it through trading-card assumptions; no runtime behavior changes yet. |
| 12 | BE/Archi | Re-evaluate dedicated pricing worker after live pilot | Decide whether to extract pricing into services/pricing-service based on live provider latency, queue impact, failure isolation needs, and local-dev overhead
| 12 | $BE/DB$ | Add manual listing status reconciliation tool | Exported listings can later be batch-marked listed/sold after Seller Hub-managed pilot
| 12 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, and `sale_price` are persisted
| 12 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work against eBay API
| 12 | BE | Match order SKU to `listing_id` | Sold listing is identified from order SKU
| 12 | DB/BE | Update listing status to `sold` | Sale is tracked and listing status moves to `sold` when matched order data confirms sale
| 12 | $BE$ | `job-runner`: schedule 4 order checks/day | Controlled order sync runs 4 times per day
| 12 | $FE$ | Show due today/overdue warnings | 1-day handling risks are visible
| 12 | $FE$ | Improve listing image preview gallery | All listing images are visible at usable review size
| 12 | $BE$ | Normalize image orientation during asset processing | R2 images display with correct orientation
| 12 | BE/DB | Add `ai_model_attempts` cleanup policy | Old AI attempt audit rows are pruned after listings are sold/closed and retention window passes
| 12 | $BE/Archi$ | Evaluate benefit of extracting pricing into `services/pricing-service` | Decision based on live Apify latency, failure isolation needs, local dev overhead, and pricing module coupling
| 13 | $BE/FE$ | Wire lot intake mode end-to-end | Lot listings can be intentionally created, reviewed, published, and shipped
| 13 | $BE$ | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior is defined and enforced
| 13 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist
| 13 | BE | On `sold`, set `r2_delete_after` | `r2_delete_after` is set from `sold_at + configured retention days`
| 13 | $FE$ | Show cleanup status lightly | Cleanup status is visible without becoming a major UI surface
| 13 | $BE$ | `r2-service`: `deleteObjects()` | R2 cleanup primitive works
| 13 | BE | `job-runner`: cleanup eligible sold listings | Images are deleted after retention window
| 14 | $FE$ | Add Sync Now buttons | Manual watcher/order sync control
| 14 | FE | Add settings screen | Edit `app_settings` safely
| 14 | $BE$ | Add service health checks | UI can show service status
| 14 | $BE$ | Add structured logs | Debuggability improves
| 14 | BE | Add production job-runner configuration | Tune polling interval, batch size, stale-running recovery, and worker enablement for production-like operation
| 14 | $BE$ | Add tests for status transitions | Workflow protection
| 14 | $BE$ | Add tests for publish validation | Prevent bad eBay calls
| 14 | $Docs$ | Add OPERATIONS.md | How to run/use system
| 14 | BE | Add read-only eBay query services | Messages, orders, listings, and inventory can be queried without LLM dependency
| 14 | BE | Add assistant tool registry | Allowed read-only tools are centrally defined
| 14 | BE | Add assistant intent router | Common user queries map to approved read-only tools
| 14 | BE | Add assistant response schemas | UI receives typed assistant results
| 14 | BE | Add read-only guardrails | Assistant cannot mutate eBay account state
| 14 | BE | Add assistant audit logs | Assistant tool calls are traceable
| 14 | BE | Add Gemini assistant bridge | Gemini can route/summarize approved read-only queries
| 15 | FE | Add Read-only eBay Assistant panel | User can query seller account data from UI
| 15 | $FE$ | Add assistant quick actions | Common queries work without model reasoning
| 15 | FE | Render assistant result cards | Messages, orders, listings, and inventory display cleanly
| 15 | $FE$ | Show assistant read-only mode | User understands assistant cannot publish, revise, reply, refund, or cancel
| 15 | $BE$ | Add tests for assistant routing and guardrails | Unsafe or unsupported assistant actions are blocked
| 15 | BE | BE audit: clean up and review for refactoring | Eliminate checklist scripts, stale tests, other development artifacts
| 15 | $Docs$ | Document Read-only eBay Assistant contract | Future assistant architecture is clear
| 15 | $Cleanup$ | Pare down tests | Remove unnecessary or redundant test cases for high-confidence/hardened test scenarios
| 16 | $Marketing/SEO$ | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition
