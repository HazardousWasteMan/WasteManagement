# Voyage Rate-Limit Retry — Design

**Status:** SUPERSEDED — not implemented. The user correctly pointed out this account is on
Voyage's free plan, capped by a usage quota (request/token count over a window), not a plain
requests-per-second throttle — retrying with a fixed delay assumes the wrong kind of limit and
could just fail repeatedly (or waste quota) rather than actually help. Tracked instead as a known
issue at `docs/ISSUES.md`, to be revisited once the real limit shape is confirmed. Kept here only
as a record of the retry-shaped approach that was considered and rejected.
**Branch:** `vedlegg-citation-and-followups` (third of three follow-on items this cycle — RLS done, Checkbox9/10 done, this last one — from PR #1's disclosed follow-ups)
**Builds on:** `lib/compliance/embeddings.ts`'s `embedText`, which every real seeding step on this branch (including this cycle's own § 11-2 and Vedlegg 2 seeding) has called against the live Voyage API.

## Purpose

`embedText` makes one real HTTP call to Voyage's embeddings endpoint and throws immediately on any non-OK response. During this cycle's own real seeding (item 2, Vedlegg 2), a genuine HTTP 429 rate-limit was hit and worked around ad-hoc (a manual 30-second delay before retrying by hand) rather than handled in the committed code — flagged at the time as a real, disclosed follow-up. This is the second time on this branch a real Voyage 429 has been hit and worked around manually (the first during item 2's own § 11-2 cycle before that).

## Design

**Where the fix lives (confirmed with the user):** inside `embedText` itself (`lib/compliance/embeddings.ts`), not just in `scripts/seed-lovdata.ts`'s calling loop — `embedText` is the thing that actually makes the HTTP call and knows the real status code, so fixing it there benefits every real caller, not only the seed script.

**Retry behavior:**
- Retries ONLY on HTTP 429 — every other non-OK status (401, 500, etc.) throws immediately, unchanged from today. A 429 is a real, transient rate-limit; anything else is a real failure that retrying won't fix.
- Up to 2 retries (3 attempts total), waiting a fixed 30 seconds between attempts — the real, empirically-confirmed delay from this branch's own manual workaround, not a guessed value.
- No `Retry-After` header parsing — not confirmed that Voyage's API sends one, so this doesn't assume a header that may not exist. The fixed 30-second delay is used regardless.
- If all 3 attempts return 429, throws the same existing clear error (`Voyage embeddings request failed: HTTP 429 — ...`) it already throws today — no new error message needed, since the final failure genuinely is that status.
- The 30-second delay is real wall-clock time in production, but the implementation must accept an injectable delay function (or equivalent seam) so tests can verify retry behavior without actually waiting 30 seconds ×2 per test run.

## Explicitly disclosed, not solved by this spec

- No exponential backoff — a fixed 30-second delay for every retry, matching the one real data point this branch has (a single manual 30-second wait resolved the real 429 encountered). If Voyage's actual rate-limit window turns out to need a longer wait in some future case, that's a real, separate tuning decision for when it's actually observed, not guessed at now.
- This does not add retry logic to any other external call in this codebase (Lovdata's archive download, Supabase calls) — scoped specifically to the Voyage embeddings call, the one that has actually hit a real rate limit twice.

## Testing

- A test proving a single 429 followed by a 200 succeeds and returns the real embedding, without throwing.
- A test proving 3 consecutive 429s exhausts all retries and throws the existing clear error message.
- A regression test proving a non-429 error (e.g. 500) throws immediately, with `fetch` called exactly once (no retry attempted).
- All three retry-related tests use an injected/mocked delay, not a real 30-second wait, so the suite stays fast — the existing three tests in `tests/compliance/embeddings.test.ts` (success, non-OK-throws, missing-API-key-throws) continue to pass unchanged.
