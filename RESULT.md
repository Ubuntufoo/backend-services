## Changed files

- `services/sidecar/src/pricing/sold-comps-query.ts`
- `services/sidecar/tests/unit/pricing/sold-comps-query.test.ts`
- `services/sidecar/tests/unit/pricing/soldcomps-provider.test.ts`
- `services/sidecar/tests/unit/pricing/apify-provider.test.ts`
- `services/sidecar/tests/unit/jobs/research-price-job.test.ts`

## Query behavior

- Before: base query builder could retain noisy structured/title-derived terms such as `Football`, `Coach`, `3rd Base`, and league suffixes like `NBA`; positive query layer also appended non-allowlisted parallel/title fragments.
- After: base query builder uses allowlisted structured identity only: player, year/season, normalized manufacturer/set line, card number, explicit graded/autograph characteristics.
- Title usage narrowed to fallback extraction for missing year/card number/set line only; no leftover title words appended onto structured queries.
- Product-line normalization now strips noisy suffixes:
  - `Topps Football` -> `Topps`
  - `Hoops NBA` -> `Hoops`
  - real multi-token sets such as `Fleer Ultra` preserved
- Defensive noisy-term filter blocks sport/role/position leakage from query construction.
- Shared provider-neutral output preserved across both providers via `buildPricingSearchQuery(...)`; negative raw-card modifiers still append after cleaned base query.

## Acceptance examples

- `John Hadl` + `1966` + `Topps Football` + `#125` + `Sport=Football`
  - base query: `John Hadl 1966 Topps #125`
- `Johnny Riddle` + `Coach`
  - base query: `Johnny Riddle 1955 Topps #98`
- `Darryl Strawberry` + `3rd Base`
  - base query: `Darryl Strawberry 1997 Fleer #179`
- `Michael Jordan` + `Hoops NBA`
  - base query: `Michael Jordan 1991 Hoops #536`

## Validation

- `pnpm --filter sidecar exec vitest run tests/unit/pricing/sold-comps-query.test.ts tests/unit/pricing/soldcomps-provider.test.ts tests/unit/pricing/apify-provider.test.ts tests/unit/jobs/research-price-job.test.ts`
  - pass
- `pnpm --filter sidecar exec vitest run tests/unit/pricing`
  - pass
- `pnpm test`
  - pass
- `pnpm typecheck`
  - pass
- Requested `pnpm --filter sidecar exec vitest run tests/unit/pricing --runInBand`
  - unsupported by repo Vitest `4.1.6` (`Unknown option --runInBand`); equivalent focused pricing run above passed
