const API_BASE = (import.meta.env['VITE_API_BASE'] as string | undefined) ?? 'http://localhost:3000';
const API_KEY = (import.meta.env['VITE_API_KEY'] as string | undefined) ?? '';

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-api-key': API_KEY };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

// Error carrying the HTTP status, so callers can distinguish 401 (not signed in)
// from real failures.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Admin management API. Uses cookie auth (credentials: 'include') rather than the
// build-time project key — the session cookie is set by POST /admin/login.
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface AdminUser {
  email: string;
}

export interface AdminProject {
  id: string;
  name: string;
  key_prefix: string | null;
  created_at: string;
}

// Returns the signed-in admin, or null if there's no valid session (401).
export async function adminMe(): Promise<AdminUser | null> {
  try {
    return await adminFetch<AdminUser>('/admin/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function adminLogin(email: string, password: string): Promise<AdminUser> {
  return adminFetch('/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function adminLogout(): Promise<{ ok: boolean }> {
  return adminFetch('/admin/logout', { method: 'POST' });
}

export function listProjects(): Promise<{ projects: AdminProject[] }> {
  return adminFetch('/admin/projects');
}

export function createProject(name: string): Promise<{ project: AdminProject; apiKey: string }> {
  return adminFetch('/admin/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

export function rotateProjectKey(id: string): Promise<{ apiKey: string }> {
  return adminFetch(`/admin/projects/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return adminFetch(`/admin/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Types mirroring server responses

export interface Identity {
  id: string;
  first_seen: string;
  last_seen: string;
  confidence_band: 'confirmed' | 'probable' | 'uncertain' | 'unknown';
  risk_band: 'low' | 'medium' | 'high' | 'critical';
  snapshot_count: number;
  cluster_id: string | null;
  riskScore?: number | null;
  riskFlags?: RiskFlag[];
}

export interface RiskFlag {
  code: string;
  label: string;
  reason: string;
  confidence: number;
}

export interface DriftEntry {
  id: string;
  timestamp: string;
  classification: 'minor' | 'moderate' | 'significant' | 'suspicious';
  entropy: number;
  changed_signals: string[];
  added_signals: string[];
  removed_signals: string[];
  before_snapshot_id: string;
  after_snapshot_id: string;
}

export interface Cluster {
  id: string;
  created_at: string;
  reason: string;
}

export interface ClusterMember {
  id: string;
  first_seen: string;
  last_seen: string;
  confidence_band: string;
  risk_band: string;
  snapshot_count: number;
  merge_confidence: number | null;
  merge_reason: string | null;
}

// An application account ID linked to one Scent identity.
export interface AccountLink {
  account_id: string;
  first_linked_at: string;
  last_linked_at: string;
  link_count: number;
}

// A Scent identity linked to one application account (reverse lookup).
export interface LinkedIdentity {
  identity_id: string;
  first_linked_at: string;
  last_linked_at: string;
  link_count: number;
  confidence_band: string;
  risk_band: string;
  snapshot_count: number;
}

// One identity (device) shared across multiple accounts — a fraud cluster.
export interface AccountCluster {
  identity_id: string;
  account_count: number;
  total_links: number;
  first_linked_at: string;
  last_linked_at: string;
  risk_band: 'low' | 'medium' | 'high' | 'critical';
  confidence_band: string;
  account_ids: string[];
}

export interface DashboardData {
  totalIdentities: number;
  newToday: number;
  highRiskCount: number;
  avgConfidenceBand: string;
  riskDistribution: { band: string; count: number }[];
  driftRateTrend: { date: string; count: number }[];
}

// API functions

export function fetchDashboard(): Promise<DashboardData> {
  return get('/v1/dashboard');
}

export function fetchIdentities(params: {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
}): Promise<{ identities: Identity[]; total: number; page: number; limit: number }> {
  const sp = new URLSearchParams();
  if (params.page) sp.set('page', String(params.page));
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.sort) sp.set('sort', params.sort);
  if (params.order) sp.set('order', params.order);
  if (params.q) sp.set('q', params.q);
  return get(`/v1/identities?${sp.toString()}`);
}

export function fetchIdentity(id: string): Promise<Identity> {
  return get(`/v1/identity/${encodeURIComponent(id)}`);
}

export function fetchTimeline(id: string): Promise<{ drifts: DriftEntry[] }> {
  return get(`/v1/identity/${encodeURIComponent(id)}/timeline`);
}

export function fetchSignals(id: string): Promise<{ signals: Record<string, unknown>; asOf: string }> {
  return get(`/v1/identity/${encodeURIComponent(id)}/signals`);
}

export function fetchCluster(id: string): Promise<{ cluster: Cluster; members: ClusterMember[] }> {
  return get(`/v1/clusters/${encodeURIComponent(id)}`);
}

export function fetchAccountLinks(id: string): Promise<{ identityId: string; accounts: AccountLink[] }> {
  return get(`/v1/identity/${encodeURIComponent(id)}/accounts`);
}

export function fetchIdentitiesForAccount(
  accountId: string,
): Promise<{ accountId: string; identities: LinkedIdentity[] }> {
  return get(`/v1/account/${encodeURIComponent(accountId)}/identities`);
}

export function fetchAccountClusters(min = 2): Promise<{ minAccounts: number; clusters: AccountCluster[] }> {
  return get(`/v1/accounts/clusters?min=${min}`);
}
