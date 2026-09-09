import { z } from 'zod';

export const VARIATION_LISTING_SCALE_PILOT_EVIDENCE_VERSION = 1 as const;
export const VARIATION_LISTING_SCALE_PILOT_START_COUNT = 10 as const;
export const VARIATION_LISTING_SCALE_PRICE_TIERS = [0.99, 1.49, 1.99, 2.49] as const;

const nullableNonNegativeNumber = z.number().finite().nonnegative().nullable();
const nullableNonNegativeInteger = z.number().int().nonnegative().nullable();
const nullablePositiveSafeInteger = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, 'Value must be a safe integer.')
  .nullable();
const nullableBoolean = z.boolean().nullable();
const scaleSlotSchema = z.string().regex(/^V\d{2,}$/);

export const variationListingScalePilotEvidenceSchema = z
  .object({
    version: z.literal(VARIATION_LISTING_SCALE_PILOT_EVIDENCE_VERSION),
    environment: z.literal('sandbox'),
    variationCount: z
      .number()
      .int()
      .min(VARIATION_LISTING_SCALE_PILOT_START_COUNT)
      .refine(Number.isSafeInteger, 'Variation count must be a safe integer.'),
    timings: z
      .object({
        captureToPublishReadyMs: nullableNonNegativeNumber,
        initialPublishMs: nullableNonNegativeNumber,
        initialVerificationMs: nullableNonNegativeNumber,
        stagedPublishMs: nullableNonNegativeNumber,
        stagedVerificationMs: nullableNonNegativeNumber,
      })
      .strict(),
    selectorAndImages: z
      .object({
        expectedSelectorCount: z.number().int().positive(),
        observedSelectorCount: nullableNonNegativeInteger,
        exactMembership: nullableBoolean,
        applicationOrderMatches: nullableBoolean,
        allSelectorsUnique: nullableBoolean,
        allRepresentativeFrontBackPairsCorrect: nullableBoolean,
      })
      .strict(),
    revisionAndRecovery: z
      .object({
        initialDesiredRevision: nullablePositiveSafeInteger,
        initialConfirmedRevision: nullablePositiveSafeInteger,
        stagedDesiredRevision: nullablePositiveSafeInteger,
        stagedConfirmedRevision: nullablePositiveSafeInteger,
        unresolvedOutcome: nullableBoolean,
        boundedRetryCount: nullableNonNegativeInteger,
        operatorRecoveryInterventions: nullableNonNegativeInteger,
      })
      .strict(),
    replenishment: z
      .object({
        slots: z.array(scaleSlotSchema).min(1).refine((slots) => new Set(slots).size === slots.length, 'Replenishment slots must be unique.'),
        expectedQuantitiesMatch: nullableBoolean,
        untouchedSiblingQuantitiesStable: nullableBoolean,
      })
      .strict(),
    operator: z
      .object({
        totalElapsedMinutes: nullableNonNegativeNumber,
        manualStepCount: nullableNonNegativeInteger,
        blockingUxIssue: nullableBoolean,
        notes: z.string(),
      })
      .strict(),
    defects: z.array(
      z
        .object({
          severity: z.enum(['blocking', 'nonblocking']),
          summary: z.string().trim().min(1),
        })
        .strict()
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.selectorAndImages.expectedSelectorCount !== value.variationCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expectedSelectorCount must equal variationCount.',
        path: ['selectorAndImages', 'expectedSelectorCount'],
      });
    }
    for (const slot of value.replenishment.slots) {
      const position = Number(slot.slice(1));
      if (!Number.isSafeInteger(position) || position < 1 || position > value.variationCount) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Replenishment slot ${slot} is outside the fixture variation range.`,
          path: ['replenishment', 'slots'],
        });
      } else if (slot !== scaleSlot(position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Replenishment slot ${slot} must use the fixture slot format ${scaleSlot(position)}.`,
          path: ['replenishment', 'slots'],
        });
      }
    }
    const expectedReplenishmentSlots = replenishmentPositions(value.variationCount).map(scaleSlot);
    if (
      value.replenishment.slots.length !== expectedReplenishmentSlots.length ||
      value.replenishment.slots.some((slot, index) => slot !== expectedReplenishmentSlots[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Replenishment slots must match the fixture sample: ${expectedReplenishmentSlots.join(', ')}.`,
        path: ['replenishment', 'slots'],
      });
    }
  });

export type VariationListingScalePilotEvidence = z.infer<
  typeof variationListingScalePilotEvidenceSchema
>;

export interface VariationListingScaleFixtureSlot {
  slot: string;
  position: number;
  manualPriceAmount: (typeof VARIATION_LISTING_SCALE_PRICE_TIERS)[number];
}

export interface VariationListingScaleFixture {
  variationCount: number;
  variations: readonly VariationListingScaleFixtureSlot[];
  replenishmentSlots: readonly string[];
  expectedOperationCounts: {
    initialMediaBackedPublication: number;
    duplicateOnlyActiveRevision: number;
  };
}

export type VariationListingScalePilotEvaluationStatus = 'incomplete' | 'hold' | 'promote';

export interface VariationListingScalePilotEvaluation {
  status: VariationListingScalePilotEvaluationStatus;
  variationCount: number;
  nextCandidateVariationCount: number | null;
  reasons: readonly string[];
}

const requiredMeasurementPaths: {
  label: string;
  read: (evidence: VariationListingScalePilotEvidence) => unknown;
}[] = [
  { label: 'capture-to-publish-ready timing', read: (value) => value.timings.captureToPublishReadyMs },
  { label: 'initial publish timing', read: (value) => value.timings.initialPublishMs },
  { label: 'initial verification timing', read: (value) => value.timings.initialVerificationMs },
  { label: 'staged publish timing', read: (value) => value.timings.stagedPublishMs },
  { label: 'staged verification timing', read: (value) => value.timings.stagedVerificationMs },
  { label: 'observed selector count', read: (value) => value.selectorAndImages.observedSelectorCount },
  { label: 'selector exact membership check', read: (value) => value.selectorAndImages.exactMembership },
  { label: 'selector order check', read: (value) => value.selectorAndImages.applicationOrderMatches },
  { label: 'selector uniqueness check', read: (value) => value.selectorAndImages.allSelectorsUnique },
  { label: 'representative front/back image check', read: (value) => value.selectorAndImages.allRepresentativeFrontBackPairsCorrect },
  { label: 'initial desired revision', read: (value) => value.revisionAndRecovery.initialDesiredRevision },
  { label: 'initial confirmed revision', read: (value) => value.revisionAndRecovery.initialConfirmedRevision },
  { label: 'staged desired revision', read: (value) => value.revisionAndRecovery.stagedDesiredRevision },
  { label: 'staged confirmed revision', read: (value) => value.revisionAndRecovery.stagedConfirmedRevision },
  { label: 'unresolved outcome check', read: (value) => value.revisionAndRecovery.unresolvedOutcome },
  { label: 'bounded retry count', read: (value) => value.revisionAndRecovery.boundedRetryCount },
  { label: 'operator recovery intervention count', read: (value) => value.revisionAndRecovery.operatorRecoveryInterventions },
  { label: 'replenishment quantity check', read: (value) => value.replenishment.expectedQuantitiesMatch },
  { label: 'untouched sibling quantity check', read: (value) => value.replenishment.untouchedSiblingQuantitiesStable },
  { label: 'operator elapsed time', read: (value) => value.operator.totalElapsedMinutes },
  { label: 'operator manual step count', read: (value) => value.operator.manualStepCount },
  { label: 'blocking UX check', read: (value) => value.operator.blockingUxIssue },
];

function scaleSlot(position: number): string {
  return `V${String(position).padStart(2, '0')}`;
}

function replenishmentPositions(variationCount: number): number[] {
  if (variationCount === VARIATION_LISTING_SCALE_PILOT_START_COUNT) return [2, 5, 9];
  const positions = [2, Math.ceil(variationCount / 2), Math.max(3, variationCount - 1)];
  return [...new Set(positions)].filter((position) => position <= variationCount);
}

export function expectedInitialMediaBackedPublicationOperations(variationCount: number): number {
  if (!Number.isSafeInteger(variationCount) || variationCount < 2) {
    throw new Error('Variation count must be an integer of at least 2.');
  }
  return variationCount * 4 + 3;
}

export function expectedDuplicateOnlyActiveRevisionOperations(variationCount: number): number {
  if (!Number.isSafeInteger(variationCount) || variationCount < 2) {
    throw new Error('Variation count must be an integer of at least 2.');
  }
  return variationCount * 2 + 2;
}

export function buildVariationListingScaleFixture(
  variationCount: number = VARIATION_LISTING_SCALE_PILOT_START_COUNT
): VariationListingScaleFixture {
  if (!Number.isSafeInteger(variationCount) || variationCount < VARIATION_LISTING_SCALE_PILOT_START_COUNT) {
    throw new Error(
      `Scale pilot fixture requires at least ${VARIATION_LISTING_SCALE_PILOT_START_COUNT} variations.`
    );
  }
  const variations = Array.from({ length: variationCount }, (_, index): VariationListingScaleFixtureSlot => ({
    slot: scaleSlot(index + 1),
    position: index + 1,
    manualPriceAmount: VARIATION_LISTING_SCALE_PRICE_TIERS[index % VARIATION_LISTING_SCALE_PRICE_TIERS.length],
  }));
  return {
    variationCount,
    variations,
    replenishmentSlots: replenishmentPositions(variationCount).map(scaleSlot),
    expectedOperationCounts: {
      initialMediaBackedPublication: expectedInitialMediaBackedPublicationOperations(variationCount),
      duplicateOnlyActiveRevision: expectedDuplicateOnlyActiveRevisionOperations(variationCount),
    },
  };
}

export function buildVariationListingScaleEvidenceTemplate(
  variationCount: number = VARIATION_LISTING_SCALE_PILOT_START_COUNT
): VariationListingScalePilotEvidence {
  const fixture = buildVariationListingScaleFixture(variationCount);
  return variationListingScalePilotEvidenceSchema.parse({
    version: VARIATION_LISTING_SCALE_PILOT_EVIDENCE_VERSION,
    environment: 'sandbox',
    variationCount,
    timings: {
      captureToPublishReadyMs: null,
      initialPublishMs: null,
      initialVerificationMs: null,
      stagedPublishMs: null,
      stagedVerificationMs: null,
    },
    selectorAndImages: {
      expectedSelectorCount: variationCount,
      observedSelectorCount: null,
      exactMembership: null,
      applicationOrderMatches: null,
      allSelectorsUnique: null,
      allRepresentativeFrontBackPairsCorrect: null,
    },
    revisionAndRecovery: {
      initialDesiredRevision: null,
      initialConfirmedRevision: null,
      stagedDesiredRevision: null,
      stagedConfirmedRevision: null,
      unresolvedOutcome: null,
      boundedRetryCount: null,
      operatorRecoveryInterventions: null,
    },
    replenishment: {
      slots: [...fixture.replenishmentSlots],
      expectedQuantitiesMatch: null,
      untouchedSiblingQuantitiesStable: null,
    },
    operator: {
      totalElapsedMinutes: null,
      manualStepCount: null,
      blockingUxIssue: null,
      notes: '',
    },
    defects: [],
  });
}

export function parseVariationListingScaleEvidence(value: unknown): VariationListingScalePilotEvidence {
  return variationListingScalePilotEvidenceSchema.parse(value);
}

export function evaluateVariationListingScaleEvidence(
  input: VariationListingScalePilotEvidence
): VariationListingScalePilotEvaluation {
  const evidence = variationListingScalePilotEvidenceSchema.parse(input);
  const missing = requiredMeasurementPaths
    .filter((entry) => entry.read(evidence) === null)
    .map((entry) => entry.label);
  if (missing.length > 0) {
    return {
      status: 'incomplete',
      variationCount: evidence.variationCount,
      nextCandidateVariationCount: null,
      reasons: missing.map((label) => `Missing ${label}.`),
    };
  }

  const reasons: string[] = [];
  if (evidence.selectorAndImages.observedSelectorCount !== evidence.variationCount) {
    reasons.push('Observed selector count does not match the fixture variation count.');
  }
  if (!evidence.selectorAndImages.exactMembership) reasons.push('Selector membership did not match exactly.');
  if (!evidence.selectorAndImages.applicationOrderMatches) reasons.push('Buyer selector order did not match application order.');
  if (!evidence.selectorAndImages.allSelectorsUnique) reasons.push('Selector values were not all unique.');
  if (!evidence.selectorAndImages.allRepresentativeFrontBackPairsCorrect) {
    reasons.push('One or more selector values did not map to the expected representative front/back image pair.');
  }
  if (evidence.revisionAndRecovery.initialDesiredRevision !== evidence.revisionAndRecovery.initialConfirmedRevision) {
    reasons.push('Initial publication did not confirm the complete desired revision.');
  }
  if (evidence.revisionAndRecovery.stagedDesiredRevision !== evidence.revisionAndRecovery.stagedConfirmedRevision) {
    reasons.push('Staged publication did not confirm the complete desired revision.');
  }
  if (evidence.revisionAndRecovery.unresolvedOutcome) reasons.push('An unresolved or unknown mutation outcome remains.');
  if ((evidence.revisionAndRecovery.boundedRetryCount ?? 0) > 1) {
    reasons.push('The pilot exceeded the one bounded replay recovery contract.');
  }
  if ((evidence.revisionAndRecovery.operatorRecoveryInterventions ?? 0) > 0) {
    reasons.push('The pilot required operator recovery intervention.');
  }
  if (!evidence.replenishment.expectedQuantitiesMatch) {
    reasons.push('Replenished variations did not reconcile to expected eBay-authoritative quantities.');
  }
  if (!evidence.replenishment.untouchedSiblingQuantitiesStable) {
    reasons.push('One or more untouched sibling quantities changed unexpectedly.');
  }
  if (evidence.operator.blockingUxIssue) reasons.push('A blocking operator UX issue was observed.');
  for (const defect of evidence.defects.filter((item) => item.severity === 'blocking')) {
    reasons.push(`Blocking defect: ${defect.summary}`);
  }

  if (reasons.length > 0) {
    return {
      status: 'hold',
      variationCount: evidence.variationCount,
      nextCandidateVariationCount: null,
      reasons,
    };
  }

  return {
    status: 'promote',
    variationCount: evidence.variationCount,
    nextCandidateVariationCount: evidence.variationCount * 2,
    reasons: [
      'All correctness, revision, replenishment, recovery, and operator gates passed.',
      'Timing and workload measurements are evidence for the next live pilot; they are not an operational-cap decision.',
    ],
  };
}

export function compareVariationListingScaleEvidence(
  previousInput: VariationListingScalePilotEvidence,
  currentInput: VariationListingScalePilotEvidence
): {
  previousVariationCount: number;
  currentVariationCount: number;
  timingRatios: Record<keyof VariationListingScalePilotEvidence['timings'], number | null>;
  operatorElapsedRatio: number | null;
  manualStepRatio: number | null;
} {
  const previous = variationListingScalePilotEvidenceSchema.parse(previousInput);
  const current = variationListingScalePilotEvidenceSchema.parse(currentInput);
  const ratio = (left: number | null, right: number | null): number | null =>
    left === null || right === null || left === 0 ? null : right / left;
  return {
    previousVariationCount: previous.variationCount,
    currentVariationCount: current.variationCount,
    timingRatios: {
      captureToPublishReadyMs: ratio(previous.timings.captureToPublishReadyMs, current.timings.captureToPublishReadyMs),
      initialPublishMs: ratio(previous.timings.initialPublishMs, current.timings.initialPublishMs),
      initialVerificationMs: ratio(previous.timings.initialVerificationMs, current.timings.initialVerificationMs),
      stagedPublishMs: ratio(previous.timings.stagedPublishMs, current.timings.stagedPublishMs),
      stagedVerificationMs: ratio(previous.timings.stagedVerificationMs, current.timings.stagedVerificationMs),
    },
    operatorElapsedRatio: ratio(previous.operator.totalElapsedMinutes, current.operator.totalElapsedMinutes),
    manualStepRatio: ratio(previous.operator.manualStepCount, current.operator.manualStepCount),
  };
}
