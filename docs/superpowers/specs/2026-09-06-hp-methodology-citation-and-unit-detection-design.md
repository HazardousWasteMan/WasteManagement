# § 11-2 Methodology Citation + Unit-Based Leachate Detection — Design

**Status:** Approved for planning
**Branch:** `compliance`
**Builds on:** the compliance-cache mechanism (`lib/compliance/search.ts`, `resolve-legal-citations.ts`,
`citation-view.ts`) and the leachate HP routing fix (`lib/hp-classification/classify-sample.ts`'s
tri-state gating, all four prior plans on this branch — merge-ready, not yet merged).

## Purpose

Two independent findings from real production testing of the leachate HP routing fix, combined
into one spec at the user's request (both touch `lib/hp-classification`/`lib/bk-skjema`, though
via different mechanisms and risk profiles):

1. Every classified sample's generated description states *"Vurdert mot HP1-HP15
   (avfallsforskriften kap. 11 / forordning 1357/2014)"* as a bare, uncited claim. Real research
   (Lovdata, direct paragraph fetch) confirms **§ 11-2** is the real paragraph establishing this —
   it defines hazardous waste by reference to Vedlegg 1 (EAL codes) and Vedlegg 2 (HP criteria),
   and separately cites Regulation (EU) 1357/2014's EEA incorporation. Grounding the universal
   methodology sentence in this real citation extends the same "here is where this rule comes
   from" pattern § 9-6 already established twice, to a broader, universal reach — every sample,
   not just specific fields/states.
2. The leachate-only gate built in the prior plan relies entirely on an LLM-extracted keyword
   signal (`ristetest_utfort`/`kolonnetest_utfort`/`totalinnhold_utfort`). Real production testing
   (a user-supplied sample, referred to below as the "Test 1 pattern") found a report that is
   chemically a leachate/eluate sample (concentrations reported in mg/l, alongside pH and
   conductivity — the diagnostic signature of a liquid extract, not solid total content) but
   whose language didn't trigger the LLM's `ristetest_utfort` flag, because it didn't use the
   words "ristetest"/"kolonnetest"/"L/S=10" the way the reports used during the prior plan's
   testing did. That sample got a fabricated "farlig avfall" verdict off liquid mg/l values run
   through HP1-15 thresholds calibrated for solid mg/kg total content — the exact category error
   the prior plan fixed, wearing a different disguise the keyword detector didn't recognize.

## Part 1: § 11-2 methodology citation

**Real legal basis, confirmed via direct Lovdata fetch:**
- § 11-2 ("Virkeområde og definisjon av farlig avfall") — real text: hazardous waste is defined
  by reference to Vedlegg 1 (the EAL list) and Vedlegg 2 (the HP-criteria table), with the
  chapter's EEA-incorporation note citing Regulation (EU) 1357/2014.
- Same document (`avfallsforskriften`), same fetchable `§article-paragraph` addressing already
  built by `LovdataSource` — no new parser work, unlike the still-blocked Vedlegg-addressing gap
  (already logged in memory from the kap. 9 work; § 11-2 itself is a real article, not a Vedlegg,
  so it doesn't hit that gap).
- § 11-2 needs REAL SEEDING (unlike the § 9-6 reuses in the prior plan) — it's a new paragraph,
  never before cached. Extends `scripts/seed-lovdata.ts`'s `buildSeedLocations`.

**Design:**
- New `resolve-legal-citations.ts` `RESOLVED_FIELDS` entry, key `"hp-methodology-basis"`, single
  location (§ 11-2, `primary: true`).
- `TextField38` (the BK-skjema field already carrying `buildDescription`'s generated text as its
  `value`) gets `legalCitation` set to this — **unconditionally, for every classified sample**,
  regardless of `isHazardous` being `true`/`false`/`null`. This is the first citation in the app
  that isn't state-conditional — it grounds the methodology itself, which applies universally.
- Rendered via the existing `LegalCitationBadge` (`variant="full"`, since nothing else shares
  this citation) — no new UI component.

## Part 2: unit-based leachate detection (deterministic fallback)

**The gap, precisely:** `ristetest_utfort`/`kolonnetest_utfort`/`totalinnhold_utfort` are LLM
judgments based on report language. A real report can be chemically a leachate sample without
ever using the keywords the extraction prompt looks for.

**Design:**
- New pure function `unitsIndicateLeachate(results: SampleResult[]): boolean` in
  `lib/hp-classification/classify-sample.ts` — inspects each result row's `unitRaw` for a liquid-
  concentration denominator (`mg/l`, `µg/l`, `ng/l`, `g/l` — a `/l` unit, not `/kg`). Real,
  disclosed threshold rule (not "any single row"): count rows with a liquid-unit denominator
  against rows with a solid-basis denominator (`/kg`, e.g. `mg/kg TS`); rows with neither (no
  recognized unit, or a unit that is neither a mass-per-volume nor mass-per-mass form) are
  excluded from both counts, not treated as evidence either way. The function returns `true` only
  when liquid-unit rows are a **strict majority of the counted rows** (`liquidCount >
  solidCount + unmatchedInDenominator` is not the rule — precisely: `liquidCount / (liquidCount +
  solidCount) > 0.5`, i.e. more than half; a 50/50 split does NOT gate, since "majority" requires
  more liquid rows than solid rows, not merely as many). A sample with zero counted rows (all
  units unrecognized) returns `false` — absence of evidence is not evidence of leaching. This
  fixes the threshold as a concrete, locked comparison, not an open parameter — the plan
  implements exactly this arithmetic, no rounding or configurable knob.
- Lives in `classify-sample.ts` (not `from-datalab.ts`/`datalab.ts`) specifically because it
  operates on `SampleResult[]`, which `classifySample` already receives regardless of which
  extraction backend produced it (Datalab or the older Anthropic pipeline) — this protects both
  pipelines, not just Datalab's.
- **Units win, always** (confirmed design decision): if `unitsIndicateLeachate` returns `true`,
  the sample gates to `isHazardous: null` regardless of what `ristetestUtfort`/
  `totalinnholdUtfort` say — even if the LLM explicitly claimed `totalinnhold_utfort: true`. This
  is a deliberate override, not a fallback-only signal, because a wrong hazardous fabrication is
  judged worse than an over-cautious gate.
- **Conflict must be traceable, not silent**: when `unitsIndicateLeachate` is the reason a sample
  gates — specifically when it returns `true` while the LLM's own flags say otherwise (e.g.
  `totalinnholdUtfort: true`, or `ristetestUtfort`/`kolonnetestUtfort` both `false`/undefined) —
  `classifySample` must produce a DIFFERENT `confidenceFlags`/`confidenceFlagsNo` message than the
  existing keyword-triggered gate uses, one that says explicitly that unit-based detection
  overrode the extraction's own flags (e.g. English: "...overriding the extraction's own
  totalinnhold_utfort flag, because result units indicate a liquid/eluate sample regardless of
  what the report's language claimed."; Norwegian companion equivalent). When the two signals
  agree (both say leaching-only), the existing message from the prior plan is reused unchanged —
  no new message needed for the non-conflicting case. This preserves the exact debugging
  guarantee the `confidenceFlags` mechanism already exists for: a future reader must be able to
  tell, from the flag text alone, why a sample with `totalinnhold_utfort: true` still ended up
  `isHazardous: null`.

