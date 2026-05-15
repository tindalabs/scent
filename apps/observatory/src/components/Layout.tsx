import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, GitBranch } from 'lucide-react';
import { cn } from '../lib/utils.js';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/identities', label: 'Identities', icon: Users, end: false },
];

export function Layout(): React.ReactElement {
  return (
    <div className="flex min-h-screen">
      <aside className="w-52 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold tracking-wide text-foreground">
            Scent <span className="text-muted-foreground font-normal">Observatory</span>
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <GitBranch size={11} /> Phase 4
          </span>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
