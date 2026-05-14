export type SignalValue = string | number | boolean | null;
export type SignalRecord = Record<string, SignalValue>;

// How stable a signal is across normal browsing — informs server-side weighting.
// Volatile signals decay faster in the identity model.
export type StabilityClass = 'stable' | 'moderate' | 'volatile';

export interface SignalCollector {
  readonly name: string;
  readonly stabilityClass: StabilityClass;
  collect(): Promise<SignalRecord>;
}
