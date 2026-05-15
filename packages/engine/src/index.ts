export type {
  ScentIdentity,
  ScentSnapshot,
  ScentDrift,
  ScentRisk,
  ScentObservation,
  ScentInitOptions,
  RiskFlag,
  SignalMap,
  ConfidenceBand,
  RiskBand,
  DriftClassification,
  IdentityContinuity,
  PersistencePolicy,
} from './types.js';

export { weightOf, buildWeightMap, decayMultiplier } from './signals/weights.js';
export {
  computeSimHash,
  hammingDistance,
  simHashToHex,
  hexToSimHash,
} from './simhash/index.js';
export type { SimHash } from './simhash/index.js';
export { weightedJaccard } from './matching/jaccard.js';
export type { MatchResult, JaccardOptions } from './matching/jaccard.js';
export {
  scoreToConfidenceBand,
  scoreToIdentityContinuity,
  SIMHASH_CANDIDATE_THRESHOLD,
} from './matching/confidence.js';
export { diffSnapshots } from './drift/index.js';
export type { DriftResult } from './drift/index.js';
