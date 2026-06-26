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

## Gemini Draft Generation

### What Is Measured

- `generateAiLatency` in `runGenerateAiJob()` structured logs: `totalMs`, `prepareDraftMs`, `modelMs`, `parseMs`, `listingUpdateMs`, `enqueueResearchPriceMs`
- `generateAiPayload` in the same logs: `promptBytes`, `imageCount`, `preparedImagePartCount`, `inlineImageBytesApprox`
- `ai_model_attempts.metadata` for each Gemini provider attempt when audit rows exist:
  - `metadata.latency.modelMs`
  - `metadata.latency.parseMs`
  - `metadata.payload.promptBytes`
  - `metadata.payload.imageCount`
  - `metadata.payload.preparedImagePartCount`
  - `metadata.payload.inlineImageBytesApprox`

### Where To Look

- Structured logs:
  - `generate_ai_prepare_completed`
  - `generate_ai_model_attempt_completed`
  - `generate_ai_succeeded`
- Model-attempt persistence: `public.ai_model_attempts.metadata`
- No API surface changes; diagnostics stay in logs and existing attempt metadata only

### Expected Bottlenecks

Estimates only until measured with live runs.

1. Gemini model call
   Estimated savings: likely highest; external network + provider inference latency.
2. Image fetch + inline base64 preparation
   Estimated savings: likely medium/high when multiple large HTTP images are present.
3. Prompt payload size
   Estimated savings: likely low/medium unless prompt growth materially increases provider latency.
4. Parse + listing update + `research_price` enqueue
   Estimated savings: likely low in normal runs.

### Follow-up Candidates

- Approved 9M.2 route-order optimization: live `generate_ai` audit showed `listing_draft_generation` attempting `gemini-3.5-flash` before `gemini-3-flash-preview`, with repeated Google `503 UNAVAILABLE` / high-demand failures on `3.5` and successful fallback on preview; reorder default route priority to `gemini-3-flash-preview`, then `gemini-3.5-flash`, while preserving fallback behavior.
- Reduce inline image payload size only if live `inlineImageBytesApprox` and `prepareDraftMs` show material local overhead.
- Trim prompt bytes only if live runs show prompt size correlates with `modelMs`.
- Consider deferred or alternative payload strategies only after confirming model latency is not already dominant.
- Treat all savings estimates as provisional until measured from real `generate_ai` executions.
