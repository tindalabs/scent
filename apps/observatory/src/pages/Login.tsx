import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { ApiError } from '../lib/api.js';
import { Button } from '../components/ui/button.js';

export function Login(): React.ReactElement {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const second = needsCode
        ? useRecovery
          ? { recoveryCode: code }
          : { totpCode: code }
        : undefined;
      await login(email, password, second);
      navigate('/');
    } catch (err) {
      // The server signals 2FA is needed with { twoFactorRequired: true }.
      if (err instanceof ApiError && err.body?.['twoFactorRequired']) {
        setNeedsCode(true);
        setError(needsCode ? 'Invalid code — try again.' : null);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-sm font-semibold text-foreground">
            Scent <span className="text-muted-foreground font-normal">Observatory</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Sign in to manage API keys</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-xs text-muted-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-xs text-muted-foreground">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          />
        </div>

        {needsCode && (
          <div className="space-y-1">
            <label htmlFor="code" className="text-xs text-muted-foreground">
              {useRecovery ? 'Recovery code' : 'Authenticator code'}
            </label>
            <input
              id="code"
              type="text"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            />
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode('');
              }}
              className="text-xs text-muted-foreground underline"
            >
              {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : needsCode ? 'Verify' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
