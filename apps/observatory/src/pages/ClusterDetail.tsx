import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { fetchCluster } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { truncateId, formatDate } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

const CONF_VARIANT: Record<string, BadgeProps['variant']> = {
  confirmed: 'confirmed', probable: 'probable', uncertain: 'uncertain', unknown: 'unknown',
};
const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
};

const REASON_LABELS: Record<string, string> = {
  high_confidence_signal_overlap: 'High-confidence signal overlap',
  jaccard_similarity_above_threshold: 'Jaccard similarity above linking threshold',
};

export function ClusterDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const clusterId = id!;

  const { data, isLoading } = useQuery({
    queryKey: ['cluster', clusterId],
    queryFn: () => fetchCluster(clusterId),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-red-400">Cluster not found.</p>;
  }

  const { cluster, members } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/identities" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Cluster</h1>
          <p className="font-mono text-xs text-muted-foreground break-all">{clusterId}</p>
        </div>
      </div>

      {/* Why are these linked? */}
      <Card>
        <CardHeader>
          <CardTitle>Why are these identities linked?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {REASON_LABELS[cluster.reason] ?? cluster.reason}
          </p>
          <p className="text-xs text-muted-foreground">
            Cluster created {formatDate(cluster.created_at)} — {members.length} member
            {members.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-muted-foreground">
            Each member scored ≥ 0.90 Jaccard similarity against at least one other member,
            indicating the same real-world entity is appearing under different identity tokens —
            a typical pattern for coordinated identity rotation or aggressive cookie cycling.
          </p>
        </CardContent>
      </Card>

      {/* Members table */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Identity ID
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Confidence
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Risk
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Merge similarity
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/identities/${m.id}`}
                      className="font-mono text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
                    >
                      {truncateId(m.id)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={CONF_VARIANT[m.confidence_band] ?? 'unknown'}>
                      {m.confidence_band}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={RISK_VARIANT[m.risk_band] ?? 'low'}>
                      {m.risk_band}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                    {m.merge_confidence !== null
                      ? (m.merge_confidence * 100).toFixed(1) + '%'
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(m.last_seen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
