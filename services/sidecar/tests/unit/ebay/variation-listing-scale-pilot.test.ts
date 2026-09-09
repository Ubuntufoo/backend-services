import { describe, expect, it } from 'vitest';

import {
  buildVariationListingScaleEvidenceTemplate,
  buildVariationListingScaleFixture,
  compareVariationListingScaleEvidence,
  evaluateVariationListingScaleEvidence,
  expectedDuplicateOnlyActiveRevisionOperations,
  expectedInitialMediaBackedPublicationOperations,
  parseVariationListingScaleEvidence,
} from '@/ebay/variation-listing-scale-pilot.js';
import {
  parseVariationListingScalePilotArgs,
  runVariationListingScalePilotCli,
} from '@/scripts/variation-listing-scale-pilot.js';

function completeEvidence(count = 10) {
  const evidence = buildVariationListingScaleEvidenceTemplate(count);
  return {
    ...evidence,
    timings: {
      captureToPublishReadyMs: 10_000,
      initialPublishMs: 20_000,
      initialVerificationMs: 5_000,
      stagedPublishMs: 8_000,
      stagedVerificationMs: 4_000,
    },
    selectorAndImages: {
      ...evidence.selectorAndImages,
      observedSelectorCount: count,
      exactMembership: true,
      applicationOrderMatches: true,
      allSelectorsUnique: true,
      allRepresentativeFrontBackPairsCorrect: true,
    },
    revisionAndRecovery: {
      initialDesiredRevision: 11,
      initialConfirmedRevision: 11,
      stagedDesiredRevision: 14,
      stagedConfirmedRevision: 14,
      unresolvedOutcome: false,
      boundedRetryCount: 0,
      operatorRecoveryInterventions: 0,
    },
    replenishment: {
      ...evidence.replenishment,
      expectedQuantitiesMatch: true,
      untouchedSiblingQuantitiesStable: true,
    },
    operator: {
      totalElapsedMinutes: 18,
      manualStepCount: 24,
      blockingUxIssue: false,
      notes: 'Scale pilot completed without intervention.',
    },
  };
}

