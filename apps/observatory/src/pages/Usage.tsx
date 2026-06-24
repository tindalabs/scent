import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { getUsage } from '../lib/api.js';
import { Skeleton } from '../components/ui/skeleton.js';

// "2026-06-01" -> "Jun 2026" (rendered in UTC to match the server's period boundary).
function formatMonth(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const fmt = (n: number): string => n.toLocaleString();

export function Usage(): React.ReactElement {
  const { data, isLoading } = useQuery({ queryKey: ['admin-usage'], queryFn: getUsage });

  const limit = data?.limit ?? null;
  const used = data?.resolutionsThisPeriod ?? 0;
  const pct = data?.pctUsed != null ? data.pctUsed : null;
  const pctClamped = pct != null ? Math.min(100, Math.round(pct * 100)) : null;
  const barColor = pct == null ? 'bg-emerald-500' : pct >= 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Usage</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Identity resolutions for the current billing period (UTC calendar month).
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">This period</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {fmt(used)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {limit != null ? `/ ${fmt(limit)} resolutions` : 'resolutions'}
                </span>
              </p>
            </div>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs capitalize text-muted-foreground">
              {data?.plan ?? 'free'} plan
            </span>
          </div>

          {limit != null ? (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pctClamped ?? 0}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {pctClamped}% used
                {pct != null && pct >= 1 && (
                  <span className="ml-1 text-red-400">— over the soft limit (still serving)</span>
                )}
                {pct != null && pct >= 0.8 && pct < 1 && (
                  <span className="ml-1 text-amber-400">— approaching the limit</span>
                )}
              </p>
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge size={12} /> Unlimited — no monthly quota set for this organization.
            </p>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Recent months</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-left">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Month</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Resolutions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={2} className="px-4 py-4">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              )}
              {!isLoading && (data?.history.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No usage recorded yet.
                  </td>
                </tr>
              )}
              {data?.history.map((h) => (
                <tr key={h.periodStart} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{formatMonth(h.periodStart)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fmt(h.resolutions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Gauge size={12} /> One resolution = one processed identity observation. Limits are soft — exceeding
        them never blocks traffic.
      </p>
    </div>
  );
}
