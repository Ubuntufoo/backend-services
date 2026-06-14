# Codex Task
Run ID: 2026-06-14T023807Z-canonicalize-trading-card-metadata-for-pricing
## Objective
Improve Gemini trading-card item-specific generation and backend normalization so pricing-critical fields, especially Card Number, are consistently captured in canonical aspects.
## Context Summary
A live Apify pricing test for `Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach` showed Gemini included `#98` in the generated title but omitted `aspects["Card Number"]`. Current Gemini prompt asks for card number in the title but the expected aspects schema only lists Player, Franchise, Sport, Card Manufacturer, and Season. Pricing code expects canonical keys like Player, Year, Manufacturer, Set, Card Number, and Parallel/Variety. Fix this by making Gemini emit canonical pricing-friendly fields and by adding backend fallback normalization so pricing does not depend only on prompt compliance.
## Inspect First

- services/sidecar/src/gemini/prompt.ts
- services/sidecar/src/gemini/contracts.ts
- services/sidecar/src/gemini/parse-generated-draft.ts
- services/sidecar/src/gemini/generate-listing-draft.ts
- services/sidecar/src/gemini/trading-card-id-resolver.ts
- services/sidecar/src/jobs/run-job.ts
- tests/unit/gemini/**/*.test.ts
- tests/unit/jobs/run-job.test.ts

## Allowed Paths

- services/sidecar/src/gemini/**/*.ts
- services/sidecar/src/jobs/**/*.ts
- tests/unit/gemini/**/*.test.ts
- tests/unit/jobs/**/*.test.ts

## Forbidden Paths

- services/sidecar/src/pricing/**/*.ts
- supabase/**
- services/sidecar/src/ebay/**
- services/sidecar/src/http/**

## Implementation Scope

Include:
- Update Gemini prompt/schema description to require canonical trading-card aspects when visible or strongly inferable: Player, Year, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set. Keep existing eBay-friendly aliases where useful, such as Season and Card Manufacturer, but do not allow canonical keys to be omitted when the equivalent alias is known.
- Add a deterministic backend normalization step after Gemini draft parsing and before listing item_specifics are persisted. It should canonicalize aliases: Season -> Year, Card Manufacturer -> Manufacturer, Player/Athlete -> Player if Player missing, and optionally Team/Franchise aliasing only where existing behavior expects it.
- Add card-number fallback extraction from generated title when aspects["Card Number"] is missing. Extract only from explicit markers such as `#98`, `Card #98`, `Card No. 98`, or `Card Number 98`. Store without leading `#`.
- Normalize existing Card Number values by stripping leading `#` and whitespace. Preserve alphanumeric card numbers such as US250, C-3, 98B when safe.
- When title-derived card number and aspect card number conflict, preserve the existing aspect value, add a warning, and do not silently overwrite.
- Add focused unit tests for the Johnny Riddle example and alias normalization.

Exclude:
- Do not change Apify pricing query construction in this task.
- Do not change pricing calculations, comp-count limits, Apify cost controls, workflow states, eBay publishing, or UI behavior.
- Do not add broad trading-card taxonomy work beyond pricing-critical metadata capture.

## Acceptance Criteria

- Gemini prompt explicitly tells the model to emit aspects["Card Number"] whenever the title contains or uses a card number.
- Gemini prompt includes canonical pricing-friendly aspect keys, not only Season/Card Manufacturer aliases.
- A parsed/generated draft with title `Johnny Riddle 1955 Topps #98 St. Louis Cardinals Coach` and missing Card Number is normalized to include `aspects["Card Number"] === "98"`.
- A draft with `Season: "1955"` and `Card Manufacturer: "Topps"` is normalized to include `Year: "1955"` and `Manufacturer: "Topps"` without breaking existing aliases.
- A draft with `Card Number: "#98"` is normalized to `Card Number: "98"`.
- Conflict behavior is deterministic and covered by tests.

## Verification Commands

- pnpm --filter sidecar exec vitest run tests/unit/gemini
- pnpm --filter sidecar exec vitest run tests/unit/jobs/run-job.test.ts -t generate_ai
- pnpm typecheck

## Completion Contract
Before your final chat response, write this file:
`.chatgpt/codex-runs/2026-06-14T023807Z-canonicalize-trading-card-metadata-for-pricing/RESULT.md`
Use this exact structure:
```md
# CODEX_RESULT
status: completed | blocked
summary: <one-line summary>
changed_files:
commands_run:
tests:
acceptance_criteria:
blockers:
followups:
```
Then print the same result in the Codex chat.
Do not stage, commit, push, or edit unrelated files.
Do not edit `.chatgpt/**` except this run's `RESULT.md`.