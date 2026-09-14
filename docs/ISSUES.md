# Known Issues

Real, confirmed gaps that are deliberately not being fixed right now — tracked here instead of
being built speculatively or forgotten. Each entry says what the issue is, why it's real, and why
it's deferred rather than fixed immediately.

---

## Voyage embeddings: no handling for the free-tier rate limit

**Where:** `lib/compliance/embeddings.ts`'s `embedText`, called from `scripts/seed-lovdata.ts`
whenever a new legal paragraph is seeded.

**What happens today:** `embedText` makes one request to Voyage's embeddings endpoint and throws
immediately on any non-OK response, including a 429. This has been hit for real twice on the
`compliance`/`vedlegg-citation-and-followups` branches (once seeding § 11-2, once seeding
Vedlegg 2) and worked around by hand each time (a manual ~30 second wait, then re-running).

**Why it's not just a retry-with-delay fix:** the account is on Voyage's free plan, which caps
usage by a request/token quota over a time window, not a plain requests-per-second throttle.
Retrying with a fixed delay assumes the limit clears on a short backoff — for a quota-style cap,
blind retries could just keep failing (or waste remaining quota) until the actual reset window
passes, which may be much longer than 30 seconds. A real fix needs to know the actual shape of
Voyage's free-tier limit (request count? token count? reset window length?) before building
retry/backoff logic around it — not guessed.

**Deferred until:** the real rate-limit shape is confirmed (e.g. from Voyage's own docs/dashboard,
or a real response header if one turns out to carry reset-time info) — see the abandoned design
at `docs/superpowers/specs/2026-09-06-voyage-rate-limit-retry-design.md` for the retry-shaped
approach that was scoped and then correctly rejected in favor of this tracking entry.

**Current workaround:** if `npx tsx scripts/seed-lovdata.ts` hits a 429, wait ~30 seconds and
re-run it — it's idempotent (skips any location already cached), so re-running is safe.
