# WM Recovery Customer Portal — Dashboard Redesign, Chemical Search, Real Partner Network

Date: 2026-08-11 (revised same day — see revision note)

## Revision note

This spec originally proposed a neutral "WasteMatch" demo with a generic German facility dataset (v2 draft 1). Mid-brainstorm, the user shared that this is now being discussed directly with WM Recovery AS's (WMR) leadership as a concept for a real customer-facing portal, and pointed at `wmrecovery.no/references/` — WMR's real project case studies — as a source. This revision replaces the generic-EU-data approach with WMR's actual documented partner network and reframes the product as WMR's own portal concept. Sections 1–2 below (visual redesign, unified upload/search entry) carry over from the original draft; section 3 (facility data) is replaced entirely; sections 4–5 (branding, case studies) are new.

## Purpose

Build a prototype of a customer-facing intake portal for WM Recovery AS: a potential customer describes or uploads details of a waste stream, and the portal tells them whether it falls within WMR's documented business capability and, where WMR has a demonstrated partner for that waste category, which partner and (as social proof) which past project is comparable. This is a **local prototype for the user to demo directly to WMR's leadership** — not something published live under WMR's name or domain.

## Non-goals

- No task history or persistence across sessions, no accounts/login — still stateless, per the original v1 "no database" constraint. The "dashboard"/"project" framing is a visual and narrative treatment of the single active screening task (upload/search → review → matches), not a real multi-project history. A logged-in multi-project hub is the natural next phase to describe verbally to WMR's leadership, not something built now.
- No public deployment under WMR's name, branding, or domain. This is a private prototype for a sales conversation the user is already having; it does not represent an agreement with WMR to build or operate anything.
- No fabricated partner facilities or case studies. Every partner and case shown must trace to a real, named (or explicitly "unnamed but located") fact from `wmrecovery.no/references/`. Coverage gaps are shown honestly (see §3) rather than invented.
- No changes to the PDF-upload extraction path's underlying logic (`lib/extraction.ts`, `/api/extract`) — only its visual presentation changes.

## Approach

### 1. Visual redesign — dashboard component language

Restyle the existing 3-step wizard in place — same components, same data flow, new HeroUI v3 styling layer, following the reference dashboard images the user supplied (dark-green/cream fintech-style dashboard, glassmorphism, stat tiles):

