import { trace, type Span } from '@opentelemetry/api';
import type { ScentObservation } from '@irregular/scent-sdk';

// Attribute name constants — stable across scent and blindspot-ux.
export const ATTR_IDENTITY_ID = 'scent.identity.id';
export const ATTR_IDENTITY_CONFIDENCE = 'scent.identity.confidence';
export const ATTR_IDENTITY_CONTINUITY = 'scent.identity.continuity';
export const ATTR_IDENTITY_IS_NEW = 'scent.identity.is_new';
export const ATTR_RISK_SCORE = 'scent.risk.score';
export const ATTR_RISK_FLAGS = 'scent.risk.flags';

// Attach scent identity and risk attributes to the given span (or the currently
// active span if none is provided). Safe to call with a non-recording span.
export function attachScentAttributes(obs: ScentObservation, span?: Span): void {
  const target = span ?? trace.getActiveSpan();
  if (!target || !target.isRecording()) return;

  target.setAttributes({
    [ATTR_IDENTITY_ID]: obs.identity.id,
    [ATTR_IDENTITY_CONFIDENCE]: obs.identity.confidence,
    [ATTR_IDENTITY_CONTINUITY]: obs.identity.continuity,
    [ATTR_IDENTITY_IS_NEW]: obs.identity.isNew,
    [ATTR_RISK_SCORE]: obs.risk.score,
    [ATTR_RISK_FLAGS]: obs.risk.flags.join(','),
  });
}
