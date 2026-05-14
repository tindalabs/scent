import { init } from '@irregular/scent-sdk';

const out = document.getElementById('output')!;

const sdk = init({ apiKey: 'demo-key', persistence: 'balanced' });

sdk
  .observe()
  .then((observation) => {
    out.textContent = JSON.stringify(observation, null, 2);
  })
  .catch((err: unknown) => {
    out.textContent = String(err instanceof Error ? err.message : err);
  });
