import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw, Trash2, Copy, Check, KeyRound, X } from 'lucide-react';
import {
  listProjects,
  createProject,
  rotateProjectKey,
  deleteProject,
  type AdminProject,
} from '../lib/api.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDate } from '../lib/utils.js';

// Shown once after create/rotate — the plaintext key is not recoverable afterwards.
function RevealedKey({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-amber-400">New API key — {label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Copy it now. It will not be shown again.</p>
          <code className="mt-2 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
            {value}
          </code>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <Button size="sm" variant="outline" className="mt-3" onClick={copy}>
        {copied ? <Check size={13} className="mr-1.5" /> : <Copy size={13} className="mr-1.5" />}
        {copied ? 'Copied' : 'Copy key'}
      </Button>
    </div>
  );
}

export function Settings(): React.ReactElement {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-projects'], queryFn: listProjects });

  const [name, setName] = useState('');
  const [revealed, setRevealed] = useState<{ label: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['admin-projects'] });
  const fail = (e: unknown): void => setError(e instanceof Error ? e.message : 'Something went wrong');

  const create = useMutation({
    mutationFn: () => createProject(name.trim()),
    onSuccess: async (res) => {
      setRevealed({ label: res.project.name, key: res.apiKey });
      setName('');
      setError(null);
      await invalidate();
    },
    onError: fail,
  });

  const rotate = useMutation({
    mutationFn: async (p: AdminProject) => ({ p, res: await rotateProjectKey(p.id) }),
    onSuccess: async ({ p, res }) => {
      setRevealed({ label: `${p.name} (rotated)`, key: res.apiKey });
      setError(null);
      await invalidate();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: fail,
  });

  const projects = data?.projects ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">API Keys</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Create a project to get an API key for the SDK. Keys are shown once and stored hashed.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus size={15} className="mr-1.5" />
          Create
        </Button>
      </form>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {revealed && (
        <RevealedKey label={revealed.label} value={revealed.key} onDismiss={() => setRevealed(null)} />
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left">
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Key</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-4">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            )}
            {!isLoading && projects.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No projects yet. Create one above.
                </td>
              </tr>
            )}
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{p.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {p.key_prefix ? `${p.key_prefix}…` : '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rotate.isPending}
                      onClick={() => {
                        if (window.confirm(`Rotate the key for "${p.name}"? The current key stops working immediately.`)) {
                          rotate.mutate(p);
                        }
                      }}
                    >
                      <RotateCw size={13} className="mr-1.5" />
                      Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete "${p.name}"? This permanently removes the project and all its identities.`)) {
                          remove.mutate(p.id);
                        }
                      }}
                    >
                      <Trash2 size={13} className="mr-1.5 text-red-400" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <KeyRound size={12} /> Keys authenticate the SDK against <code className="font-mono">/v1</code>. Rotating invalidates the old key immediately.
      </p>
    </div>
  );
}