- **Palette:** dark forest-green (`#0d2b1f`-range) as the primary/hero surface, warm cream (`#f5f1e8`-range) as the light/content surface, a lime-green accent (`#a8e05f`-range) for positive/success states, amber/warning tone kept for hazardous flags (existing HeroUI warning color).
- **Card types**, matching the specific reference components the user pointed at:
  - **Light "stat" card** (plain numeric facts — e.g. hazard-flag count, match count) — white/cream background, small label, large dark number, mirroring the reference's "Statistics — Expenses $264 / Incomes $478" card.
  - **Dark "hero" card** (the single most important number on a step — e.g. the EAL code, or the primary partner match) — dark-green background, lime-green large number/label, small trend/status pill in the corner, mirroring the reference's green "Expenses $1,650 +12%" card.
  - **Progress-bar card** (the project's current stage — see §2 below) — dark-green background, "Stage X of 4" label, filled progress bar, mirroring the reference's "$116 / $1,530 — Dream Laptop — 15% Completed" card.
  - **Pill action buttons** — light-green filled (primary action, e.g. "Confirm & Find Partner") and dark-green filled (secondary action, e.g. "Download Report"), mirroring the reference's `[PAY A BILL]` / `[TRANSFER]` pill buttons.
- **Extracted-composition card:** Step 2 gets a small glass card showing the PDF-extracted composition (TCLP metals, VOCs, physical characteristics) beneath the classification hero card — this data exists in `ExtractedWasteData` but was previously unused by the UI (flagged in the v1 final review as a visibility gap: "the audience never sees what Claude pulled out of their PDF").
- **Upload control:** replace the bare `<input type="file">` with a styled dropzone matching the new card language.

No new libraries — HeroUI v3 + Tailwind v4 already support all of this via component variants, custom Tailwind classes, and `backdrop-blur`/`bg-opacity` utilities.

### 2. Project progress framing (no persistence)

The single active screening task is presented as "your project," with a progress-bar card (see §1) showing four stages:

1. **Submitted** — PDF uploaded or search query entered
2. **Classified** — EAL code + compliance flags resolved
3. **Matched with partner** — WMR partner (or documented capability-but-no-partner) resolved
4. **In progress with partner** *(illustrative label only)* — shown as the natural next step in WMR's real process, not a tracked state, since there is no persistence layer. Rendered visually distinct (e.g. dashed/greyed styling) from stages 1–3 to make clear it is not something the prototype actually executes.

This maps directly onto the existing wizard step state (`Wizard.tsx`'s `step: "upload" | "review" | "matches"`) with no new state machine — stage 4 is a static label added to the Matches step's UI, not a new step.

### 3. Real WMR partner network (replaces generic EU facility data)

New file `lib/data/wmr-partners.json`, populated **only** with partners actually documented in WMR's published case studies at `wmrecovery.no/references/`:

| Partner | Location | Role (from case study) | Documented via |
|---|---|---|---|
| Miljøteknikk | Rana, Norway | Hazardous soil stabilization/treatment | Odda Boliden, Scana Steel Jørpeland, Eramet Kvinesdal |
| Svåheia landfill | Egersund, Norway | Hazardous (dedicated cell) & non-hazardous soil disposal | Odda Boliden, Eramet Kvinesdal |
| Carmans Blue | Belgium | PFAS-contaminated soil washing | Bijela Shipyard |
| *(unnamed)* ore treatment/separation facilities | Belgium / Germany | Off-grade ore upgrading | LKAB Narvik |
| *(unnamed)* licensed landfills | Norway / Sweden | Contaminated dredged sediment disposal | Gøteborg Hamn |

Each entry carries the real case-study project name/location as its evidence, and a new `dataConfidence: "verified-partner"` tier (stronger than the existing `"best-effort"` — backed by a real, quantified, named project) alongside v1's existing tiers. The `Facility` type (renamed conceptually to represent a "partner" here, though the underlying TypeScript type can stay `Facility` to avoid an unnecessary rename across existing code) gains a `caseReference: string | null` field pointing at the matching entry in `wmr-cases.json` (§4).

**Coverage gaps are shown, not papered over.** WMR's stated business areas include Industry Hazardous Organic (paints, solvents, glycols), Energy (filterdust, RDF/SRF), and Metals — none of which have a documented partner in the case studies. When a classified waste falls in one of these categories, the Matches step shows an explicit message: *"This falls within WM Recovery's stated business areas. No specific partner facility is documented in this prototype — in production this would route to WMR's live partner network."* This is a deliberate, honest gap, not a bug to fix by inventing a plausible-sounding facility.

`lib/matching.ts`'s `findMatches()` logic (exact/prefix EAL code matching) is unchanged; it now searches `wmr-partners.json` instead of the Norway-only `facilities.json` (which is retained as historical/reference data but no longer the primary match source — see Architecture changes).

### 4. Case studies as social proof

New file `lib/data/wmr-cases.json` holding all 7 real WMR reference projects with their real, published facts (material, quantity, location, client, what WMR did):

1. Odda Boliden (Norway) — ~35,000 MT heavy-metal-contaminated soil
2. Slettebakken deponi, Bergen (Norway) — ~65,000 MT historic landfill remediation
3. LKAB Narvik (Norway) — ~150,000 MT off-grade iron ore
4. Scana Steel, Jørpeland (Norway) — ~4,000 MT hazardous soil + filterdust
5. Bijela Shipyard, Montenegro — 35,000 MT PFAS-contaminated soil
6. Gøteborg Hamn, Sweden — ~45,000 MT contaminated dredged sediment
7. Eramet Kvinesdal (Norway) — ~8,000 MT hazardous soil

On the Matches step, when the classified EAL code/category overlaps a case's documented material type, a "Similar project" card renders alongside the partner match — real project name, location, quantity, and a one-line description of what WMR did. If no case overlaps, this card is simply omitted (not a gap that needs an honest-limitation message, since case studies are supplementary proof, not a claim about capability).

### 5. Branding

The portal is framed as WMR's own concept: real company name, the company description text the user supplied, WMR's real business areas and countries of operation shown in the app's header/about area. Built and run locally for the user's own demo to WMR's leadership — no public deployment, no claim of being an official WMR product.

### 6. Unified entry: Upload or Search (carried over from original v2 draft)

Step 1 gains two modes as tabs/toggle: **"Upload PDF"** (existing flow, unchanged) and **"Search by chemical"** (new).

**Search mode:** a single text input. On submit, calls a new route:

- **`POST /api/search-classify`** — takes `{ query: string }`. Matches against `eal-codes.json` descriptions, `pops.json` entries' `aliases` field, and `avfallsstoffnummer.json` descriptions (deterministic keyword lookup, not an LLM call — free, instant, appropriate for a short query with no composition data to extract). Returns the same `ClassificationResult` shape `/api/classify` produces from the PDF path.
- If no match is found, returns an explicit "no matching waste code found" response — never a fabricated classification.
- Both entry modes converge on the same `ClassificationResult`/`FacilityMatch` types, so `ReviewStep.tsx` and `MatchesStep.tsx` require no changes for the search path itself — only the new §1–5 visual/data changes touch them.
- Search-mode classifications have no `hazardIndicatorsNoted`-derived compliance flags (no lab composition data) — only the `HAZARDOUS`/`CROSS_BORDER_SHIPMENT` flags derivable from the EAL code alone. Known, acceptable limitation, not a bug.

## Architecture changes

- `lib/types.ts`: `Facility` gains `dataConfidence: "verified-partner" | "verified-permit" | "best-effort"` (extending, not replacing, the existing union) and `caseReference: string | null`.
- `lib/data/wmr-partners.json`: new file, ~5 entries per §3.
- `lib/data/wmr-cases.json`: new file, 7 entries per §4.
- `lib/data/facilities.json` (the original Norway-wide directory from v1): retained in the repo as historical data but no longer wired into `findMatches()` for the primary flow — the WMR portal's matches now come from `wmr-partners.json` only. (Kept rather than deleted in case the "public registry, broader network" framing is wanted later; not rendered in the UI for this phase.)
- `lib/search-classify.ts`: new pure-function module (keyword matching logic), unit-testable, mirroring `lib/classification.ts`'s structure.
- `app/api/search-classify/route.ts`: new route wrapping `lib/search-classify.ts` + `findMatches()` against `wmr-partners.json`.
- `lib/matching.ts`: `findMatches()`'s call sites (`/api/classify`, `/api/search-classify`) now pass `wmr-partners.json` instead of `facilities.json`; matching logic itself unchanged.
- `components/wizard/Wizard.tsx`: Step 1 renders the Upload/Search mode toggle; a progress-bar "project stage" card renders on the Matches step; two handler paths converge on the same state updates.
- `components/wizard/MatchesStep.tsx`: renders the coverage-gap honesty message (§3) when no partner is found but the category matches a WMR business area; renders the "Similar project" card (§4) when a case overlaps.
- `components/wizard/UploadStep.tsx`: split internally or paired with a sibling `SearchStep.tsx` — implementation detail deferred to the plan; interface contract is a shared `onClassified(classification, matches)` callback shape.
- App-level branding text/header: WMR company description, business areas, countries — static content, no new data model needed.
- Visual redesign touches every existing component's className/styling but not `ReviewStep`/`MatchesStep`/`Wizard`'s current `Props` types.

## Error handling

- Search with no keyword match: explicit "no matching waste code found" message, never a fabricated classification.
- No partner match but category is within a stated WMR business area: explicit honest-gap message (§3), never an invented facility.
- `wmr-partners.json` and `wmr-cases.json` data follows the same non-fabrication principle as v1's facility data — every fact traces to the published case studies.
- Everything from v1's error handling (extraction failure, malformed classify payload, malformed report payload, PDF read failure) is unchanged.

## Testing

- `lib/search-classify.ts` gets unit tests mirroring `tests/classification.test.ts`'s style: known queries resolve to the expected EAL code; an unmatched query returns the explicit no-match result.
- `findMatches()`'s existing tests (`tests/matching.test.ts`) get extended to run against `wmr-partners.json` and confirm the honest-gap path triggers correctly for categories with no documented partner (e.g. classifying a paint/solvent sample should produce zero partner matches and the gap message, not a false positive).
- New test: for each of the 6 v1 reference sample PDFs, confirm which (if any) case study/partner combination it resolves to, and manually verify that resolution against the actual case-study facts (e.g. a PFAS-flagged sample should be able to surface the Bijela Shipyard case).
- Visual redesign manually verified in the browser preview, consistent with v1's approach.
