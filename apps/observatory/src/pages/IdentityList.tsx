import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { fetchIdentities } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Button } from '../components/ui/button.js';
import { truncateId, formatDate } from '../lib/utils.js';
import type { BadgeProps } from '../components/ui/badge.js';

type SortCol = 'last_seen' | 'first_seen' | 'snapshot_count';

const CONF_VARIANT: Record<string, BadgeProps['variant']> = {
  confirmed: 'confirmed',
  probable: 'probable',
  uncertain: 'uncertain',
  unknown: 'unknown',
};

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
};

function SortButton({
  col, active, dir, onToggle, children,
}: {
  col: SortCol;
  active: boolean;
  dir: 'asc' | 'desc';
  onToggle: (col: SortCol) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => onToggle(col)}
    >
      {children}
      {active ? (
        dir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ChevronDown size={12} className="opacity-30" />
      )}
    </button>
  );
}

export function IdentityList(): React.ReactElement {
  const [sort, setSort] = useState<SortCol>('last_seen');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [inputQ, setInputQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['identities', sort, order, page, q],
    queryFn: () => fetchIdentities({ sort, order, page, limit: 50, q }),
  });

  function toggleSort(col: SortCol): void {
    if (col === sort) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(col);
      setOrder('desc');
      setPage(1);
    }
  }

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Identities</h1>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(inputQ.trim());
            setPage(1);
          }}
        >
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={inputQ}
              onChange={(e) => setInputQ(e.target.value)}
              placeholder="Search by ID…"
              className="h-8 w-56 rounded-md border border-border bg-muted pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
            />
          </div>
          <Button type="submit" size="sm" variant="outline">Search</Button>
          {q && (
            <Button size="sm" variant="ghost" onClick={() => { setQ(''); setInputQ(''); setPage(1); }}>
              Clear
            </Button>
          )}
        </form>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.total.toLocaleString()} identit{data.total === 1 ? 'y' : 'ies'}
          {q ? ` matching "${q}"` : ''}
        </p>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Identity ID</span>
              </th>
              <th className="px-4 py-3 text-left">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confidence</span>
              </th>
              <th className="px-4 py-3 text-left">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk</span>
              </th>
              <th className="px-4 py-3 text-left">
                <SortButton col="last_seen" active={sort === 'last_seen'} dir={order} onToggle={toggleSort}>
                  Last seen
                </SortButton>
              </th>
              <th className="px-4 py-3 text-right">
                <SortButton col="snapshot_count" active={sort === 'snapshot_count'} dir={order} onToggle={toggleSort}>
                  Snapshots
                </SortButton>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {[1, 2, 3, 4, 5].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : data?.identities.map((identity) => (
                  <tr
                    key={identity.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/identities/${identity.id}`}
                        className="font-mono text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
                      >
                        {truncateId(identity.id)}
                      </Link>
                      {identity.cluster_id && (
                        <Link
                          to={`/clusters/${identity.cluster_id}`}
                          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                          title="Part of a cluster"
                        >
                          cluster ↗
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={CONF_VARIANT[identity.confidence_band] ?? 'unknown'}>
                        {identity.confidence_band}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={RISK_VARIANT[identity.risk_band] ?? 'low'}>
                        {identity.risk_band}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(identity.last_seen)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {identity.snapshot_count}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
