// @tindalabs/scent-sdk/react
// Import as: import { useScent } from '@tindalabs/scent-sdk/react'
//
// React is a peer dependency — not bundled. The host app provides it.

import { useState, useEffect, useRef, useCallback } from 'react';
import { init, ScentSDK } from '../index.js';
import type { ScentObservation, ScentInitOptions } from '../index.js';

export interface UseScentResult {
  observation: ScentObservation | null;
  loading: boolean;
  error: Error | null;
  sdk: ScentSDK | null;
  refresh: () => void;
}

export function useScent(options: ScentInitOptions): UseScentResult {
  const [observation, setObservation] = useState<ScentObservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const sdkRef = useRef<ScentSDK | null>(null);

  if (!sdkRef.current) {
    sdkRef.current = init(options);
  }

  const observe = useCallback(() => {
    setLoading(true);
    setError(null);
    sdkRef.current!
      .observe()
      .then((obs: ScentObservation) => {
        setObservation(obs);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    observe();
  }, [observe]);

  return { observation, loading, error, sdk: sdkRef.current, refresh: observe };
}
