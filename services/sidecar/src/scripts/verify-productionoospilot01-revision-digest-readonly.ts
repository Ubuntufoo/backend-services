#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { loadRootEnvironment } from '@/config/env-paths.js';
import { getSidecarDataAccess } from '@/data/sidecar-data.js';

const GROUP_ID = '38f45c57-608e-40ad-bac3-95eeb8d74cb6';
const TARGET_SKU = 'BSKBL-ProductionOOSPilot01-000002';
const EXPECTED_CONFIRMED_REVISION = 7;

function digest(value: unknown, compare: (a: string, b: string) => number): string {
  const serialize = (part: unknown): string => {
    if (Array.isArray(part)) return `[${part.map(serialize).join(',')}]`;
    if (part !== null && typeof part === 'object') {
      return `{${Object.entries(part as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
        .join(',')}}`;
    }
    return JSON.stringify(part) ?? 'null';
  };
  return createHash('sha256').update(serialize(value)).digest('hex');
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('No arguments allowed.');
  loadRootEnvironment();
  if (process.env.EBAY_ENVIRONMENT !== 'production' ||
      process.env.EBAY_PUBLISH_ENABLED !== 'false' ||
      process.env.SIDECAR_JOB_RUNNER_ENABLED === 'true') {
    throw new Error('Production read-only environment required: publishing and job runner disabled.');
  }
  if (process.env.SUPABASE_PROJECT_REF !== 'fmiliwxthjonjwywuqta') {
    throw new Error('Unexpected Supabase project; no database read attempted.');
  }

  const db = getSidecarDataAccess().variationListings;
  const aggregate = await db.loadAggregate(GROUP_ID);
  if (!aggregate || aggregate.group.group_id !== GROUP_ID ||
      aggregate.group.last_confirmed_revision !== EXPECTED_CONFIRMED_REVISION) {
    throw new Error('Group or confirmed revision differs from frozen production pilot.');
  }
  const target = aggregate.variations.find((v) => v.sku === TARGET_SKU);
  if (aggregate.variations.length !== 3 || !target?.pending_removal_at ||
      aggregate.variations.some((v) => v.sku !== TARGET_SKU && v.pending_removal_at)) {
    throw new Error('Staged removal target or survivor set has changed.');
  }

  const revisions = await db.listRevisionsByGroupId(GROUP_ID);
  const matching = revisions.filter((r) =>
    r.source.group_id === GROUP_ID &&
    r.source.captured_desired_revision === EXPECTED_CONFIRMED_REVISION
  );
  if (matching.length !== 1) throw new Error('Expected exactly one confirmed revision.');
  const revision = matching[0]!.source;
  if (revision.snapshot_version !== 3 || !/^[0-9a-f]{64}$/.test(revision.snapshot_digest)) {
    throw new Error('Confirmed revision version or digest is invalid.');
  }
  const legacy = digest(revision.snapshot, (a, b) => a.localeCompare(b));
  const byteOrdered = digest(revision.snapshot, (a, b) =>
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  );
  const operationKinds = Array.isArray(revision.operation_plan)
    ? revision.operation_plan.map((op) =>
      op && typeof op === 'object' && !Array.isArray(op) ? (op as Record<string, unknown>).operation_kind : null
    )
    : [];
  const removalRevision = 'permanentRemoval' in (revision.snapshot as Record<string, unknown>) ||
    operationKinds.includes('permanent_removal_group_membership');
  const legacyMatches = legacy === revision.snapshot_digest;
  const byteOrderedMatches = byteOrdered === revision.snapshot_digest;
  const verified = byteOrderedMatches || (!removalRevision && legacyMatches);

  console.log(JSON.stringify({
    groupId: GROUP_ID,
    desiredRevision: aggregate.group.desired_revision,
    lastConfirmedRevision: aggregate.group.last_confirmed_revision,
    confirmedRevisionId: revision.revision_id,
    snapshotVersion: revision.snapshot_version,
    priorRevisionIsPermanentRemoval: removalRevision,
    byteOrderedMatches,
    legacyLocaleMatches: legacyMatches,
    digestVerifiedForRemovalPreflight: verified,
    stagedTargetSku: TARGET_SKU,
    stagedTargetConfirmed: true,
    remoteWritesPerformed: false,
  }, null, 2));
  if (!verified) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error('READ_ONLY_DIGEST_CHECK_BLOCKED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
