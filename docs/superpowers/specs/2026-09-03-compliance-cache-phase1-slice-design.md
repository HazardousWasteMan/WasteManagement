# Compliance Cache — Phase 1 Seed Slice Design

**Status:** Approved for planning
**Branch:** `compliance`

## Purpose

Prove the full "cached brain" growth mechanism — described in the user-provided architecture
below — end-to-end on a single real document, before scaling to the full seed corpus or adding
a second legal source. This is the first implementation slice of Phase 1 (Lovdata + EUR-Lex,
no authentication required); Phase 2 (Avfallsdeklarering/Maskinporten) is out of scope entirely
and covered by a future spec.

**This slice produces a proof of mechanism, not production data.** The single seeded paragraph
(Avfallsforskriften) has NOT gone through the legal/domain review the parent architecture (§10)
requires before any cached paragraph can be trusted for a real compliance decision. Nothing
written by this slice should be used to fill a real BK-skjema field until that review has
happened and the paragraph's `verification_status` reflects it.

## Full architecture (reference, provided and confirmed by the user)

> Everything filled in must be traceable back to a specific paragraph, a specific version, and
> a specific link a reviewer can click. No line in a completed compliance form may exist without
> a `cited_paragraph_id` pointing to an actual cache row.

Sources: Lovdata (`api.lovdata.no`, REST, public, NLOD 2.0), EUR-Lex/CELLAR (SPARQL, public,
60s query timeout, base vs. consolidated CELEX), EØS-notatbasen (EEA incorporation status,
manual/scraping), Avfallsdeklarering (Miljødirektoratet, Maskinporten-authenticated — Phase 2).

Flow: document → agent extracts waste data → deterministic classification → structured query →
cache search (hybrid vector+keyword, filtered on jurisdiction + `in_force`) → hit-fresh (use
directly) / hit-stale (force re-verification) / miss (live adapter lookup → normalize → write to
cache) → fill compliance form (grounded answers only) → human sign-off on first use of a new
paragraph → freeze the form with the exact paragraph version used.

Cache schema (per-paragraph row): `id`, `source` (`no`|`eu`), `jurisdiction_applies`,
`base_celex`/`consolidated_celex`/`consolidation_date`/`eli_uri` (EU only), `article`,
`paragraph`, `text`, `embedding`, `in_force`, `eos_incorporation_status` (EU only),
`last_verified_at`, `last_changed_at`, `verification_status`
(`current`|`updated`|`needs_reverification`), `amended_by`, `previous_version_id`,
`human_signed_off`, `source_link`.

Write logic: brand-new paragraph → insert+embed+log(+EEA check if EU); unchanged, re-verified →
bump `last_verified_at` only, no re-embed; content actually changed → archive previous version,
write new version, re-embed, flag affected earlier form drafts, log the change; amendment →
update `amended_by`.

Grounding contract: confidence tiers `grounded_high` (direct fresh hit, auto-fill),
`grounded_stale` (hit past age threshold, force re-verification before use), `derived` (agent's
interpretation across multiple paragraphs, kept visually/structurally separate from quotes),
`no_match` (explicit "manual review required" flag, never a silently empty field).

Freeze mechanism: on form submission, store an immutable copy of every `cited_paragraph_id`
used, the full paragraph text at fill-out time, `last_verified_at` at fill-out time, and
`source_link` — so the cache can keep updating without altering the history of already-submitted
forms.

Full phasing (§13 of the original architecture): Phase 1 = full legal-text chain (seed corpus,
cache schema, hybrid RAG, grounding contract, versioned linking, sign-off, freeze) using only
Lovdata + EUR-Lex, no auth required; Maskinporten registration starts in parallel administratively
but does not block dev. Phase 2 = classification module via the authenticated Avfallsdeklarering
API. Phase 3 = combined flow linking Phase 1 legal grounding to Phase 2 classification. v1 waste
scope: hazardous waste + oil/gas waste.

## This slice's scope

**In scope:**
1. Supabase Postgres schema: `legal_paragraphs` (per the cache schema above, `source: "no"` only
   for this slice) with a `pgvector` embedding column, and `compliance_form_freezes`
   (append-only, dedicated table) for the freeze mechanism.
2. `LegalSource` adapter interface (`lib/compliance/sources/legal-source.ts`) with one real
   implementation, `LovdataSource`, fetching Avfallsforskriften.
3. Seeding script (`scripts/seed-lovdata.ts`): fetch → chunk per paragraph → embed via Voyage
   AI (`voyage-multilingual-2`, or whatever multilingual model is current at implementation
   time) → insert rows with `verification_status: "current"`.
4. Hybrid search + **cache-miss live-fallback** (`lib/compliance/search.ts`): vector + keyword
   search filtered by jurisdiction + `in_force`, returning a grounding tier. On a genuine
   `no_match`, the same function calls `LovdataSource` live, normalizes the result, writes it to
   `legal_paragraphs` per the §5 insert path, then re-searches so the caller gets a real result
   in one call. Both the cache-hit path and the miss→live-fetch→write-back path are exercised by
   the slice's tests — this is the actual growth mechanism the architecture is built around, not
   an optional extra.
5. One real grounded form field, reusing an existing BK-skjema field (the waste-code/EAL legal
   basis field) rather than inventing a new form — so the slice plugs into something real instead
   of a synthetic target.
6. Freeze-on-submit (`lib/compliance/freeze.ts`): writes the immutable copy to
   `compliance_form_freezes` per §8 when that one field is confirmed.

**Acceptance test — freeze integrity** (the test that actually proves §8 works, not just that
the table exists): seed one paragraph → fill and freeze a form field against it → directly mutate
that paragraph's cached text (simulating a later legal change) → assert the frozen form record
still returns the original text and version, unaffected by the mutation.

**Explicitly deferred, not part of this slice:**
- EUR-Lex/CELLAR adapter and SPARQL handling
- EEA incorporation status logic (`eos_incorporation_status`)
- The weekly maintenance/re-verification job (§11)
- Human sign-off UI/workflow (§7) — the `human_signed_off` column exists in schema but nothing
  writes true to it yet
- Full seed corpus beyond one document
- Avfallsdeklarering API / Maskinporten (Phase 2 entirely)

## Technical decisions

- **Storage:** Supabase Postgres with the `pgvector` extension — chosen so vector search and
  relational/metadata filtering (jurisdiction, `in_force`, staleness) stay in one query, and to
  reuse the Supabase MCP already available in this environment for provisioning/migrations.
- **Embeddings:** Voyage AI, multilingual model (`voyage-multilingual-2` at time of writing) —
  Anthropic's recommended embeddings partner, built for mixed Norwegian/English text in one
  vector space. The schema's `embedding` column dimension must be set to the model's real,
  current output dimension — checked against Voyage's docs at implementation time, not assumed.
- **Search:** hybrid vector + keyword, combined via reciprocal rank fusion, matching the parent
  architecture's §12 stack choice.

## Testing

- Unit tests for `LovdataSource` (adapter contract, normalization to the common schema).
- Unit tests for `search()` covering all four grounding-tier outcomes, including the miss→live
  fetch→write-back path (mocked adapter for determinism).
- The freeze-integrity acceptance test described above (integration-level, against a real or
  local Supabase instance).
- `vitest run` and `next build` must pass, matching this repo's existing verification standard.
