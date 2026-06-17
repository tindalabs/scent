import type { ScentObservation } from '@tindalabs/scent-engine';

export type ScentEventMap = {
  identity_resolved: ScentObservation;
  drift: ScentObservation['drift'] & { observation: ScentObservation };
  risk_elevated: ScentObservation['risk'] & { observation: ScentObservation };
  consent_changed: { granted: boolean; basis: string };
};

type Handler<T> = (payload: T) => void;

export class ScentEventEmitter {
  private readonly listeners = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof ScentEventMap>(event: K, handler: Handler<ScentEventMap[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as Handler<unknown>);
    // Returns an unsubscribe function
    return () => this.off(event, handler);
  }

  off<K extends keyof ScentEventMap>(event: K, handler: Handler<ScentEventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof ScentEventMap>(event: K, payload: ScentEventMap[K]): void {
    this.listeners.get(event)?.forEach((h) => h(payload));
  }
}
