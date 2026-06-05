import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import { fetchAccountClusters } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Card, CardContent } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDate } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
};

// The fraud-investigation surface: one row per Scent identity (device) shared
// across two or more application accounts — the multi-account abuse pattern.
export function AccountClusters(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['account-clusters'],
    queryFn: () => fetchAccountClusters(2),
  });

  const clusters = data?.clusters ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Network size={18} className="text-muted-foreground" />
        <h1 className="text-sm font-semibold text-foreground">Account clusters</h1>
      </div>
      <p className="max-w-2xl text-xs text-muted-foreground">
        Devices linked to more than one application account, most-shared first. A single Scent identity
        spanning many accounts is the signature of free-trial abuse and coordinated registration.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No shared-account clusters yet. Clusters appear once a device is linked to two or more accounts
            via <code className="font-mono text-foreground">scent.identify()</code>.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Identity</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Accounts</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Risk</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Linked account IDs</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last linked</th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c) => (
                    <tr key={c.identity_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/identities/${c.identity_id}`}
                          className="font-mono text-sky-400 hover:text-sky-300 break-all"
                        >
                          {c.identity_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground">{c.account_count}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={RISK_VARIANT[c.risk_band] ?? 'low'} className="text-[10px]">
                          {c.risk_band}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground max-w-md truncate">
                        {c.account_ids.join(', ')}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatDate(c.last_linked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
