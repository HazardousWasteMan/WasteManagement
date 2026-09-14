# Vedlegg/Annex Addressing — Design

**Status:** Approved for planning
**Branch:** `vedlegg-citation-and-followups` (branched from `compliance`, which is currently open as [PR #1](https://github.com/HazardousWasteMan/WasteManagement/pull/1))
**Builds on:** the compliance-cache/citation pipeline (`lib/compliance/*`), and the § 11-2 methodology citation (`hp-methodology-basis` in `lib/compliance/resolve-legal-citations.ts`, attached to `TextField38` in `lib/bk-skjema/form-map.ts`).

## Purpose

`LovdataSource`'s paragraph parser only knows how to address a regulation's numbered provisions via `data-name="§<article>-<paragraph>"` anchors — it cannot address a Vedlegg (annex) section at all. This blocks citing the actual HP1-15 criteria table (Avfallsforskriften kap. 11, Vedlegg 2), which § 11-2 references but does not itself contain — today's `hp-methodology-basis` citation grounds "where this rule comes from" (§ 11-2) but not the literal threshold table the rule points to.

This gap was logged in memory (`lovdata-vedlegg-addressing-gap.md`) during the § 11-2 work and is closed here with real, verified research — not the memory note's original assumption. Real archive inspection (downloading and extracting the live `gjeldende-sentrale-forskrifter.tar.bz2`, 2026-09-06) confirms:

- Vedlegg sections use `data-name="vedlegg1"/"vedlegg2"/.../"vedlegg4"` (arabic numerals) or `data-name="vedleggI"/"vedleggII"/.../"vedleggXIII"` (roman numerals), depending on which chapter it belongs to.
- **Every label recurs across multiple, unrelated chapters** — e.g. `data-name="vedlegg2"` appears under chapters 1, 4, and 14 with completely different content; `data-name="vedleggII"` appears under chapters 7, 9, 12, and 22.
- The real, confirmed disambiguator: each Vedlegg's wrapping `<section class="section" data-name="..." id="...">` element's `id` attribute always starts with `kapittel-<internal-chapter-number>-`, using the SAME archive-internal chapter numbering already known to be offset from the human-facing chapter label (kap. 9 human → internal chapter `11`; kap. 11 human → internal chapter `14` — both independently confirmed this session by direct inspection, not carried over from the memory note's assumption).
- **The specific paragraph this item exists to unblock — kap. 11's Vedlegg 2, "Kriterier som gjør avfall til farlig avfall"** (`id="kapittel-14-kapittel-2"`) — is real, fetchable, and contains the actual HP1-15 threshold text § 11-2(b) references. Its body is a flat `<article class="legalP">` structure, the same shape an ordinary paragraph body already uses — no new parsing primitive is needed once the section is located, only new location-finding logic.
- The real body text is large: confirmed ~54KB for kap. 11's Vedlegg 2 specifically (it contains the HP1-HP15 threshold tables). This is disclosed as a real risk below, not solved speculatively.

## Design

**Addressing convention — reuse the existing `{documentId, article, paragraph}` shape, unchanged.** A Vedlegg location is represented as `article: "<human chapter number>"`, `paragraph: "vedlegg-<label>"` (e.g. `article: "11", paragraph: "vedlegg-2"`) — a naming convention layered onto the existing fields, not a new field. This means the paragraph store schema, `lib/compliance/search.ts`, `lib/compliance/resolve-legal-citations.ts`'s `ResolvedFieldLocation` type, and `scripts/seed-lovdata.ts`'s location-list shape all need **zero structural changes** — they already just carry article/paragraph strings through to `LovdataSource.fetchParagraph`. Only the parsing layer (`lovdata-archive.ts`) and the citation-label formatter (`lib/compliance/citation-view.ts`) need new logic.

**Parsing (`lib/compliance/sources/lovdata-archive.ts`):**
- A new, deliberately small map, seeded only with the two entries this session has directly confirmed by archive inspection — never a guessed/generic mapping for chapters not yet verified:
  ```typescript
  // Archive-internal chapter numbering is offset from the human-facing chapter label (same
  // quirk already known for §-paragraph ids, e.g. § 9-6's real internal id is
  // kapittel-11-paragraf-6). Confirmed by direct inspection of the real archive — extend only
  // after confirming a new chapter's real internal id the same way, never guess.
  const CHAPTER_INTERNAL_ID: Record<string, string> = {
    "9": "11",
    "11": "14",
  };
  ```
- A new `parseVedleggFromHtml(html: string, internalChapterId: string, vedleggLabel: string): ParagraphResult | null` function: locates `data-name="vedlegg${vedleggLabel}"` whose enclosing `id` attribute starts with `kapittel-${internalChapterId}-`, extracts from that `<section>`'s opening tag forward until the next `<section class="section"` tag whose `id` does **not** start with the found section's own `id` as a prefix — this correctly stops at the true end of the vedlegg (the next unrelated top-level section) rather than at a nested subsection belonging to the same vedlegg (a real, confirmed structural case: kap. 1's Vedlegg 2 nests a `<section class="section" data-name="delA" id="kapittel-1-kapittel-11-kapittel-1"...>` inside itself). If no `data-name="vedlegg${vedleggLabel}"` occurrence has a matching `id` prefix, return `null` — never fabricate.
- `getParagraphFromArchive` routes to `parseVedleggFromHtml` (via the confirmed `CHAPTER_INTERNAL_ID` lookup) when `query.paragraph` starts with `"vedlegg-"`, and to the existing `parseParagraphFromHtml` otherwise — unchanged for every existing `§`-addressed location.
- `LegalParagraph.article`/`.paragraph` (and the `no-avfallsforskriften-<article>-<paragraph>` id convention) carry the vedlegg's human chapter and `"vedlegg-2"` string exactly as any other location — no schema change.

**Citation label (`lib/compliance/citation-view.ts`):** `buildSingleCitation` special-cases a `paragraph` value starting with `"vedlegg-"` to render `"${docLabel} Vedlegg ${label}"` (e.g. `"Avfallsforskriften Vedlegg 2"`) instead of the normal `"§ ${article}-${paragraph}"` format, which would otherwise render the nonsensical `"§ 11-vedlegg-2"`.

**Field wiring:** the existing `"hp-methodology-basis"` entry in `RESOLVED_FIELDS` (already resolved and attached to `TextField38`) gains a second location — `{documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2", queryText: "kriterier som gjør avfall til farlig avfall HP1-HP15"}` — alongside the existing § 11-2 location. § 11-2 stays `primary: true` (the foundational reference); Vedlegg 2 is the supporting criteria-table citation. Resolution stays all-or-nothing across both locations, matching the existing contract (and the § 9-5+§ 9-6 precedent) — if either paragraph fails to resolve, `hp-methodology-basis` degrades to `null` for that request, same safety guarantee as today.

## Explicitly disclosed, not solved by this spec

- **Vedlegg 2's real body text is ~54KB** — large enough that Voyage's `embedText` call (which has no chunking or truncation logic today) may reject it outright, or behave unpredictably. This is NOT solved speculatively here: the plan's real-seeding step will surface whatever the actual failure mode is (if any) and get fixed with real information, the same way Task 2's real Voyage 429 rate-limiting was handled during the previous cycle. If seeding genuinely fails on size, that becomes a real, scoped follow-up (e.g. storing/embedding only the HP-relevant portion of the vedlegg), not something guessed at now.
- **Subsection-level addressing within a Vedlegg** (e.g. citing specifically "nr. 3, HP 4" rather than the whole Vedlegg 2 text) is out of scope — this spec fetches and caches the Vedlegg as one whole paragraph-shaped blob, the same granularity every existing `§`-paragraph citation already uses. A future refinement could address the nested `kapittel-14-kapittel-2-ledd-N`/`-punkt-N` ids directly if a specific sub-citation is ever needed.
- **Only two chapters' internal ids are confirmed and mapped** (kap. 9 → 11, kap. 11 → 14). Any future Vedlegg citation for a different chapter needs its own real, confirmed mapping entry added the same way — never inferred by pattern from these two.

## Testing

- `parseVedleggFromHtml` unit-tested against hand-written fixture HTML reproducing the real structural shape: a vedlegg with the target label under the correct internal chapter id, a DIFFERENT chapter's section sharing the same vedlegg label (proving disambiguation-by-chapter-id actually discriminates, not just happens to find the first match), and a nested `<section>` inside the target vedlegg (proving the boundary logic does not truncate early at a nested subsection).
- A case where the requested vedlegg label/chapter combination doesn't exist in the fixture, proving `null` is returned rather than a wrong section's content.
- `getParagraphFromArchive` routing tested directly: a `paragraph` starting with `"vedlegg-"` reaches the new function; a normal `paragraph` value reaches the existing one, unchanged.
- `buildSingleCitation`'s label-formatting branch tested directly: a vedlegg-shaped paragraph renders `"Avfallsforskriften Vedlegg 2"`; an ordinary paragraph's label format is unchanged (regression coverage for the existing `§ 11-4`-style cases).
- `resolveLegalCitations`'s all-or-nothing behavior re-tested for the now-two-location `hp-methodology-basis` field, mirroring the existing `deponi-category-basis` two-location test pattern.
- Real seeding: `scripts/seed-lovdata.ts` extended with the new `{article: "11", paragraph: "vedlegg-2"}` location, run against the live Supabase project, and verified present via direct SQL query — same process as every prior location added on this branch.
