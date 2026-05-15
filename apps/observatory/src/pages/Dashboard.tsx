import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { fetchDashboard } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardValue, CardContent } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Badge } from '../components/ui/badge.js';
import { formatDateShort } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

const RISK_COLORS: Record<string, string> = {
  low: '#34d399',
  medium: '#fbbf24',
  high: '#fb923c',
  critical: '#f87171',
};

function MetricCard({
  title, value, sub,
}: {
  title: string;
  value: string | number;
  sub?: React.ReactNode;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardValue>{value}</CardValue>
      </CardHeader>
      {sub && <CardContent><div className="text-xs text-muted-foreground">{sub}</div></CardContent>}
    </Card>
  );
}

const CONF_VARIANT: Record<string, BadgeProps['variant']> = {
  confirmed: 'confirmed',
  probable: 'probable',
  uncertain: 'uncertain',
  unknown: 'unknown',
};

export function Dashboard(): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-red-400">Failed to load dashboard data.</p>
      </div>
    );
  }

  const confVariant = CONF_VARIANT[data.avgConfidenceBand] ?? 'unknown';

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard title="Total identities" value={data.totalIdentities.toLocaleString()} />
        <MetricCard title="New today" value={data.newToday.toLocaleString()} />
        <MetricCard title="High-risk identities" value={data.highRiskCount.toLocaleString()} />
        <MetricCard
          title="Avg confidence"
          value=""
          sub={
            <Badge variant={confVariant}>
              {data.avgConfidenceBand}
            </Badge>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.riskDistribution} barSize={36}>
                <XAxis dataKey="band" tick={{ fill: '#6b7a99', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7a99', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: 6 }}
                  labelStyle={{ color: '#94a3b8' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.riskDistribution.map((entry) => (
                    <Cell key={entry.band} fill={RISK_COLORS[entry.band] ?? '#6b7a99'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drift rate — last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.driftRateTrend}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: '#6b7a99', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: '#6b7a99', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: 6 }}
                  labelStyle={{ color: '#94a3b8' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelFormatter={(v) => formatDateShort(v as string)}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={{ fill: '#60a5fa', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
