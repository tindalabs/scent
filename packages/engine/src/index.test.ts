import { describe, it, expect } from 'vitest';
import type { ScentObservation, ScentIdentity } from './types.js';

describe('core types', () => {
  it('ScentObservation shape is structurally correct', () => {
    const obs: ScentObservation = {
      identity: { id: 'test-id', confidence: 0.93, isNew: false, continuity: 'probable' },
      drift: { detected: true, delta: ['canvas'], entropy: 0.12 },
      risk: { score: 0.1, flags: [] },
    };
    expect(obs.identity.confidence).toBe(0.93);
    expect(obs.drift.delta).toContain('canvas');
  });

  it('ScentIdentity defaults are representable', () => {
    const identity: ScentIdentity = {
      id: 'abc',
      firstSeen: new Date(),
      lastSeen: new Date(),
      confidenceBand: 'high',
      riskBand: 'low',
      snapshotCount: 1,
    };
    expect(identity.clusterId).toBeUndefined();
  });
});
