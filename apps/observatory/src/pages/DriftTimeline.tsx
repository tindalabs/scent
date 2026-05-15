import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { fetchTimeline, fetchSignals } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDate, formatDateShort } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

const DRIFT_COLORS: Record<string, string> = {
  minor: '#6b7a99',
  moderate: '#60a5fa',
  significant: '#fbbf24',
  suspicious: '#f87171',
};

function SignalHeatmap({ identityId }: { identityId: string }): React.ReactElement {
  const { data: sigData, isLoading } = useQuery({
    queryKey: ['signals', identityId],
    queryFn: () => fetchSignals(identityId),
  });

  const { data: tlData } = useQuery({
    queryKey: ['timeline', identityId],
    queryFn: () => fetchTimeline(identityId),
  });

  if (isLoading) return <Skeleton className="h-32" />;

  // Build per-signal volatility from drift history
  const sigKeys = Object.keys(sigData?.signals ?? {});
  const drifts = tlData?.drifts ?? [];

  const changeCount: Record<string, number> = {};
  for (const d of drifts) {
    for (const k of d.changed_signals) {
      changeCount[k] = (changeCount[k] ?? 0) + 1;
    }
  }

  const maxChange = Math.max(1, ...Object.values(changeCount));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {sigKeys.map((k) => {
          const count = changeCount[k] ?? 0;
          const opacity = 0.1 + (count / maxChange) * 0.9;
          return (
            <div
              key={k}
              className="flex items-center justify-between rounded px-2 py-1.5 text-[10px] font-mono"
              style={{ background: `rgba(251,191,36,${opacity})`, color: opacity > 0.5 ? '#0d1117' : '#e2e8f0' }}
              title={`${k}: changed ${count}×`}
            >
              <span className="truncate">{k}</span>
              <span className="ml-1 shrink-0 font-semibold">{count}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Colour intensity = number of times signal changed across all snapshots
      </p>
    </div>
  );
}

export function DriftTimeline(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const identityId = id!;

  const { data, isLoading } = useQuery({
    queryKey: ['timeline', identityId],
    queryFn: () => fetchTimeline(identityId),
  });

  const drifts = data?.drifts ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to={`/identities/${identityId}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Drift timeline</h1>
          <p className="font-mono text-xs text-muted-foreground break-all">{identityId}</p>
        </div>
      </div>

      {/* Entropy chart */}
      <Card>
        <CardHeader>
          <CardTitle>Entropy over time</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : drifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No drift events recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={drifts}>
                <defs>
                  <linearGradient id="entropyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(v) => formatDateShort(v as string)}
                  tick={{ fill: '#6b7a99', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: '#6b7a99', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: 6 }}
                  labelFormatter={(v) => formatDate(v as string)}
                  formatter={(v, _name, entry) => [
                    `${(v as number).toFixed(3)} (${entry.payload.classification as string})`,
                    'entropy',
                  ]}
                  labelStyle={{ color: '#94a3b8' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Area
                  type="monotone"
                  dataKey="entropy"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  fill="url(#entropyGrad)"
                  dot={(props) => {
                    const { cx, cy, payload } = props as { cx: number; cy: number; payload: { classification: string } };
                    return (
                      <circle
                        key={`dot-${cx}-${cy}`}
                        cx={cx} cy={cy} r={4}
                        fill={DRIFT_COLORS[payload.classification] ?? '#6b7a99'}
                        stroke="none"
                      />
                    );
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Signal stability heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>Signal volatility heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <SignalHeatmap identityId={identityId} />
        </CardContent>
      </Card>

      {/* Drift event list */}
      <Card>
        <CardHeader>
          <CardTitle>Drift events ({drifts.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : drifts.length === 0 ? (
            <p className="p-5 text-xs text-muted-foreground">No drift events yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...drifts].reverse().map((d) => (
                <li key={d.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge variant={d.classification as BadgeProps['variant']}>{d.classification}</Badge>
                      <span className="text-xs text-muted-foreground">entropy {d.entropy.toFixed(4)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(d.timestamp)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {d.changed_signals.length > 0 && (
                      <span>Changed: <span className="text-amber-400">{d.changed_signals.join(', ')}</span></span>
                    )}
                    {d.added_signals.length > 0 && (
                      <span>Added: <span className="text-emerald-400">{d.added_signals.join(', ')}</span></span>
                    )}
                    {d.removed_signals.length > 0 && (
                      <span>Removed: <span className="text-red-400">{d.removed_signals.join(', ')}</span></span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
