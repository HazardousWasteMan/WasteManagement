# Dispute Scoping by Resolved-Field Key — Design

**Status:** Approved for planning
**Branch:** `vedlegg-citation-and-followups` (item 4 of 4 disclosed follow-ups from [PR #1](https://github.com/HazardousWasteMan/WasteManagement/pull/1), following items 2 and 3)
**Builds on:** the compliance trust/dispute model (`lib/compliance/corrections.ts`, `lib/compliance/resolve-legal-citations.ts`), and every `RESOLVED_FIELDS` entry added since.

## Purpose

`CorrectionStore.hasUnresolved(paragraphId)` scopes an unresolved dispute to a single paragraph, full stop. This was correct when only one field cited any given paragraph. It stopped being correct once `RESOLVED_FIELDS` grew multiple *different* keys that happen to cite the *same* paragraph — e.g. § 9-6 is cited both by `"deponi-category-basis"` (Checkbox1/2/3/4/6, landfill category) and `"hazard-indeterminate-basis"` (the same checkboxes' indeterminate-state branch). A dispute raised because a reviewer thinks § 9-6 doesn't support one of those two contexts currently also marks the *other*, unrelated context disputed — with no way to tell, from the stored record, which context the reviewer actually meant.

**What is NOT the problem:** multiple checkboxes (Checkbox1/2/3/4/6) intentionally sharing ONE `RESOLVED_FIELDS` key's citation is correct, existing, documented behavior — a dispute on that shared citation correctly propagating to all of them is exactly right. This spec only separates disputes across *different keys* that happen to reuse the same paragraph, never within one key's shared citation.

**Real state confirmed before designing:** the `compliance_corrections` table is genuinely empty in production (verified via direct SQL query, 2026-09-06) — zero real disputes have ever been raised. This removes any backward-compatibility concern; the new column can be required from day one, and there is no legacy data to migrate or worry about.

## Design

**1. Schema (`supabase/migrations/`):** a new migration adds `cited_field_key text not null` to `compliance_corrections`, plus an index on `(disputed_paragraph_id, cited_field_key)` (replacing/alongside the existing single-column paragraph index) to keep the now-two-column lookup fast.

**2. `lib/compliance/corrections.ts`:**
- `DisputeRecord` gains `citedFieldKey: string`.
- `CorrectionStore.raise(...)` gains a required `citedFieldKey: string` argument.
- `CorrectionStore.hasUnresolved(paragraphId: string, fieldKey: string): Promise<boolean>` — now an exact match on both columns (no NULL-fallback branch needed, since the column is `NOT NULL` and there is no legacy data).

**3. `lib/compliance/resolve-legal-citations.ts`:** `resolveLegalCitations`'s inner loop already has `field.key` in scope (the outer `RESOLVED_FIELDS` entry being resolved) — thread it into the existing `corrections.hasUnresolved(paragraph.id)` call as a second argument: `corrections.hasUnresolved(paragraph.id, field.key)`. This is the only change needed in this file; the all-or-nothing multi-location resolution logic is untouched.

**4. `lib/bk-skjema/form-map.ts`:** `BkField` gains an optional `legalCitationKey?: string` — the `RESOLVED_FIELDS` key whose citation this field is displaying (e.g. `"deponi-category-basis"`), set alongside every existing `legalCitation:` assignment. Each of the five sites that currently inline a ternary to pick between two keys (Checkbox1/3/4/6) is refactored to compute the key once and derive both `legalCitation` and `legalCitationKey` from it, e.g.:
```typescript
const checkbox1Key = s.isHazardous === null ? "hazard-indeterminate-basis" : "deponi-category-basis";
// ...
legalCitation: s.legalCitations?.[checkbox1Key] ?? null,
legalCitationKey: checkbox1Key,
```
The two single-key sites (Checkbox10 → `"eal-legal-basis"`, TextField38 → `"hp-methodology-basis"`) get a literal `legalCitationKey` string alongside their existing `legalCitation` line — no ternary needed.

**5. Dispute API + UI (`app/api/compliance/disputes/route.ts`, `app/data-lab/page.tsx`'s `handleDispute`):** the request body gains a required `citedFieldKey` string, validated the same way `paragraphId`/`raisedBy`/`reason` already are (400 on missing/wrong-type). `handleDispute` already receives the full `BkField` at its call site (`FieldsPane`'s `onDispute={(reason, raisedBy) => onDispute(f, reason, raisedBy)}`, unchanged) — it reads `field.legalCitationKey` and includes it in the POST body. If `field.legalCitationKey` is somehow absent (a citation with no associated key — should not happen given every citation-bearing field now sets one, but defensively checked), the dispute is refused client-side with a clear error rather than posting an incomplete/guessed key.

## Explicitly disclosed, not solved by this spec

- This only separates disputes ACROSS different `RESOLVED_FIELDS` keys. It does not add any finer-grained scoping WITHIN a key's shared citation (e.g. disputing "just for Checkbox4" while leaving Checkbox1/3/6 undisputed under the same key) — that sharing remains intentional, all-or-nothing, unchanged.
- No UI change surfaces the `citedFieldKey` back to a reviewer browsing past disputes (e.g. an admin dispute-review screen) — this spec only fixes the write/scoping path, not any read-side reporting UI, since none exists yet to extend.

## Testing

- `corrections.ts`: `hasUnresolved(paragraphId, fieldKey)` tested directly against a fake store — a dispute recorded under one field key does not affect a query for the same paragraph under a different field key; a dispute recorded under the same (paragraphId, fieldKey) pair is found.
- `resolve-legal-citations.ts`: a real regression test proving two different `RESOLVED_FIELDS` keys citing the SAME paragraph resolve independently once one has an unresolved dispute scoped to the other key only — the undisputed key's citation shows `disputed: false`, the disputed key's shows `disputed: true`.
- `form-map.ts`: each of the five citation-bearing fields (Checkbox1/3/4/6/10, TextField38) asserted to carry the correct `legalCitationKey` string alongside its existing `legalCitation`.
- The dispute API route: a request missing `citedFieldKey` is rejected with 400, matching the existing validation pattern for the other three required fields.
- Real migration verification: the new column and index confirmed present via direct SQL query against the live Supabase project, same as every prior schema change on this branch.
