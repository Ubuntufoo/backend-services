# ROADMAP

Note: Commented out early tasks that have been completed to keep the focus on upcoming work.

Future Consideration:
Maintain workflow, pricing, and publish abstractions so listing types can expand beyond single and lot. Anticipated future support includes eBay "You Pick" style inventory listings where one listing may represent multiple underlying inventory items.

| Phase | Area | Task | Output |
| ----: | ---- | ---- | ------ |

<!--
PREVIOUS ROADMAP TASKS ARCHIVED
| 9J.18 | FE/Dashboard | Surface pricing-analysis warnings in Operational Summary | Display non-blocking pricing-analysis warnings alongside existing operational issues with concise user-facing messaging |
| 9J.19 | FE/Dashboard | Add pricing-analysis retry action | Operational Summary warnings include a retry control and refresh warning state after successful rerun |
| 9J.20 | BE/Pricing | Add pricing-analysis retry workflow | Implement dedicated retry path for failed LLM pricing analysis while preserving the existing deterministic price until retry succeeds |
| 9J.21 | BE/Pricing | Add provider fallback routing | Deferred: optionally fall back between SoldComps and Apify after live provider behavior is understood |
| 9J.3 | FE/Dashboard | Dismiss button for individual pricing-analysis errors/warnings from UI | After retry workflow is live and initial issues are resolved, remove pricing-analysis warnings from the UI to reduce noise and focus on actionable issues |
| 9K.1 | $BE/API$ | Expose latest pricing research on listings API | FE can later display pricing context without direct table access |
| 9K.2 | $FE$ | Display pricing research summary in review UI | Review UI shows suggested price, confidence, explanation, and selected/rejected comps |
| 9K.3 | BE/FE | Display pricing failures without blocking approval | Rate-limit/provider failures are visible but do not block export |
| 9M.1 | BE/Performance | End-to-end latency audit of AI and pricing pipeline | Profile Gemini Draft Generation, pricing-provider calls, normalization, persistence, and LLM price reasoning; identify payload bloat, unnecessary data transfers, serialization overhead, redundant transforms, and external-call bottlenecks; produce prioritized optimization plan with estimated savings per stage |
| 9M.2 | BE/Performance | Implement approved latency optimizations | Apply findings from 9K.1 including Gemini payload reduction, provider request/persistence simplification, pricing-provider request optimization, LLM reasoning payload minimization, caching/reuse opportunities, parallelization where safe, and reduced DB/payload overhead; benchmark before/after latency improvements |
| 9N.1 | BE/Architecture | Repository architecture cleanup pass | Review service boundaries, dependency flow, shared contracts, abstractions, utility layers, and project structure; remove unnecessary complexity, dead abstractions, and architectural drift while preserving behavior |
| 9N.2A | BE/API | HTTP API cleanup pass | Review HTTP routes, DTOs, request validation, response shaping, route-local error handling, and stale diagnostics; remove defensive-code slop, redundant logic, inconsistent API patterns, and behavior-preserving dead code |
| 9N.2B | BE/Jobs | Job workflow cleanup pass | Review job orchestration, retry handling, workflow transitions, lease/stale-running recovery, and async error paths; remove redundant guards, stale diagnostics, inconsistent transition logic, and behavior-preserving job-runner slop |
| RTK.1 | Tooling/RTK | Add deterministic context-view commands | Add project-agnostic `rtk view` commands for compact, source-recoverable working views of bulky artifacts: `tree`, `log`, `json`, `csv`, `diff`, and `source`; each view reports filters, counts, omitted data, samples, and raw slice pointers so Codex can reason from compact context and fetch exact raw ranges only when needed. |
COMPLETED TASKS COMMENTED OUT -->
RTK.1A | Tooling/RTK | Prototype wrapper-level `rtk view` dispatcher | Add `rtk view <tree|diff|source|json|log|csv>` to `~/.codex/rtk/rtk-wrapper.sh`, delegating existing views to `rtk-real`, adding deterministic help/errors, and implementing only bounded CSV/source handling where no existing RTK command exists.
| 9O.1 | BE/Pricing | Add pricing fallback query for zero provider results | When SoldComps returns zero provider results for a canonical query with modifiers, retry once with a controlled relaxed query variant before marking deterministic price invalid; preserve accepted/rejected comp semantics and record both strict and fallback query diagnostics |
| 9O.2 | BE/FE Review Workflow | Allow regenerate and reprice after deterministic pricing failure | From review UI, allow rerunning AI generation and/or pricing after seller hints, item specifics JSON, or pricing modifier checkboxes change; support `research_price_suggested_price_invalid` as a retryable workflow state rather than forcing manual price only |
| 9O. | FE/Pricing UI | Surface provider-zero vs rejected-comps failure reason | Distinguish “provider returned zero results” from “provider returned comps but backend rejected them”; show query, provider item count, sample titles when present, and retry actions appropriate to the failure mode |
| 9N.3 | BE/Pricing | Pricing subsystem cleanup pass | Review providers, query builders, normalization, research jobs, persistence, LLM reasoning, and pricing diagnostics; eliminate redundant payloads, unnecessary transforms, excess telemetry, style drift, and weak typing |
| 9N.4 | BE/Integrations & Data | eBay, Gemini, persistence, and data-layer cleanup pass | Review external integrations, repositories, database access, storage contracts, scripts, and shared types; simplify code paths, remove duplication, tighten typing, and standardize patterns |
| 9N.5 | BE/Quality | Test suite, fixtures, tooling, and documentation cleanup pass | Remove redundant tests, stale fixtures, obsolete scripts, outdated documentation, and development artifacts; align remaining assets with current architecture |
| 9N.6 | FE/Architecture | Frontend architecture cleanup pass | Review component organization, hooks, API clients, state management, utilities, and shared types; remove duplication, simplify data flow, and standardize patterns |
| 9N.7 | FE/UI | Dashboard, review workflow, and UI cleanup pass | Review listing workflow screens, pricing UI, operational summary, settings, and shared components; remove UI-specific slop, dead code, unnecessary state, and inconsistent implementations |
| 9N.8 | FE/Quality | Frontend typing, tests, and documentation cleanup pass | Tighten TypeScript usage, remove unnecessary casts, clean test coverage, remove stale code paths, and align documentation with current frontend architecture |
| 9N.9 | BE/FE | Final repository-wide consistency audit | Perform a final cross-repo review for naming consistency, coding conventions, diagnostics, logging, typing, comments, and style; resolve remaining inconsistencies and produce a cleanup report |
9N.10 | BE/Architecture | Audit sidecar data facade usage | Identify unused SidecarDataAccess methods and possible subdomain splits without changing behavior.
9N.11 | BE/Pricing | Audit pricing barrel imports | Classify pricing/index imports and replace only low-risk runtime imports with direct module imports.
9N.12 | Docs/Architecture | Consolidate backend architecture docs | Keep docs/architecture.md as source of truth while preserving concise routing summaries in README/AGENTS.
--------------- READY FOR LIVE PILOT --------------
| 10 | BE/Archi | Re-evaluate dedicated pricing worker after live pilot | Decide whether to extract pricing into services/pricing-service based on live provider latency, queue impact, failure isolation needs, and local-dev overhead| 9L.2 | $BE/Pricing$ | Add Apify pricing eligibility gate | Low-value or low-confidence lot candidates skip live Apify; only likely singles or manually selected listings spend Apify credits | GPT-5.5 mini | Medium | Protects monthly Apify budget; use listing metadata, Gemini draft confidence, estimated value threshold, duplicate-cache checks, and manual override |
| 10 | $DOCS$ | Repo docs need a macro review to reflect the new pricing service and its integration with the existing architecture | General doc cleanup should also be done in this pass |
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
| 10 | $BE/Archi$ | Evaluate benefit of extracting pricing into `services/pricing-service` | Decision based on live Apify latency, failure isolation needs, local dev overhead, and pricing module coupling |
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
