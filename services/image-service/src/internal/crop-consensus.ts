export interface CropConsensusCandidate {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CROP_CONSENSUS_COUNT = 6;
const CROP_DISAGREEMENT_LIMIT = 0.025;

/**
 * Keep the all-scale/all-threshold consensus gate private to the image service.
 * A missing candidate or disagreement beyond 2.5% must fail closed.
 */
export function selectCropConsensus<T extends CropConsensusCandidate>(
  candidates: readonly (T | undefined)[]
): T | undefined {
  if (candidates.length !== CROP_CONSENSUS_COUNT || candidates.some((candidate) => candidate === undefined)) return undefined;

  const completeCandidates = candidates as readonly T[];

  const disagreement = Math.max(...(['left', 'top', 'right', 'bottom'] as const).map((key) => {
    const values = completeCandidates.map((candidate) => candidate[key]);
    return Math.max(...values) - Math.min(...values);
  }));
  if (disagreement > CROP_DISAGREEMENT_LIMIT) return undefined;

  return completeCandidates[4] ?? completeCandidates[0];
}
