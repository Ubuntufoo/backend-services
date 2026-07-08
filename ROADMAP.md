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
RTK.1A | Tooling/RTK | Prototype wrapper-level `rtk view` dispatcher | Add `rtk view <tree|diff|source|json|log|csv>` to `~/.codex/rtk/rtk-wrapper.sh`, delegating existing views to `rtk-real`, adding deterministic help/errors, and implementing only bounded CSV/source handling where no existing RTK command exists.
| RTK.1B | Tooling/RTK | Harden RTK view basics | Add consistent footer metadata and raw recovery hints to every `rtk view` command, centralize simple unsafe-path refusals for secrets/dependencies/generated files, and add a short global Codex instruction to use `rtk view` before reading bulky artifacts |
| 9O.1 | BE/Pricing | Add pricing fallback query for zero provider results | When SoldComps returns zero provider results for a canonical query with modifiers, retry once with a controlled relaxed query variant before marking deterministic price invalid; preserve accepted/rejected comp semantics and record both strict and fallback query diagnostics |
| 9O.2 | BE/FE Review Workflow | Allow regenerate and reprice after deterministic pricing failure | From review UI, allow rerunning AI generation and/or pricing after seller hints, item specifics JSON, or pricing modifier checkboxes change; support `research_price_suggested_price_invalid` as a retryable workflow state rather than forcing manual price only |
| 9O.3A | BE/API | Expose pricing failure reason summary on listings API
| 9O.3B | FE/Pricing UI | Surface provider-zero vs rejected-comps failure reason | Distinguish “provider returned zero results” from “provider returned comps but backend rejected them”; show query, provider item count, sample titles when present, and retry actions appropriate to the failure mode |
| 9N.4 | BE/Pricing | Pricing subsystem cleanup pass | Review providers, query builders, normalization, research jobs, persistence, LLM reasoning, and pricing diagnostics; eliminate redundant payloads, unnecessary transforms, excess telemetry, style drift, and weak typing |
| 9N.5 | BE/Integrations & Data | eBay, Gemini, persistence, and data-layer cleanup pass | Review external integrations, repositories, database access, storage contracts, scripts, and shared types; simplify code paths, remove duplication, tighten typing, and standardize patterns |
| 9N.6 | BE/Quality | Test suite, fixtures, tooling, and documentation cleanup pass | Remove redundant tests, stale fixtures, obsolete scripts, outdated documentation, and development artifacts; align remaining assets with current architecture |
| 9N.7 | FE/Architecture | Frontend architecture cleanup pass | Review component organization, hooks, API clients, state management, utilities, and shared types; remove duplication, simplify data flow, and standardize patterns |
| 9N.8 | FE/UI | Dashboard, review workflow, and UI cleanup pass | Review listing workflow screens, pricing UI, operational summary, settings, and shared components; remove UI-specific slop, dead code, unnecessary state, inconsistent implementations, and component-local complexity; specifically consider local helper extraction in `app/queue-errors-panel.tsx` and `app/listings-realtime.tsx` if it can remain behavior-preserving |
| 9N.9 | FE/Quality | Frontend typing, tests, and documentation cleanup pass | Fix the existing `react-hooks/set-state-in-effect` lint violation in `app/listing-generate-controls.tsx`, then tighten TypeScript usage, remove unnecessary casts, clean test coverage, remove stale code paths, and align documentation with current frontend architecture |
| 9N.10A | BE | Final backend consistency audit | Review backend-services naming consistency, coding conventions, diagnostics, logging, typing, comments, and style after 9N.4-9N.6; resolve only small behavior-preserving backend inconsistencies and produce a backend cleanup report |
| 9N.10B | FE | Final frontend consistency audit | Review ebay-ui-app naming consistency, coding conventions, diagnostics, typing, comments, tests, and style after 9N.7-9N.9; resolve only small behavior-preserving frontend inconsistencies and produce a frontend cleanup report |
| 9N.11 | BE/Architecture | Audit sidecar data facade usage | Identify unused SidecarDataAccess methods and possible subdomain splits without changing behavior.
| 9N.12 | BE/Pricing | Audit pricing barrel imports | Classify pricing/index imports and replace only low-risk runtime imports with direct module imports.
| 9N.13 | Docs/Architecture | Consolidate backend architecture docs | Keep docs/architecture.md as source of truth while preserving concise routing summaries in README/AGENTS.
| 9N.14 | $DOCS$ | Repo docs need a macro review to reflect the new pricing service and its integration with the existing architecture | General doc cleanup should also be done in this pass |
| 9N.15A | FE/UI | NO LISTINGS in UI must not prevent dashboard from loading | Dashboard metrics should load even if no listings exist
| 9N.15B | FE/UI | Pricing research panel layout fix | Pricing research panel that appears just after AI generation must be moved to be right avove Inventory / SKU panel so it is adjacent to the PRICE input.
| 9N.15C | FE/UI | SoldComps usage counter shows 39/100 in UI, but SoldComps API shows "used": 86, proving an inaccurate usage count | Fix SoldComps usage counter to reflect actual API usage
| 9N.16 | BE/Pricing | Review failed pricing logs and fix | Last price job failed due to 'research_price_suggested_price_invalid' and the response JSON appears flawed.
| 9N.17A | FE | remove 130POINT from pricing research panel | 130POINT is no longer used and should be removed from the UI.
| 9N.17B | BE | remove 130POINT from pricing service | Pricing research panel is no longer used and should be removed from the BE pricing service.
COMPLETED TASKS COMMENTED OUT -->
--------------- READY FOR LIVE PILOT --------------
| 10 | BE/Archi | Re-evaluate dedicated pricing worker after live pilot | Decide whether to extract pricing into services/pricing-service based on live provider latency, queue impact, failure isolation needs, and local-dev overhead
| 10 | $BE/DB$ | Add manual listing status reconciliation tool | Exported listings can later be batch-marked listed/sold after Seller Hub-managed pilot
| 10 | DB | Store lean order rows | `order_id`, `listing_id`, `status`, `ship_by_date`, and `sale_price` are persisted
| 10 | BE | `ebay-service`: implement `getUnshippedOrders()` | Order checks work against eBay API
| 10 | BE | Match order SKU to `listing_id` | Sold listing is identified from order SKU
| 10 | DB/BE | Update listing status to `sold` | Sale is tracked and listing status moves to `sold` when matched order data confirms sale
| 10 | $BE$ | `job-runner`: schedule 4 order checks/day | Controlled order sync runs 4 times per day
| 10 | $FE$ | Show due today/overdue warnings | 1-day handling risks are visible
| 10 | $FE$ | Improve listing image preview gallery | All listing images are visible at usable review size
| 10 | $BE$ | Normalize image orientation during asset processing | R2 images display with correct orientation
| 10 | BE/DB | Add `ai_model_attempts` cleanup policy | Old AI attempt audit rows are pruned after listings are sold/closed and retention window passes
| 10 | $BE/Archi$ | Evaluate benefit of extracting pricing into `services/pricing-service` | Decision based on live Apify latency, failure isolation needs, local dev overhead, and pricing module coupling
| 11 | $BE/FE$ | Wire lot intake mode end-to-end | Lot listings can be intentionally created, reviewed, published, and shipped
| 11 | $BE$ | Add local processed-output retention policy | `.image-service-output/<runId>` cleanup behavior is defined and enforced
| 11 | DB | Add `r2_retention_policy`, `r2_delete_after`, `r2_deleted_at` | Safe cleanup fields exist
| 11 | BE | On `sold`, set `r2_delete_after` | `r2_delete_after` is set from `sold_at + configured retention days`
| 11 | $FE$ | Show cleanup status lightly | Cleanup status is visible without becoming a major UI surface
| 11 | $BE$ | `r2-service`: `deleteObjects()` | R2 cleanup primitive works
| 11 | BE | `job-runner`: cleanup eligible sold listings | Images are deleted after retention window
| 12 | $FE$ | Add Sync Now buttons | Manual watcher/order sync control
| 12 | FE | Add settings screen | Edit `app_settings` safely
| 12 | $BE$ | Add service health checks | UI can show service status
| 12 | $BE$ | Add structured logs | Debuggability improves
| 12 | BE | Add production job-runner configuration | Tune polling interval, batch size, stale-running recovery, and worker enablement for production-like operation
| 12 | $BE$ | Add tests for status transitions | Workflow protection
| 12 | $BE$ | Add tests for publish validation | Prevent bad eBay calls
| 12 | $Docs$ | Add OPERATIONS.md | How to run/use system
| 12 | BE | Add read-only eBay query services | Messages, orders, listings, and inventory can be queried without LLM dependency
| 12 | BE | Add assistant tool registry | Allowed read-only tools are centrally defined
| 12 | BE | Add assistant intent router | Common user queries map to approved read-only tools
| 12 | BE | Add assistant response schemas | UI receives typed assistant results
| 12 | BE | Add read-only guardrails | Assistant cannot mutate eBay account state
| 12 | BE | Add assistant audit logs | Assistant tool calls are traceable
| 12 | BE | Add Gemini assistant bridge | Gemini can route/summarize approved read-only queries
| 13 | FE | Add Read-only eBay Assistant panel | User can query seller account data from UI
| 13 | $FE$ | Add assistant quick actions | Common queries work without model reasoning
| 13 | FE | Render assistant result cards | Messages, orders, listings, and inventory display cleanly
| 13 | $FE$ | Show assistant read-only mode | User understands assistant cannot publish, revise, reply, refund, or cancel
| 13 | $BE$ | Add tests for assistant routing and guardrails | Unsafe or unsupported assistant actions are blocked
| 13 | BE | BE audit: clean up and review for refactoring | Eliminate checklist scripts, stale tests, other development artifacts
| 13 | $Docs$ | Document Read-only eBay Assistant contract | Future assistant architecture is clear
| 13 | $Cleanup$ | Pare down tests | Remove unnecessary or redundant test cases for high-confidence/hardened test scenarios
| 14 | $Marketing/SEO$ | Explore marketing options | Google search, social media, and other channels for potential traffic and user acquisition
