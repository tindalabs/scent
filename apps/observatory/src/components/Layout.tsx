import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, GitBranch, Network, KeyRound, UserCog, CircleUser, LogOut } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useProjects } from '../contexts/ProjectContext.js';

const baseNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/identities', label: 'Identities', icon: Users, end: false },
  { to: '/accounts', label: 'Account clusters', icon: Network, end: false },
  { to: '/settings', label: 'API keys', icon: KeyRound, end: false },
];

export function Layout(): React.ReactElement {
  const { user, logout } = useAuth();
  const { projects, activeId, setActive } = useProjects();
  const navigate = useNavigate();

  // Users management is owner-only; Account is for everyone.
  const nav = [
    ...baseNav,
    ...(user?.role === 'owner' ? [{ to: '/users', label: 'Users', icon: UserCog, end: false }] : []),
    { to: '/account', label: 'Account', icon: CircleUser, end: false },
  ];

  async function onLogout(): Promise<void> {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold tracking-wide text-foreground">
            Scent <span className="text-muted-foreground font-normal">Observatory</span>
          </span>
        </div>
        {/* Project switcher — scopes every data page to the chosen project. Hidden
            until at least one project exists (operator is sent to API keys first). */}
        {projects.length > 0 && (
          <div className="px-3 pt-3">
            <label htmlFor="project-switcher" className="sr-only">
              Active project
            </label>
            <select
              id="project-switcher"
              value={activeId ?? ''}
              onChange={(e) => setActive(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
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
        <div className="border-t border-border px-3 py-3 space-y-2">
          {user && <p className="px-2 text-xs text-muted-foreground truncate" title={user.email}>{user.email}</p>}
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut size={15} />
            Sign out
          </button>
          <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            <GitBranch size={11} /> Phase 8
          </span>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
