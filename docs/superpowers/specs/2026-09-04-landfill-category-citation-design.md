# Landfill Category Citation — Design

**Status:** Approved for planning
**Branch:** `compliance`
**Builds on:** `docs/superpowers/specs/2026-09-04-compliance-trust-model-design.md` and its
implementation plan (all commits through `27dbf19`) — `lib/compliance/*` (search, freeze,
corrections, citation-view, resolve-legal-citations), `LegalCitationBadge`, the dispute route,
and the hoist-once resolution pattern in `app/api/data-lab/route.ts` /
`reclassify/route.ts` are all reused unchanged except where this spec says otherwise.

## Purpose

Extend real, live-verified legal grounding from the one field the trust model currently covers
(Checkbox10 / hazardous-content, § 11-4) to the landfill-category decision (Checkbox1/2/3 —
which of the three landfill categories this waste is classified into). This is the second of
what will be an ongoing series of "ground one more field" extensions; the mechanism itself
(search, freeze, dispute, trust-by-default) does not change.

## Real legal basis (researched, not assumed)

Confirmed via Lovdata (`https://lovdata.no/dokument/LTI/forskrift/2004-06-01-930/KAPITTEL_9`),
Avfallsforskriften Kapittel 9 (Deponering av avfall):

- **§ 9-5** ("Kategorier av deponier") defines the three landfill categories: kategori 1
  (farlig avfall), kategori 2 (ordinært avfall), kategori 3 (inert avfall).
- **§ 9-6** ("Avfall som tillates deponert på de ulike deponikategoriene") is the operative
  acceptance rule — which waste is permitted at each category.

Both are seeded (Phase 1's `LovdataSource`/archive parsing already handles this document; no new
adapter work — just two more `(article, paragraph)` locations against the same real archive).

## Design decisions (from discussion)

1. **`LegalCitationView` becomes multi-paragraph.** Today it's one flat paragraph's data. Change
   its shape to hold a list of citations, so one field can show two (or more) paragraphs
   together:

   ```ts
   export interface SingleCitation {
     paragraphId: string;
     label: string;
     sourceLink: string;
     verifiedAt: string;
     disputed: boolean;
   }

   export interface LegalCitationView {
     citations: SingleCitation[]; // Checkbox10 becomes a one-element array — no behavior change
   }
   ```

   `buildLegalCitationView` (currently `(paragraph, disputed) => LegalCitationView`) becomes
   `(paragraphs: LegalParagraph[], disputedPerParagraph: Record<string, boolean>) =>
   LegalCitationView`, building one `SingleCitation` per paragraph. Checkbox10's call site passes
   a one-element array; behavior for that field is unchanged.

2. **One shared resolution, three checkboxes.** Checkbox1/2/3 are mutually exclusive outputs of
   the same classification logic (today driven by `s.isHazardous` alone) — only one is ever
   `true`. Add exactly ONE `RESOLVED_FIELDS` entry, key `"deponi-category-basis"`, resolving both
   § 9-5 and § 9-6 once. All three checkbox entries in `form-map.ts` read
   `s.legalCitations?.["deponi-category-basis"]` — the same citation set, not three separate
   resolutions. This mirrors the classification logic itself already being one decision with
   three possible rendered outcomes.

3. **Visibility: all three checkboxes show the citation, not just the checked one.** Rejected
   "checked box only" — that implies each checkbox has independent grounding, when the citation
   actually grounds the *classification decision*, and the checked state is just its output. A
   reviewer sanity-checking "should this be Checkbox2 instead of Checkbox1" needs to see the same
   § 9-5/§ 9-6 pair regardless of which box is currently true, or they can't meaningfully dispute
   the classification. UI: the checked box gets the full `LegalCitationBadge` (same as
   Checkbox10 today); the two unchecked boxes get a smaller, collapsed indicator — "same legal
   basis as [checked box's label]" — that expands to the identical citation set on click, so the
   two paragraphs aren't rendered three times over as duplicate blocks.

4. **Dispute anchors on § 9-6, the operative rule — not a schema change.** `CorrectionStore`'s
   existing single-paragraph-anchor shape (`disputed_paragraph_id`) is reused unchanged; no new
   column, no migration beyond seeding the two new paragraphs. § 9-6 is the operative acceptance
   rule; § 9-5 is definitional scaffolding it depends on, so a disagreement about the
   classification is really a disagreement about how § 9-6 was applied. The distinction between
   "wrong paragraph cited" and "right paragraphs, wrong checkbox" doesn't need structured fields
   to be expressible — the dispute's free-text `reason` carries that nuance naturally (these read
   as obviously different sentences). Deliberately not solving a problem the data doesn't need
   solved yet.

   **Disclosed consequence, not a defect:** `hasUnresolvedDispute()` checks per paragraph id.
   Today § 9-6 is used by exactly one field (this one), so there's no cross-field collision. If
   § 9-6 is ever reused to ground a *different* field later, a dispute raised in this field's
   context would surface as "disputed" there too. Multi-field dispute scoping is out of scope for
   this extension — flagged as a real, deliberate follow-up, not built preemptively.

## What this spec does NOT change

- The search/freeze/dispute mechanism itself (`search()`, `freezeFormField()`,
  `raiseDispute`/`hasUnresolved`) — fully reused as-is.
- Trust-by-default, no role gating, no dispute-resolution UI — all carried over unchanged from
  the trust-model plan's own disclosed scope.
- Checkbox10's own behavior — its call site adapts to the new `LegalCitationView` shape
  (one-element `citations` array) but its rendered output is unchanged.
- The hoist-once-per-request resolution pattern in both Datalab routes — `resolveLegalCitations`
  (and its timeout wrapper) gets a second `RESOLVED_FIELDS` entry; the calling pattern itself
  doesn't change.

## Known follow-ups this spec surfaces but does not resolve

1. **Cross-field dispute-scoping collision**, described above — real, deliberate, deferred.
2. **`LegalCitationBadge`'s collapsed "same basis" variant is new UI** not yet built for any
   existing field (Checkbox10 never needed it, being the only checkbox grounded so far) — the
   implementation plan needs to design this component variant for real, not just describe it.
3. **Multi-paragraph citations may recur for future fields** (this is the second field, but
   likely not the last needing more than one paragraph) — `LegalCitationView`'s new shape should
   be treated as the durable contract going forward, not a one-off special case for this field.
