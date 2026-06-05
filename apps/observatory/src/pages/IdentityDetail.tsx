import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, GitBranch, Link2 } from 'lucide-react';
import { fetchIdentity, fetchSignals, fetchTimeline, fetchAccountLinks } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDate } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

const CONF_VARIANT: Record<string, BadgeProps['variant']> = {
  confirmed: 'confirmed', probable: 'probable', uncertain: 'uncertain', unknown: 'unknown',
};
const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
};

// Prefix → stability class for signal explainability
function stabilityOf(key: string): 'stable' | 'moderate' | 'volatile' {
  if (
    key.startsWith('canvas.') || key.startsWith('webgl.') || key.startsWith('audio.') ||
    key.startsWith('fonts.') || key === 'hw.concurrency' || key === 'hw.memory'
  ) return 'stable';
  if (
    key.startsWith('screen.') || key.startsWith('tz.') || key.startsWith('locale.') ||
    key.startsWith('platform.') || key.startsWith('net.')
  ) return 'moderate';
  return 'volatile';
}

const STABILITY_BADGE: Record<string, BadgeProps['variant']> = {
  stable: 'confirmed',
  moderate: 'probable',
  volatile: 'uncertain',
};

export function IdentityDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const identityId = id!;

  const { data: identity, isLoading: loadingId } = useQuery({
    queryKey: ['identity', identityId],
    queryFn: () => fetchIdentity(identityId),
  });

  const { data: signalsData, isLoading: loadingSig } = useQuery({
    queryKey: ['signals', identityId],
    queryFn: () => fetchSignals(identityId),
  });

  const { data: timelineData } = useQuery({
    queryKey: ['timeline', identityId],
    queryFn: () => fetchTimeline(identityId),
  });

  const { data: accountData } = useQuery({
    queryKey: ['accounts', identityId],
    queryFn: () => fetchAccountLinks(identityId),
  });

  if (loadingId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!identity) {
    return <p className="text-sm text-red-400">Identity not found.</p>;
  }

  const signals = signalsData?.signals ?? {};
  const signalKeys = Object.keys(signals);
  const stableCount = signalKeys.filter((k) => stabilityOf(k) === 'stable').length;
  const presentStable = signalKeys.filter((k) => stabilityOf(k) === 'stable' && signals[k] !== null).length;

  const drifts = timelineData?.drifts ?? [];
  const lastDrift = drifts[drifts.length - 1];

  const accounts = accountData?.accounts ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/identities" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-mono text-sm text-foreground break-all">{identityId}</h1>
      </div>

      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={CONF_VARIANT[identity.confidence_band] ?? 'unknown'}>
          {identity.confidence_band}
        </Badge>
        <Badge variant={RISK_VARIANT[identity.risk_band] ?? 'low'}>
          risk: {identity.risk_band}
        </Badge>
        {identity.riskScore !== null && identity.riskScore !== undefined && (
          <span className="text-xs text-muted-foreground">score {identity.riskScore.toFixed(3)}</span>
        )}
        {identity.cluster_id && (
          <Link
            to={`/clusters/${identity.cluster_id}`}
            className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
          >
            <GitBranch size={11} /> cluster
          </Link>
        )}
      </div>

      {/* Metadata row */}
      <div className="flex gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock size={11} /> First seen {formatDate(identity.first_seen)}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={11} /> Last seen {formatDate(identity.last_seen)}
        </span>
        <span>{identity.snapshot_count} snapshot{identity.snapshot_count === 1 ? '' : 's'}</span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Risk flags */}
        <Card>
          <CardHeader>
            <CardTitle>Risk flags</CardTitle>
          </CardHeader>
          <CardContent>
            {(identity.riskFlags?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No active risk flags.</p>
            ) : (
              <ul className="space-y-3">
                {identity.riskFlags!.map((flag) => (
                  <li key={flag.code} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{flag.label}</span>
                      <Badge variant="high" className="text-[10px]">
                        {(flag.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{flag.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Explainability panel */}
        <Card>
          <CardHeader>
            <CardTitle>Signal explainability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            {loadingSig ? (
              <Skeleton className="h-16" />
            ) : (
              <>
                <p>
                  Stable signals present: <span className="text-foreground font-medium">{presentStable}</span>
                  {' / '}
                  <span className="text-foreground font-medium">{stableCount}</span>
                </p>
                {lastDrift && (
                  <p>
                    Last drift:{' '}
                    <Badge variant={lastDrift.classification as BadgeProps['variant']} className="text-[10px]">
                      {lastDrift.classification}
                    </Badge>{' '}
                    — entropy {lastDrift.entropy.toFixed(3)}
                  </p>
                )}
                {lastDrift && lastDrift.changed_signals.length > 0 && (
                  <p>Changed: {lastDrift.changed_signals.join(', ')}</p>
                )}
                {lastDrift && lastDrift.added_signals.length > 0 && (
                  <p>Added: {lastDrift.added_signals.join(', ')}</p>
                )}
                {lastDrift && lastDrift.removed_signals.length > 0 && (
                  <p>Absent: {lastDrift.removed_signals.join(', ')}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Linked accounts — populated by scent.identify(accountId) calls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Link2 size={14} /> Linked accounts
            </CardTitle>
            {accounts.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {accounts.length} account{accounts.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className={accounts.length === 0 ? undefined : 'p-0'}>
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No application accounts linked yet. Call{' '}
              <code className="font-mono text-foreground">scent.identify(accountId)</code> after login to
              associate this device with an account.
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Account</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Links</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">First linked</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last linked</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.account_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-foreground break-all">{a.account_id}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{a.link_count}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(a.first_linked_at)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(a.last_linked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signal profile table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Signal profile</CardTitle>
            {signalsData && (
              <span className="text-xs text-muted-foreground">as of {formatDate(signalsData.asOf)}</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingSig ? (
            <div className="p-5 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6" />)}
            </div>
          ) : (
            <div className="overflow-auto max-h-96">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Signal</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Stability</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {signalKeys.map((key) => (
                    <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-foreground">{key}</td>
                      <td className="px-4 py-2">
                        <Badge variant={STABILITY_BADGE[stabilityOf(key)] ?? 'unknown'} className="text-[10px]">
                          {stabilityOf(key)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground max-w-xs truncate font-mono">
                        {signals[key] === null
                          ? <span className="italic opacity-50">null</span>
                          : typeof signals[key] === 'object'
                            ? JSON.stringify(signals[key])
                            : String(signals[key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Link
          to={`/identities/${identityId}/timeline`}
          className="text-sm text-sky-400 hover:text-sky-300 underline underline-offset-2"
        >
          View drift timeline →
        </Link>
      </div>
    </div>
  );
}
