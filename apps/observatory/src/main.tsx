import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App(): JSX.Element {
  return (
    <main style={{ fontFamily: 'monospace', maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
      <h2>Scent Observatory</h2>
      <p style={{ color: '#666' }}>Phase 4 — UI implementation pending.</p>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(<StrictMode><App /></StrictMode>);
