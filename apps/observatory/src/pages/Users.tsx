import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Copy, Check, X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  listUsers,
  inviteUser,
  updateUser,
  deleteInvite,
  listProjects,
  listUserProjects,
  grantMembership,
  revokeMembership,
  getSettings,
  setRequireTwoFactor,
  type AdminAccount,
  type AdminRole,
} from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.js';
import { Button } from '../components/ui/button.js';
import { Badge } from '../components/ui/badge.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { formatDate } from '../lib/utils.js';

// Build the copy-paste accept link from the SPA's own origin — the server only returns
// the raw token, so no server-side origin config is needed.
function acceptLink(token: string): string {
  return `${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`;
}

function InviteLinkPanel({ link, onDismiss }: { link: string; onDismiss: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-amber-400">Invite link</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send this to the invitee. It is shown once and expires in 7 days.
          </p>
          <code className="mt-2 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
            {link}
          </code>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <Button size="sm" variant="outline" className="mt-3" onClick={copy}>
        {copied ? <Check size={13} className="mr-1.5" /> : <Copy size={13} className="mr-1.5" />}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}

// Per-member project access: every project with a role selector (none/viewer/admin).
function ProjectAccess({ userId }: { userId: string }): React.ReactElement {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['admin-projects'], queryFn: listProjects });
  const memberships = useQuery({ queryKey: ['user-projects', userId], queryFn: () => listUserProjects(userId) });

  const roleOf = (projectId: string): 'none' | 'admin' | 'viewer' =>
    memberships.data?.memberships.find((m) => m.project_id === projectId)?.role ?? 'none';

  const setAccess = useMutation({
    mutationFn: async ({ projectId, role }: { projectId: string; role: 'none' | 'admin' | 'viewer' }): Promise<void> => {
      if (role === 'none') await revokeMembership(userId, projectId);
      else await grantMembership(userId, projectId, role);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-projects', userId] }),
  });

  if (projects.isLoading || memberships.isLoading) {
    return <Skeleton className="h-8 w-full" />;
  }
  const list = projects.data?.projects ?? [];
  if (list.length === 0) {
    return <p className="text-xs text-muted-foreground">No projects yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Project access</p>
      {list.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{p.name}</span>
          <select
            value={roleOf(p.id)}
            disabled={setAccess.isPending}
            onChange={(e) => setAccess.mutate({ projectId: p.id, role: e.target.value as 'none' | 'admin' | 'viewer' })}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="none">No access</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// Owner toggle for the install-wide 2FA requirement.
function Require2faToggle(): React.ReactElement {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (value: boolean) => setRequireTwoFactor(value),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Could not update'),
  });
  const on = data?.require_2fa ?? false;
  return (
    <div className="rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={on}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate(e.target.checked)}
        />
        Require two-factor authentication for all admins
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        When on, admins without 2FA are funneled into setup before they can do anything else.
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Users(): React.ReactElement {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: listUsers });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('member');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['admin-users'] });
  const fail = (e: unknown): void => setError(e instanceof Error ? e.message : 'Something went wrong');

  const invite = useMutation({
    mutationFn: () => inviteUser(email.trim().toLowerCase(), role),
    onSuccess: async (res) => {
      setLink(acceptLink(res.token));
      setEmail('');
      setError(null);
      await invalidate();
    },
    onError: fail,
  });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: AdminRole; is_active?: boolean }) => updateUser(id, body),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: fail,
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => deleteInvite(id),
    onSuccess: invalidate,
    onError: fail,
  });

  const users = data?.users ?? [];
  const invites = data?.invites ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Users</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Invite admins, set roles, grant per-project access, and deactivate accounts.
        </p>
      </div>

      <Require2faToggle />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite.mutate();
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="invitee@example.com"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          className="rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </select>
        <Button type="submit" disabled={!email.trim() || invite.isPending}>
          <UserPlus size={15} className="mr-1.5" />
          Invite
        </Button>
      </form>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {link && <InviteLinkPanel link={link} onDismiss={() => setLink(null)} />}

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending invites</p>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm text-foreground">
                {inv.email} <span className="text-xs text-muted-foreground">· {inv.role}</span>
              </span>
              <button
                onClick={() => revokeInvite.mutate(inv.id)}
                disabled={revokeInvite.isPending}
                className="text-xs text-muted-foreground hover:text-red-400"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Users */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left">
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">User</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">2FA</th>
              <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last login</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-4"><Skeleton className="h-5 w-full" /></td></tr>
            )}
            {users.map((u: AdminAccount) => {
              const isSelf = u.id === me?.id;
              const isMember = u.role === 'member';
              return (
                <tr key={u.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3 text-foreground">
                    <div className="flex items-center gap-1.5">
                      {isMember && (
                        <button
                          onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Toggle project access"
                        >
                          {expanded === u.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      {u.email}
                      {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                    </div>
                    {isMember && expanded === u.id && (
                      <div className="mt-3 rounded-md border border-border bg-card p-3">
                        <ProjectAccess userId={u.id} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={isSelf || patch.isPending}
                      onChange={(e) => patch.mutate({ id: u.id, role: e.target.value as AdminRole })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      <option value="member">member</option>
                      <option value="owner">owner</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.is_active ? 'confirmed' : 'unknown'}>{u.is_active ? 'active' : 'disabled'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.totp_enabled ? 'confirmed' : 'unknown'}>{u.totp_enabled ? 'on' : 'off'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.last_login_at ? formatDate(u.last_login_at) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {!isSelf && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={patch.isPending}
                        onClick={() => {
                          const verb = u.is_active ? 'Deactivate' : 'Reactivate';
                          if (window.confirm(`${verb} ${u.email}?`)) {
                            patch.mutate({ id: u.id, is_active: !u.is_active });
                          }
                        }}
                      >
                        {u.is_active ? <Trash2 size={13} className="mr-1.5 text-red-400" /> : null}
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
