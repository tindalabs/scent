import { useState } from 'react';
import { changePassword } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.js';
import { Button } from '../components/ui/button.js';

// Self-service account page: shows who you are and lets you change your password.
// Changing it logs out your other devices (the server revokes other sessions).
export function Account(): React.ReactElement {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setStatus('idle');
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Account</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{user?.email}</span>
          {user && <span className="ml-1 text-muted-foreground">({user.role})</span>}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-medium text-foreground">Change password</h2>
        <div className="space-y-1">
          <label htmlFor="current" className="text-xs text-muted-foreground">Current password</label>
          <input
            id="current"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="next" className="text-xs text-muted-foreground">New password</label>
          <input
            id="next"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          />
          <p className="text-xs text-muted-foreground">At least 8 characters. Other devices will be signed out.</p>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {status === 'saved' && <p className="text-xs text-emerald-400">Password updated.</p>}

        <Button type="submit" disabled={submitting || !current || next.length < 8}>
          {submitting ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </div>
  );
}
