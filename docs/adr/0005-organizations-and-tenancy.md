# ADR-0005: Organizations are the tenant boundary; owner is org-scoped, not global

**Status:** Accepted
**Date:** 2026-06-20

## Context

Scent's data model was **single-organization, multi-project**: every data row is scoped by
`project_id` (with `ON DELETE CASCADE`), but there was no company/tenant entity *above*
projects, and the admin `owner` role was a **global superuser** — `isOwner` short-circuited
`canViewProject`/`canManageProject` to `true` for any owner on any project (`admin/authz.ts`),
and the `/admin/*` listing queries read across the whole install.

That is exactly right for **self-hosting**: one deployment = one operator, and "projects"
are that operator's own apps/environments. It is **unsafe for a hosted SaaS** with multiple
paying customers on one box (which is what `api.scent.tindalabs.dev` is):

1. **No company boundary** — Company A's owner could read Company B's identities. For an
   identity/fraud product that is a non-starter.
2. **No billing root** — Phase 7 usage metering → Stripe needs a customer entity to meter
   and invoice; projects don't group into a billable company.
3. **No onboarding seam** — "a company signs up → gets a workspace → creates projects" has
   nowhere to hang.

So the hosted box was effectively single-tenant: fine for the first design partner, blocking
before the second.

## Decision

Introduce an **`organizations`** table as the tenant boundary — the unit of isolation today
and the anchor for metering/billing later — and **re-scope the `owner` role from global to
org-scoped**. An owner is a superuser *within its own organization only*.

- `organizations(id, name, slug, require_2fa, created_at)`. `admin_users`, `projects`, and
  `admin_invites` gain an `organization_id` FK.
- **Authz**: `canViewProject`/`canManageProject` gate the owner short-circuit on the project
  belonging to the user's org (`projectInOrg`). Members reach only the projects granted in
  `project_members` (same-org by construction). Every owner-scoped `/admin/*` query filters
  by `organization_id`.
- **No existence leak**: a cross-org project or user id returns **404, not 403** — a tenant
  can't even confirm another tenant's resources exist.
- **2FA policy is per-org** (`organizations.require_2fa`), superseding the install-wide
  `admin_settings.require_2fa`, so one tenant's policy never affects another.
- **Invites carry the inviter's org**, so an accepted account joins that company.
- `organization_id` stays **off the `/v1` data hot path** — a project API key already
  resolves to a `project_id` that fully scopes data. Organizations are an admin/billing
  concern only.

### Provisioning (this iteration)

New orgs are provisioned via the bootstrap CLIs (`create-admin`/`create-project`, optional
`[orgName]`, default `Default`) using a shared idempotent `findOrCreateOrgByName`. **Public
self-serve signup is deliberately deferred** to the billing workstream — it is coupled to
free-tier limits and Stripe, and provisioning orgs without those guardrails invites abuse.

## Why it composes (self-host unaffected)

The rollout mirrors how migration 009 backfilled `role` for existing admins:

- Migration **013** adds the entity + **nullable** FKs and backfills a single `Default` org,
  assigning every existing admin and project to it (seeding `require_2fa` from the
  install-wide setting). A single-org install behaves exactly as before — an owner still
  sees all of *its* projects.
- Migration **014** enforces `organization_id NOT NULL` once every writer (admin routes,
  both CLIs) is org-aware, first bucketing any stragglers into `Default`.

The nullable→backfill→NOT NULL split lets the change ship incrementally with green CI at
each step, and keeps the constraint as a permanent backstop against a tenant-less row.

## Consequences

- The hosted box can safely host a second customer: isolation is enforced in code and at the
  DB level. This is the **foundational prerequisite** for the hosted free tier + metering.
- Metering/Stripe (Phase 7) will anchor on `organizations`.
- **Deferred**: public signup; an Observatory org-management UI (org name/settings, switcher);
  a Tindalabs-ops platform-superadmin concept (kept out of customer RBAC by design).

Relates to [ADR-0004](0004-consent-and-data-lifecycle.md) (data-isolation guarantees) and the
BSL "Tindalabs-hosted only" commercial model.