describe('variation listing scale pilot', () => {
  it('defines the 10-variation starting fixture and bounded replenishment sample', () => {
    const fixture = buildVariationListingScaleFixture();
    expect(fixture.variationCount).toBe(10);
    expect(fixture.variations).toHaveLength(10);
    expect(fixture.variations.map((variation) => variation.slot)).toEqual([
      'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10',
    ]);
    expect(fixture.variations.map((variation) => variation.manualPriceAmount)).toEqual([
      0.99, 1.49, 1.99, 2.49, 0.99, 1.49, 1.99, 2.49, 0.99, 1.49,
    ]);
    expect(fixture.replenishmentSlots).toEqual(['V02', 'V05', 'V09']);
  });

  it('records operation-count expectations from current application revision plans', () => {
    expect(expectedInitialMediaBackedPublicationOperations(10)).toBe(43);
    expect(expectedDuplicateOnlyActiveRevisionOperations(10)).toBe(22);
    expect(buildVariationListingScaleFixture(20).expectedOperationCounts).toEqual({
      initialMediaBackedPublication: 83,
      duplicateOnlyActiveRevision: 42,
    });
  });

  it('creates an incomplete evidence template without inventing live measurements', () => {
    const template = buildVariationListingScaleEvidenceTemplate();
    expect(template.environment).toBe('sandbox');
    expect(template.selectorAndImages.expectedSelectorCount).toBe(10);
    expect(template.timings.initialPublishMs).toBeNull();
    expect(template.revisionAndRecovery.initialConfirmedRevision).toBeNull();
    expect(evaluateVariationListingScaleEvidence(template).status).toBe('incomplete');
  });

  it('promotes only after correctness, revision, replenishment, recovery, and operator gates pass', () => {
    const result = evaluateVariationListingScaleEvidence(parseVariationListingScaleEvidence(completeEvidence()));
    expect(result.status).toBe('promote');
    expect(result.nextCandidateVariationCount).toBe(20);
  });

  it('holds when a staged revision is not completely confirmed', () => {
    const evidence = completeEvidence();
    evidence.revisionAndRecovery.stagedConfirmedRevision = 13;
    const result = evaluateVariationListingScaleEvidence(parseVariationListingScaleEvidence(evidence));
    expect(result.status).toBe('hold');
    expect(result.reasons.join(' ')).toMatch(/staged publication/i);
  });

  it('holds for unknown outcomes, replenishment drift, blocking UX, or blocking defects', () => {
    const evidence = completeEvidence();
    evidence.revisionAndRecovery.unresolvedOutcome = true;
    evidence.replenishment.untouchedSiblingQuantitiesStable = false;
    evidence.operator.blockingUxIssue = true;
    evidence.defects = [{ severity: 'blocking', summary: 'Selector control failed.' }];
    const result = evaluateVariationListingScaleEvidence(parseVariationListingScaleEvidence(evidence));
    expect(result.status).toBe('hold');
    expect(result.nextCandidateVariationCount).toBeNull();
    expect(result.reasons).toHaveLength(4);
  });

  it('rejects evidence whose replenishment slots are outside the fixture', () => {
    const evidence = completeEvidence();
    evidence.replenishment.slots = ['V11'];
    expect(() => parseVariationListingScaleEvidence(evidence)).toThrow(/outside the fixture/i);
  });

  it('requires canonical fixture slots and positive published revision watermarks', () => {
    const nonCanonicalSlot = completeEvidence();
    nonCanonicalSlot.replenishment.slots = ['V002'];
    expect(() => parseVariationListingScaleEvidence(nonCanonicalSlot)).toThrow(/fixture slot format/i);

    const unpublishedRevision = completeEvidence();
    unpublishedRevision.revisionAndRecovery.initialDesiredRevision = 0;
    unpublishedRevision.revisionAndRecovery.initialConfirmedRevision = 0;
    expect(() => parseVariationListingScaleEvidence(unpublishedRevision)).toThrow(/greater than 0/i);
  });

  it('requires the fixture replenishment sample', () => {
    const evidence = completeEvidence();
    evidence.replenishment.slots = ['V01', 'V05', 'V09'];
    expect(() => parseVariationListingScaleEvidence(evidence)).toThrow(/must match the fixture sample/i);
  });

  it('rejects unsafe variation counts', () => {
    const evidence = completeEvidence();
    evidence.variationCount = Number.MAX_SAFE_INTEGER + 1;
    evidence.selectorAndImages.expectedSelectorCount = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseVariationListingScaleEvidence(evidence)).toThrow(/safe integer/i);
  });

  it('compares timings without turning timing ratios into pass/fail thresholds', () => {
    const previous = parseVariationListingScaleEvidence(completeEvidence(10));
    const currentRaw = completeEvidence(20);
    currentRaw.timings.initialPublishMs = 30_000;
    currentRaw.operator.totalElapsedMinutes = 27;
    const current = parseVariationListingScaleEvidence(currentRaw);
    const comparison = compareVariationListingScaleEvidence(previous, current);
    expect(comparison.timingRatios.initialPublishMs).toBe(1.5);
    expect(comparison.operatorElapsedRatio).toBe(1.5);
  });

  it('parses the offline CLI commands without exposing an execute/mutate mode', () => {
    expect(parseVariationListingScalePilotArgs(['template'])).toEqual({ command: 'template', variationCount: 10 });
    expect(parseVariationListingScalePilotArgs(['template', '20'])).toEqual({ command: 'template', variationCount: 20 });
    expect(parseVariationListingScalePilotArgs(['evaluate', 'run.json'])).toEqual({ command: 'evaluate', evidencePath: 'run.json' });
    expect(parseVariationListingScalePilotArgs(['compare', '10.json', '20.json'])).toEqual({
      command: 'compare',
      previousPath: '10.json',
      currentPath: '20.json',
    });
    expect(() => parseVariationListingScalePilotArgs(['execute'])).toThrow(/template/i);
  });

  it('prints a 10-variation offline template with no API factory or mutation seam', async () => {
    const output: string[] = [];
    await runVariationListingScalePilotCli(['template'], (value) => output.push(value));
    expect(output).toHaveLength(1);
    const parsed = JSON.parse(output[0]!) as { fixture: { variationCount: number }; evidence: { variationCount: number } };
    expect(parsed.fixture.variationCount).toBe(10);
    expect(parsed.evidence.variationCount).toBe(10);
  });
});
