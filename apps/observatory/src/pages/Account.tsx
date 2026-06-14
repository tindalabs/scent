import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { changePassword, setup2fa, verify2fa, disable2fa } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.js';
import { Button } from '../components/ui/button.js';
import { Badge } from '../components/ui/badge.js';

function PasswordCard(): React.ReactElement {
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
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium text-foreground">Change password</h2>
      <div className="space-y-1">
        <label htmlFor="current" className="text-xs text-muted-foreground">Current password</label>
        <input
          id="current" type="password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="next" className="text-xs text-muted-foreground">New password</label>
        <input
          id="next" type="password" required minLength={8} autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)}
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
  );
}

function RecoveryCodes({ codes }: { codes: string[] }): React.ReactElement {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-xs font-medium text-amber-400">Recovery codes</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Save these now — each works once if you lose your authenticator. They will not be shown again.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-foreground">
        {codes.map((c) => <code key={c} className="rounded bg-background px-2 py-1">{c}</code>)}
      </div>
    </div>
  );
}

function TwoFactorCard(): React.ReactElement {
  const { user, refresh } = useAuth();
  const [setupData, setSetupData] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = user?.totpEnabled ?? false;

  async function begin(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setSetupData(await setup2fa());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { recoveryCodes } = await verify2fa(code);
      setRecovery(recoveryCodes);
      setSetupData(null);
      setCode('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await disable2fa(password);
      setDisabling(false);
      setPassword('');
      setRecovery(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Two-factor authentication</h2>
        <Badge variant={enabled ? 'confirmed' : 'unknown'}>{enabled ? 'enabled' : 'disabled'}</Badge>
      </div>

      {/* Enabled + not mid-disable */}
      {enabled && !disabling && (
        <Button size="sm" variant="outline" onClick={() => setDisabling(true)}>Disable 2FA</Button>
      )}

      {enabled && disabling && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Confirm your password to disable 2FA.</p>
          <input
            type="password" autoComplete="current-password" placeholder="Current password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || !password} onClick={turnOff}>Disable</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDisabling(false); setPassword(''); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Not enabled, not mid-setup */}
      {!enabled && !setupData && !recovery && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Protect your account with a time-based code from an authenticator app.
          </p>
          <Button size="sm" disabled={busy} onClick={begin}>Enable 2FA</Button>
        </div>
      )}

      {/* Mid-setup: show QR + secret + code entry */}
      {setupData && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Scan this with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          <div className="rounded-md bg-white p-3 w-fit">
            <QRCodeSVG value={setupData.otpauthUri} size={140} />
          </div>
          <p className="text-xs text-muted-foreground">
            Or enter this secret manually: <code className="font-mono text-foreground">{setupData.secret}</code>
          </p>
          <div className="flex gap-2">
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
              value={code} onChange={(e) => setCode(e.target.value)}
              className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            />
            <Button size="sm" disabled={busy || !code} onClick={confirm}>Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSetupData(null); setCode(''); }}>Cancel</Button>
          </div>
        </div>
      )}

      {recovery && <RecoveryCodes codes={recovery} />}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Account(): React.ReactElement {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Account</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{user?.email}</span>
          {user && <span className="ml-1 text-muted-foreground">({user.role})</span>}
        </p>
      </div>

      {user?.mustEnroll && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-400">Two-factor authentication is required</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your organization requires 2FA. Set it up below to regain access to the rest of the Observatory.
          </p>
        </div>
      )}

      <TwoFactorCard />
      <PasswordCard />
    </div>
  );
}
