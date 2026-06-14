# CODEX_RESULT
status: completed
summary: Canonicalized Gemini trading-card metadata for pricing via prompt updates, deterministic draft normalization, persistence-boundary normalization, and focused tests.
changed_files:
- services/sidecar/src/gemini/prompt.ts
- services/sidecar/src/gemini/parse-generated-draft.ts
- services/sidecar/src/jobs/run-job.ts
- services/sidecar/tests/unit/gemini/generate-listing-draft.test.ts
- services/sidecar/tests/unit/gemini/parse-generated-draft.test.ts
- services/sidecar/tests/unit/jobs/run-job.test.ts
- .chatgpt/codex-runs/2026-06-14T023807Z-canonicalize-trading-card-metadata-for-pricing/RESULT.md
commands_run:
- pnpm --filter sidecar exec vitest run tests/unit/gemini
- pnpm --filter sidecar exec vitest run tests/unit/jobs/run-job.test.ts -t generate_ai
- pnpm typecheck
tests:
- passed: `pnpm --filter sidecar exec vitest run tests/unit/gemini`
- passed: `pnpm --filter sidecar exec vitest run tests/unit/jobs/run-job.test.ts -t generate_ai`
- passed: `pnpm typecheck`
acceptance_criteria:
- met: prompt now requires canonical pricing aspects including Card Number when title contains card-number markers
- met: prompt schema now includes canonical keys Year, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set
- met: Johnny Riddle title fallback normalizes missing `aspects["Card Number"]` to `98`
- met: `Season` and `Card Manufacturer` normalize to `Year` and `Manufacturer` while preserving aliases
- met: `Card Number: "#98"` normalizes to `Card Number: "98"`
- met: conflicting title/aspect card numbers keep aspect value and emit deterministic warning
blockers:
- none
followups:
- none
