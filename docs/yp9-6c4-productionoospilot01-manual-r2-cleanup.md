# YP9.6c4 — ProductionOOSPilot01 manual image cleanup

**Status: MANUAL PILOT ACCEPTED by operator 2026-11-13.** This document was originally a read-only resource manifest. The operator subsequently reported deleting the Cloudflare R2 copy folder `89f22528-9872-440f-89b1-153afeac75fc/`, passing the two final buyer-facing/local cleanup checks, and observing A/C intact, B absent, ARM Capture/Withdraw enabled, and no UI errors. ChatGPT did **not** perform or independently verify the R2/local deletions; no eBay/DB mutation or hosted migration was performed by ChatGPT. Existing test listings need no legacy cleanup compatibility; protect the surviving live variations.

## Source identity (live Supabase SELECT)

- eBay listing ID: `800881949284` (EBAY_US)
- Group ID: `38f45c57-608e-40ad-bac3-95eeb8d74cb6`
- Removal revision ID: `def17667-aec3-4fe5-92c9-a9e78a39c994`
- Desired/confirmed revision: `8 / 8`; frozen snapshot version `3`
- Retired variation ID: `66d05ef9-c273-40c1-b9f1-bf062ccd22fe`
- Retired SKU B: `BSKBL-ProductionOOSPilot01-000002`
- Retired copy ID: `89f22528-9872-440f-89b1-153afeac75fc`
- c2b retirement: `confirmed_complete`, observed state `proven_absent` (database-recorded evidence; **not** a fresh independent eBay API read)
- Read-only reference checks: **0** current Variation-copy key matches across all groups, **0** Standard listing URL/key matches in checked exact/encoded forms, **0** live retired variation/copy rows. The two surviving copies were separately read from live Supabase. These checks do not prove R2 object presence.

## Two exact R2 objects to locate in Cloudflare

Front:
```text
variation-listing/38f45c57-608e-40ad-bac3-95eeb8d74cb6/66d05ef9-c273-40c1-b9f1-bf062ccd22fe/89f22528-9872-440f-89b1-153afeac75fc/front-995fd4835094.jpg
```

Back:
```text
variation-listing/38f45c57-608e-40ad-bac3-95eeb8d74cb6/66d05ef9-c273-40c1-b9f1-bf062ccd22fe/89f22528-9872-440f-89b1-153afeac75fc/back-ed4852627a92.jpg
```

**R2 status (2026-11-13):** Operator reports manual deletion of the retired copy-ID folder containing the two target keys. ChatGPT has not independently HEAD/GET verified object absence. Never remove the group or bucket prefix.

## Expected local processed archives — inspect, do not assume present

Code path: `services/watcher-service/src/variation-image-archive.ts` builds `<processedRoot>/<category>-<bucketToken>--<groupId>/<copyId>_<role>-<hash>.jpg`.

Based on the historic incoming paths and default watcher directory configuration, **if no `WATCHER_PROCESSED_DIR` override is configured**, the expected folder is:

```text
/Users/timothymurphy/Developer/Personal/ebay-inventory-manager/backend-services/services/watcher-service/watcher/processed/BSKBL-ProductionOOSPilot01--38f45c57-608e-40ad-bac3-95eeb8d74cb6/
```

Expected exact names in that folder:
```text
89f22528-9872-440f-89b1-153afeac75fc_front-995fd4835094.jpg
89f22528-9872-440f-89b1-153afeac75fc_back-ed4852627a92.jpg
```

Frozen original source references point into `watcher/incoming/` with names `IMG_20260910_133519_DRO copy.jpg` and `IMG_20260910_133530_DRO copy.jpg`; these are **historical**, not currently verified paths. Check your actual `WATCHER_PROCESSED_DIR` setting before using the predicted folder.

## Survivor safeguard — do not touch

| Survivor | Copy ID | Verified live key identity |
| --- | --- | --- |
| `BSKBL-ProductionOOSPilot01-000001` | `5d4468b0-8481-43c1-831e-a7a2f4adf079` | `variation-listing/.../1313b8df-bc01-4845-8033-c09575a03abb/.../front-49898c8d0be9.jpg`; `back-f0ce10fff8f1.jpg` |
| `BSKBL-ProductionOOSPilot01-000003` | `1ad9864b-3f85-423f-b224-1e6d07f1b82e` | `variation-listing/.../53b1c339-9280-498f-8e73-7ea654fc6f35/.../front-51323192dfa0.jpg`; `back-a40815864544.jpg` |

## Manual operator sequence — separate confirmation

1. Do not capture or upload new images for this group during the cleanup. Confirm that the live buyer listing still presents only A/C and that their images load.
2. In your Cloudflare R2 dashboard, navigate to the correct bucket and locate **each full exact object key** above. Confirm the displayed image corresponds to retired B; stop if a key is missing, is unexpectedly different, or its bucket is uncertain.
3. When ready, **you** may delete only those two individually selected R2 objects in the dashboard. No automated delete, prefix/folder selection, or dashboard action is performed by ChatGPT.
4. Verify each target key is absent and verify A/C's existing images still load. Log actual before/after results. If the objects are already absent, record that instead of trying to delete them.
5. Check whether the two expected processed archive files are present and match retired B before any **separate** manual local cleanup. Do not delete the group archive directory, the two surviving cards, or historical records.

**Deferred research:** EXEC1 and EXEC4a SQL migrations remain unapplied; EXEC4b–d prototypes are test-only. Exhaustive historical JSON analysis, persistent freeze registration and an automatic resource executor are not prerequisites for this manual, exact-object pilot. Future automatic cleanup of new listings can use unique immutable object keys and a small ownership check without legacy-format support.
