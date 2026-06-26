# Pricing Pipeline Latency Audit

## What Is Measured

- `listing_price_research.raw_result_json.diagnostics.latency`
- Stages: `createResearchMs`, `providerFetchMs`, `fallbackFetchMs`, `soldCompsUsagePersistMs`, `normalizationMs`, `statsMs`, `llmReasoningMs`, `totalMs`
- Supporting diagnostics in the same `raw_result_json.diagnostics`: raw/accepted/rejected comp counts, selected vs actual provider, fallback flags, `llmAttempted`

## Where To Look

- Primary row: `public.listing_price_research`
- Pipeline timing: `raw_result_json.diagnostics.latency`
- Provider/count context: `raw_result_json.diagnostics`
- Final `markSucceeded` / `listings.update` timings are intentionally not persisted in this narrow audit because capturing them in `raw_result_json.diagnostics.latency` after those operations would require a second database write

## Expected Bottlenecks

Estimates only until measured with live runs.

1. Provider fetch + fallback
   Estimated savings: `200ms-3000ms+` per run, depending on upstream latency and fallback frequency.
2. LLM price reasoning
   Estimated savings: `150ms-1500ms+` per LLM-attempted run, depending on model route, response size, and retries.
3. Persistence writes
   Estimated savings: `20ms-250ms` per run, mostly network/database round trips.
4. Normalization + stats/confidence
   Estimated savings: `0ms-50ms` per run in typical comp-set sizes; likely low leverage unless comp volume grows sharply.

## Follow-up Candidates

- Reduce provider fallback frequency first: tighten provider health gating, config defaults, or manual mode selection using measured fallback rates.
- Trim LLM prompt payload second: reduce comp count or prompt bytes only if live timing shows `llmReasoningMs` is material.
- Revisit persistence round trips third: measure them separately during targeted profiling if provider and LLM latency are already understood.
- Ignore micro-optimizing normalization/stats unless live rows show unexpected spikes.