## Explicitly disclosed, not solved by this spec

- **False-positive risk in Part 2**: a genuinely liquid WASTE STREAM (not a soil sample with a
  leachate test attached) — e.g. real liquid industrial waste reported in mg/l as its actual,
  legitimate total-content basis — would also get gated by the unit check, since nothing
  distinguishes "this is a leachate extract of a solid" from "this is genuinely liquid waste."
  This is a real, narrow edge case, disclosed and deferred, not solved here. The prior gate's own
  physical-state field (`SampleMetadata.physicalState: "solid" | "liquid" | "powder"`) is a
  plausible future signal to disambiguate this (a `physicalState: "liquid"` sample reporting mg/l
  should NOT be gated, since that's its real total-content basis) — noted as a follow-up, not
  built now, to keep this spec's scope to what's actually confirmed needed.
- **Part 1's actual HP threshold table** (Vedlegg 2 to kap. 11) remains uncitable — same
  Vedlegg-addressing gap as kap. 9's Vedlegg II, already logged in memory. § 11-2 grounds "where
  this rule comes from," not the literal threshold numbers, exactly like § 9-6's role for the
  landfill-category/indeterminate-state citations.
- **Dispute scoping** (`hasUnresolvedDispute()`'s paragraph-id-only scoping) is now materially
  closer to mattering with a THIRD real citation added — still deferred, tracked since the prior
  two plans.

## Testing

- Real regression test built directly from the user's Test 1 sample pattern (Ba 0.13 mg/l, Cr
  0.059 mg/l, Mo 0.069 mg/l, Cl 23 mg/l, pH 12.5) — proving `unitsIndicateLeachate` correctly
  flags it and the sample now gates to `isHazardous: null`, instead of the fabricated "farlig
  avfall" verdict it got in production.
- A regression case confirming a normal total-content sample (mg/kg TS units) is unaffected.
- A case proving the "units win, always" override: `totalinnhold_utfort: true` explicitly set,
  but liquid units present — must still gate, AND its `confidenceFlags`/`confidenceFlagsNo` must
  contain the distinct override-specific message (not the plain leaching-only message reused from
  the prior plan).
- A case at exactly a 50/50 liquid/solid split, proving it does NOT gate (majority requires
  strictly more than half).
- A case with one stray liquid-unit row among several solid-basis rows (well under 50%), proving
  it does NOT gate — the real threshold rule, not "any row".
- A case with all-unrecognized units (zero counted rows), proving `unitsIndicateLeachate` returns
  `false` rather than trivially "flagging" on empty evidence.
- Real seeding verification for § 11-2 (SQL query against the live Supabase project, same
  pattern as prior plans).
- `TextField38`'s `legalCitation` presence test across all three `isHazardous` states (`true`,
  `false`, `null`) — proving it's genuinely unconditional, not accidentally tied to one state.
