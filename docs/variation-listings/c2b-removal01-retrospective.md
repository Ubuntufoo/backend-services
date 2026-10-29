# C2BRemoval01 retrospective

The abandoned Sandbox state was observed read-only and remains untouched. eBay returned Group `variantSKUs` in B,C,A order while its `Card` values were an independent A,B,C collection; selector ownership therefore comes from each immutable Item `product.aspects.Card`, never array position. Trading omitted the zero-stock A variation, so that view is not quantity or membership authority. The original 400/25082 root cause remains unresolved.

Do not retry an ambiguous mutation. The original Sandbox listing and hosted records were abandoned in place; no recovery, deletion, finalization, migration apply, or image cleanup is authorized by this note. Parent safety remains exact survivor PUBLISHED/active Offers on the original listing ID with no parent deletion.

Applied canonical sources remain byte-identical:

- Gate A `20261026140000` — hosted `20261027145825` — SHA-256 `0f4583e3292da919bd62e43c2c49a9528fb45a40e4cc7286da1388bf5ae8d9df`
- RPC alias `20261027201000` — hosted `20261028014018` — SHA-256 `7adf18fdc56346d119ac2f5a7bb8b0502f2ba0aeab70acd1da587c221035e8b8`

Later incident-delete and incident-offer-delete migrations were unapplied and have been removed with their incident-only runtime, scripts, validators, tests, and runbooks.
