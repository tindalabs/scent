import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        confirmed: 'bg-emerald-500/15 text-emerald-400',
        probable: 'bg-sky-500/15 text-sky-400',
        uncertain: 'bg-amber-500/15 text-amber-400',
        unknown: 'bg-zinc-500/15 text-zinc-400',
        low: 'bg-emerald-500/15 text-emerald-400',
        medium: 'bg-amber-500/15 text-amber-400',
        high: 'bg-orange-500/15 text-orange-400',
        critical: 'bg-red-500/15 text-red-400',
        minor: 'bg-zinc-500/15 text-zinc-400',
        moderate: 'bg-sky-500/15 text-sky-400',
        significant: 'bg-amber-500/15 text-amber-400',
        suspicious: 'bg-red-500/15 text-red-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
