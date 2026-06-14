import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getInvite, acceptInvite } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.js';
import { Button } from '../components/ui/button.js';

// Public landing for an invite link (/accept-invite?token=...). Confirms the token,
// shows which email it's for, and lets the invitee set a password — which creates the
// account and logs them straight in.
export function AcceptInvite(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This invite link is missing its token.');
      setChecking(false);
      return;
    }
    getInvite(token)
      .then((inv) => setEmail(inv.email))
      .catch(() => setError('This invite is invalid or has expired.'))
      .finally(() => setChecking(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await acceptInvite(token, password);
      await refresh(); // pick up the session set by accept
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invite');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-sm font-semibold text-foreground">
            Scent <span className="text-muted-foreground font-normal">Observatory</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Accept your invitation</p>
        </div>

        {checking && <p className="text-xs text-muted-foreground">Checking invite…</p>}

        {!checking && !email && (
          <div className="space-y-3">
            <p className="text-xs text-red-400">{error}</p>
            <Link to="/login" className="text-xs text-muted-foreground underline">
              Go to sign in
            </Link>
          </div>
        )}

        {!checking && email && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                disabled
                autoComplete="username"
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-xs text-muted-foreground">
                Choose a password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Setting up…' : 'Accept invite'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
