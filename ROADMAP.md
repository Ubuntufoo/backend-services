# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

| Phase | Area | Task | Output |
| ----: | ---- | ---- | ------ |
<!--
PREVIOUS ROADMAP TASKS ARCHIVED
COMPLETED TASKS COMMENTED OUT -->
--------------- READY FOR LIVE PILOT: SPORTS CARD SINGLES --------------
| 10A.1 COMPLETED | BE/Docs | Reconfirm card-adjacent eBay taxonomy metadata | Recheck live `EBAY_US` taxonomy, leaf status, item aspects, and condition metadata for card singles/lots categories before behavior changes; confirm at minimum `261328`, `261329`, `183050`, `183051`, `183454`, `183455`, `2611`, `104049`, `38292`, `19113`, `31395`, and `49209`. Sealed packs are out of scope.
| 10A.2 | BE/Docs | Update category ID reference for multi-category card support | Update `backend-services/docs/ebay-category-ids.md` with refreshed results, explicitly separating sports cards, non-sport entertainment cards, and CCG/TCG cards; document that only singles/lots are planned long-term. |
| 10A.3 | BE/Architecture | Audit sports-card pipeline seams for category-family expansion | Document current impact areas for category families: capture modes, AI draft schema/prompt, category resolver, item-specific validation, pricing query/normalizer, condition mapping, publish payload, and SKU/category code behavior. No runtime behavior changes. |
| 10A.4 | BE/Architecture | Draft category-family foundation plan | Produce the Phase 1 backend plan for category-family support with sports-card behavior preserved as the regression baseline and non-sport entertainment card singles as the first implementation target.
| 10B.1 | BE/Architecture | Add category-family domain model | Introduce a small backend category-family model for `sports_card`, `non_sport_card`, `ccg_card`, `sports_memorabilia`, and `comic_book`; keep sports-card behavior as the default/regression baseline and do not expose new FE controls yet. |
| 10B.2 | BE/Architecture | Centralize eBay category metadata constants | Move card singles/lots category IDs and family mappings into one backend module, using the refreshed Phase 0 taxonomy docs as source material; exclude sealed-pack categories from supported runtime mappings. |
| 10B.3 | BE/Gemini | Make draft generation category-family aware internally | Prepare the AI draft contracts/prompt builder for family-specific aspect targets while preserving the current sports-card prompt output and parser compatibility. No non-sport runtime behavior change yet. |
| 10B.4 | BE/Listing Resolver | Refactor trading-card ID resolver behind category-family resolver seam | Keep existing sports-card category/condition resolution intact, but route through a category-family-aware resolver that can later support non-sport entertainment cards and CCG/TCG cards without duplicating ad hoc regex logic. |
| 10B.5 | BE/Pricing | Introduce category-family pricing identity seam | Extract current sports-card pricing identity assumptions into a sports-card adapter/target builder, leaving current query and normalizer behavior unchanged while creating the seam for non-sport card identity fields. |
| 10B.6 | BE/Publish | Introduce category-family publish validation seam | Keep current trading-card raw condition and item-specific validation behavior unchanged, but isolate category-family-specific required-aspect and condition handling so non-sport card support can be added incrementally. |
| 10B.7 | BE/Tests | Add regression tests around unchanged sports-card flow | Add focused tests proving sports-card singles still generate category IDs, raw condition IDs/descriptors, pricing queries, normalization, and publish validation as before after the category-family seam refactor. |
| 10C.1 | BE/Gemini | Add non-sport entertainment card draft target | Add backend support for non-sport entertainment card singles such as Marvel, Garbage Pail Kids, movie/TV, and pop-culture cards using fields like character, subject, franchise, year, manufacturer, set, and card number. |
| 10C.2 | BE/Resolver | Resolve non-sport entertainment card categories | Map non-sport entertainment card singles/lots to the confirmed non-sport card category IDs from Phase 0 while keeping sports-card and CCG/TCG routing separate. |
| 10C.3 | BE/Pricing | Add non-sport entertainment card pricing identity | Build pricing query and normalization identity for non-sport cards around franchise/character/subject/year/manufacturer/set/card number instead of player/sport assumptions. |
| 10C.4 | BE/Publish | Support non-sport entertainment card publish validation | Add required item-specific and raw card condition handling for non-sport entertainment cards based on refreshed eBay metadata, preserving existing sports-card publish behavior. |
| 10C.5 | BE/Tests | Add non-sport entertainment card backend coverage | Add focused tests for Marvel/Garbage Pail Kids-style singles through draft parsing, category resolution, pricing identity, and publish validation without adding FE behavior yet. |
| 10D.1 | FE/UX | Add controlled non-sport card intake intent | Add the minimal FE control needed to intentionally create/review non-sport entertainment card singles while keeping sports-card intake as the default path. |
| 10D.2 | FE/Review UI | Show non-sport card aspect fields | Display/edit non-sport card aspects such as character, subject, franchise, year, manufacturer, set, and card number in the review workflow. |
| 10D.3 | FE/Pricing UI | Display non-sport pricing diagnostics | Reuse the existing pricing research panel for non-sport cards while surfacing family-specific query, accepted/rejected comp counts, and failure reasons. |
| 10D.4 | FE/Tests | Add non-sport card frontend regression coverage | Add focused FE tests proving sports-card review remains unchanged and non-sport card review exposes only the intended new fields/controls. |
| 10E.1 | BE/Gemini | Add CCG/TCG draft target | Add backend support for CCG/TCG singles using card name, game, set, collector number, rarity, finish, language, and franchise/game-specific identity fields. |
| 10E.2 | BE/Resolver | Resolve CCG/TCG singles and lots categories | Map Pokémon, MTG, Yu-Gi-Oh!, and generic CCG singles/lots to confirmed category IDs from Phase 0; sealed packs remain unsupported. |
| 10E.3 | BE/Pricing | Add CCG/TCG pricing identity | Build CCG/TCG pricing query and normalization around card name, game, set, collector number, rarity, finish, and language instead of sports-card identity fields. |
| 10E.4 | BE/Publish | Support CCG/TCG publish validation | Add CCG/TCG item-specific and raw card condition handling based on refreshed eBay metadata, preserving existing sports-card and non-sport-card behavior. |
| 10E.5 | BE/Tests | Add CCG/TCG backend coverage | Add focused tests for Pokémon and MTG singles through draft parsing, category resolution, pricing identity, and publish validation. |
| 10F.1 | FE/UX | Add controlled CCG/TCG intake intent | Add the minimal FE control needed to intentionally create/review CCG/TCG singles after backend support is stable. |
| 10F.2 | FE/Review UI | Show CCG/TCG aspect fields | Display/edit CCG/TCG fields such as card name, game, set, collector number, rarity, finish, and language in the review workflow. |
| 10F.3 | FE/Pricing UI | Display CCG/TCG pricing diagnostics | Reuse the existing pricing research panel for CCG/TCG cards while surfacing family-specific query and rejected-comp diagnostics. |
| 10F.4 | FE/Tests | Add CCG/TCG frontend regression coverage | Add focused FE tests proving CCG/TCG review works and sports/non-sport card flows are not regressed. |
| 10G.1 | BE/Docs | Explore sports memorabilia taxonomy and publish constraints | Research eBay categories, condition IDs, required aspects, image needs, packaging assumptions, autograph/authenticity concerns, and pricing feasibility for plaques, programs, and autographed sports paraphernalia. |
| 10G.2 | BE/Architecture | Draft sports memorabilia implementation plan | Produce a separate backend plan for sports memorabilia without forcing it through trading-card assumptions; no runtime behavior changes yet. |
| 10H.1 | BE/Docs | Explore comic book taxonomy and publish constraints | Research eBay categories, condition IDs, required aspects, image needs, issue identity fields, raw/slab handling, and pricing feasibility for comic books. |
| 10H.2 | BE/Architecture | Draft comic book implementation plan | Produce a separate backend plan for comics without forcing it through trading-card assumptions; no runtime behavior changes yet. |
| 11 | BE/Archi | Re-evaluate dedicated pricing worker after live pilot | Decide whether to extract pricing into services/pricing-service based on live provider latency, queue impact, failure isolation needs, and local-dev overhead
| 11 | $BE/DB$ | Add manual listing status reconciliation tool | Exported listings can later be batch-marked listed/sold after Seller Hub-managed pilot
| 11 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, and `sale_price` are persisted
| 11 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work against eBay API
| 11 | BE | Match order SKU to `listing_id` | Sold listing is identified from order SKU
| 11 | DB/BE | Update listing status to `sold` | Sale is tracked and listing status moves to `sold` when matched order data confirms sale
| 11 | $BE$ | `job-runner`: schedule 4 order checks/day | Controlled order sync runs 4 times per day
| 11 | $FE$ | Show due today/overdue warnings | 1-day handling risks are visible
| 11 | $FE$ | Improve listing image preview gallery | All listing images are visible at usable review size
| 11 | $BE$ | Normalize image orientation during asset processing | R2 images display with correct orientation
| 11 | BE/DB | Add `ai_model_attempts` cleanup policy | Old AI attempt audit rows are pruned after listings are sold/closed and retention window passes
| 11 | $BE/Archi$ | Evaluate benefit of extracting pricing into `services/pricing-service` | Decision based on live Apify latency, failure isolation needs, local dev overhead, and pricing module coupling
| 12 | $BE/FE$ | Wire lot intake mode end-to-end | Lot listings can be intentionally created, reviewed, published, and shipped
| 12 | $BE$ | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior is defined and enforced
| 12 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist
| 12 | BE | On `sold`, set `r2_delete_after` | `r2_delete_after` is set from `sold_at + configured retention days`
| 12 | $FE$ | Show cleanup status lightly | Cleanup status is visible without becoming a major UI surface
| 12 | $BE$ | `r2-service`: `deleteObjects()` | R2 cleanup primitive works
| 12 | BE | `job-runner`: cleanup eligible sold listings | Images are deleted after retention window
| 13 | $FE$ | Add Sync Now buttons | Manual watcher/order sync control
| 13 | FE | Add settings screen | Edit `app_settings` safely
| 13 | $BE$ | Add service health checks | UI can show service status
| 13 | $BE$ | Add structured logs | Debuggability improves
| 13 | BE | Add production job-runner configuration | Tune polling interval, batch size, stale-running recovery, and worker enablement for production-like operation
| 13 | $BE$ | Add tests for status transitions | Workflow protection
| 13 | $BE$ | Add tests for publish validation | Prevent bad eBay calls
| 13 | $Docs$ | Add OPERATIONS.md | How to run/use system
| 13 | BE | Add read-only eBay query services | Messages, orders, listings, and inventory can be queried without LLM dependency
| 13 | BE | Add assistant tool registry | Allowed read-only tools are centrally defined
| 13 | BE | Add assistant intent router | Common user queries map to approved read-only tools
| 13 | BE | Add assistant response schemas | UI receives typed assistant results
| 13 | BE | Add read-only guardrails | Assistant cannot mutate eBay account state
| 13 | BE | Add assistant audit logs | Assistant tool calls are traceable
| 13 | BE | Add Gemini assistant bridge | Gemini can route/summarize approved read-only queries
| 14 | FE | Add Read-only eBay Assistant panel | User can query seller account data from UI
| 14 | $FE$ | Add assistant quick actions | Common queries work without model reasoning
| 14 | FE | Render assistant result cards | Messages, orders, listings, and inventory display cleanly
| 14 | $FE$ | Show assistant read-only mode | User understands assistant cannot publish, revise, reply, refund, or cancel
| 14 | $BE$ | Add tests for assistant routing and guardrails | Unsafe or unsupported assistant actions are blocked
| 14 | BE | BE audit: clean up and review for refactoring | Eliminate checklist scripts, stale tests, other development artifacts
| 14 | $Docs$ | Document Read-only eBay Assistant contract | Future assistant architecture is clear
| 14 | $Cleanup$ | Pare down tests | Remove unnecessary or redundant test cases for high-confidence/hardened test scenarios
| 15 | $Marketing/SEO$ | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition
