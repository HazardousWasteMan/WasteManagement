# Stage 4: Facility/Handler Matching

Date: 2026-08-13

## Context

This is the last major stage from the original project brief (`decision_engine.md`'s Stage 4): given a classified waste (EAL code, hazard status, matrix), match it against a handler capability database. The wizard's Classification results step is currently the end of the flow — no facility matching exists. The prior WM Recovery partner-matching UI/data was fully retired in an earlier slice (deleted, based on placeholder demo data, not real permits).

Unusually for this stage, real prior work already exists and doesn't need to be rebuilt from scratch: `facility_permits.md` (real, sourced research into both candidate facilities' actual permits) and a working Python prototype (`facility_match.py` + `facility_stoleheia.json`/`facility_returkraft.json`) that already implements this stage's matching logic correctly, including two honestly-disclosed data gaps. This spec is a **port** of that already-correct logic into the TypeScript app, not new research — with one gap partially closed (a narrow, sourced avfallsstoffnummer↔EAL crosswalk) and one left as-is (no eluat/leachate data capture).

## Scope of this slice

**In scope:**
- Porting the two real facility datasets (Støleheia deponi, Returkraft forbrenningsanlegg) into `lib/data/`.
- Porting `facility_match.py`'s matching logic into `lib/hp-classification/facility-match.ts`, preserving its exact behavior including both honest gaps.
- A narrow avfallsstoffnummer↔EAL crosswalk (`lib/data/avfallsstoffnummer-eal-crosswalk.json`) covering only the ~4-5 real, permit-cited pairs already transcribed in `facility_permits.md` — not a general/exhaustive crosswalk (none exists publicly; the official Norwegian CSV has zero EAL cross-references, confirmed by direct check during brainstorming).
- A new `POST /api/facility-match` route and a new `FacilityMatchStep` wizard step (step 4, after Classification results).
- Tests against the same real scenarios the prototype's own logic was already validated against (the Italian sample, a Eurofins concrete sample).

**Explicitly out of scope:**
- Closing the eluat/leachate data gap — Støleheia's ordinary-contaminated-mass path (which is where most non-hazardous soil/concrete samples land) requires A1/B1/C1 leachate tier results our extraction schema doesn't capture. This stays an honest "insufficient data" outcome, exactly as the prototype already reports it — adding eluat capture is real, separate, larger follow-on work (a new extraction field, a new HP-classification-adjacent concept), not bundled into this slice.
- Expanding the crosswalk beyond the permit-cited pairs already in hand — any EAL code without a documented crosswalk entry honestly reports that, never guesses one.
- Any facility beyond Støleheia and Returkraft — these are the two real facilities already researched; adding more is genuinely new research work for a future slice.
- Any change to the classification engine itself (`classifySample`, `normalizeSample`, `classifyHazard`, `assignEalCode`) — this slice only consumes their output (`isHazardous`, `ealCode`) plus already-extracted `matrixType`, never modifies how those are computed.

## Data — ported real permit data

**`lib/data/facility-stoleheia.json`** — direct port of the prototype's `facility_stoleheia.json`: 4 fixed hazardous EAL lines with real annual tonnage caps (12 01 16*, 13 05 03*, 16 02 12*, 17 06 01*), the generic hazardous bucket (20,000 t/yr, caveated as not verifiable from composition alone), and the ordinary-contaminated-mass path description (requires eluat data, uncapped tonnage).

**`lib/data/facility-returkraft.json`** — direct port of the prototype's `facility_returkraft.json`: composition limits (≤1% halogenated, ≤15% hazardous fraction, no pure PCB fractions), the accepted avfallsstoffnummer list, the 2,000 t/yr special cap on contaminated soil masses, and the mineral-matrix exclusion note.

**`lib/data/avfallsstoffnummer-eal-crosswalk.json`** — narrow, real crosswalk transcribed from `facility_permits.md`'s own citations of Returkraft's permit:

```json
[
  { "avfallsstoffnummer": "1603", "ealCode": "17 05 04", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" },
  { "avfallsstoffnummer": "1604", "ealCode": "17 05 03*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" },
  { "avfallsstoffnummer": "1606", "ealCode": "17 05 05*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~), alternate code 17 05 06 also noted" },
  { "avfallsstoffnummer": "1614", "ealCode": "17 01 06*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" }
]
```

`isApproximate: true` is preserved on every entry (the source permit itself marks these with "~", not a firm 1:1 mapping) — the matching logic must surface this caveat, not silently present these as certain.

## Logic — `lib/hp-classification/facility-match.ts`

Direct TypeScript port of `facility_match.py`'s three functions:

```typescript
export interface FacilityMatchInput {
  isHazardous: boolean;
  ealCode: string;
  matrixType: string | null;
}

export interface FacilityMatchResult {
  facilityId: "stoleheia" | "returkraft";
  eligible: boolean | "likely" | "insufficient data" | "requires crosswalk (not available for this code)";
  route: string;
  detail?: unknown;
  caveat?: string;
  reason?: string;
}
```

`checkStoleheia(input)`: if hazardous, checks the 4 fixed EAL lines for an exact match (`eligible: true`, route "fixed hazardous EAL line"); if no fixed-line match, falls to the generic bucket (`eligible: "likely"`, with the caveat that eligibility depends on the "stable, non-reactive" criteria not verifiable from composition alone). If non-hazardous, always reports `eligible: "insufficient data"` with the reason being the missing eluat/leachate test — this is the honest, unchanged gap.

`checkReturkraft(input)`: if `matrixType` matches the mineral-matrix exclusion list (jord, betong, stein, tegl, aske asfalt, asfalt — case-insensitive substring match, same as the prototype), returns `eligible: false` with the composition reason. Otherwise, looks up `ealCode` against the narrow crosswalk (Task's `avfallsstoffnummer-eal-crosswalk.json`, matched by `ealCode` field): a match returns `eligible: true` with the matched avfallsstoffnummer and its `isApproximate` caveat surfaced; no match returns `eligible: "requires crosswalk (not available for this code)"`.

`matchFacilities(input): { stoleheia: FacilityMatchResult; returkraft: FacilityMatchResult }` — calls both checks, returns both results together (both facilities are always evaluated, never short-circuited).

## Wiring

**`POST /api/facility-match`** — accepts `{ isHazardous: boolean, ealCode: string, matrixType: string | null }` in the request body (all already available from the classification step's own output plus the already-extracted metadata — no new extraction call needed), returns `matchFacilities(...)`'s result directly.

**Wizard**: a new step, `FacilityMatchStep.tsx`, added after Classification results (`Upload → [Sample selection] → Extraction review → Classification → Facility match`). Renders both facilities' results plainly — the route taken, the caveat/reason text where present, and the eligibility state (never collapsing "likely"/"insufficient data"/"requires crosswalk" down to a simple yes/no, since that distinction is the whole point of shipping honest gaps instead of guesses).

## Testing

Unit tests against the same two real scenarios the prototype's own logic was validated against, both already real fixtures in this repo:
- **Italian sample** (hazardous, `17 05 03*`, matrix "Terra e roccia"): Støleheia → not on the 4 fixed lines → generic bucket, `eligible: "likely"`, caveat present. Returkraft → mineral matrix → `eligible: false`, composition reason.
- **Eurofins concrete sample** (non-hazardous, `17 01 01`, matrix "Betong"): Støleheia → `eligible: "insufficient data"` (no eluat data). Returkraft → mineral matrix → `eligible: false`.
- A synthetic case exercising the narrow crosswalk's positive-match path (a non-mineral matrix, `ealCode: "17 01 06*"`) to prove the `1614` crosswalk entry resolves correctly with its `isApproximate` caveat surfaced — since no real non-mineral-matrix fixture exists in this repo yet, this one test case is explicitly synthetic, built from the real crosswalk data, not a real uploaded report.
