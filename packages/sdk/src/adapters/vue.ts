// @irregular/scent-sdk/vue
// Import as: import { useScent } from '@irregular/scent-sdk/vue'
//
// Vue is a peer dependency — not bundled. The host app provides it.

import { ref, onMounted } from 'vue';
import { init, ScentSDK } from '../index.js';
import type { ScentObservation, ScentInitOptions } from '../index.js';

export interface UseScentResult {
  observation: ReturnType<typeof ref<ScentObservation | null>>;
  loading: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<Error | null>>;
  sdk: ScentSDK;
  refresh: () => Promise<void>;
}

export function useScent(options: ScentInitOptions): UseScentResult {
  const observation = ref<ScentObservation | null>(null);
  const loading = ref(true);
  const error = ref<Error | null>(null);
  const sdk = init(options);

  const refresh = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      observation.value = await sdk.observe();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  };

  onMounted(refresh);

  return { observation, loading, error, sdk, refresh };
}
