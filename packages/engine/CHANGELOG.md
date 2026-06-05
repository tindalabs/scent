# @tindalabs/scent-engine

## 0.1.0

### Minor Changes

- 8c0753e: First public release (0.1.0).

  Phase 8 — Account Linking & Entity Graph: `scent.identify(accountId)` links an
  anonymous Scent identity to an application account ID. The server exposes
  `GET /v1/account/:id/identities` (the fraud-detection query) and flags
  `coordinated_accounts` when one device links to three or more distinct accounts
  within a rolling 30-day window. The Observatory gains a per-identity "Linked
  accounts" panel and an "Account clusters" view for fraud investigation.
