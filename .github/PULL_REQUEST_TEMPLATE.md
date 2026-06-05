<!--
Thanks for contributing to Scent! Please skim CONTRIBUTING.md first if you
haven't — it covers the pnpm/turbo workflow and the local stack
(docker compose up) for verifying identity resolution end to end.
-->

## Summary

<!-- 1–3 bullets on WHAT changed and WHY. Link the issue if there is one. -->

-

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (no API change)
- [ ] New feature (additive, no breaking changes)
- [ ] Breaking change (consumer code needs updates — call out in summary)
- [ ] Docs / chore (no source changes)
- [ ] Tests / coverage

## Privacy check

<!-- Scent collects fingerprint signals and links anonymous identities to account
     IDs. Account IDs are application-provided opaque strings — never PII. -->

- [ ] No raw PII (emails, names) is logged, stored unhashed, or placed in span attributes / URLs
- [ ] Fingerprint signals stay aggregate — no new signal narrows to a single named person
- [ ] N/A — change doesn't touch signal collection, identity linkage, or persistence

## Test plan

<!-- How did you verify? Reviewers will run the same steps. -->

- [ ] `pnpm test` (must stay green)
- [ ] `pnpm lint`
- [ ] `pnpm type-check`
- [ ] `pnpm build` (clean)
- [ ] Manual verification against the local stack (`docker compose up` + the demo app / Observatory) if runtime behaviour changed
- [ ] New / updated tests cover the change

## Changeset

- [ ] Added a changeset (`pnpm changeset`) if this affects a published package (`scent-sdk`, `scent-engine`, `scent-otel`)
- [ ] N/A — no consumer-facing change (server / Observatory only)

## Notes for reviewers

<!--
API surface changes, DB migrations, perf considerations, subtle behaviour
shifts, follow-up work spun out as separate PRs, etc.
-->
