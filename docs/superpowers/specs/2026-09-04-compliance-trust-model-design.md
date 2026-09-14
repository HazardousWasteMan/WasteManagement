# Compliance Trust Model — Design

**Status:** Approved for planning (2026-09-04) — all four open questions resolved, see
"Decisions" (replacing the former "Open questions" section) at the end.
**Branch:** `compliance`
**Builds on:** `docs/superpowers/specs/2026-09-03-compliance-cache-phase1-slice-design.md`,
`docs/superpowers/plans/2026-09-03-compliance-cache-phase1-slice.md` (the Phase 1 seed slice —
`lib/compliance/search.ts`, `freeze.ts`, `legal_paragraphs`, `compliance_form_freezes`, all
already built and proven against real infrastructure).

## Purpose

The Phase 1 slice proved the retrieval mechanism: a real legal paragraph can be found, cached,
and frozen against a form field so the citation can never be silently rewritten later. It did
not answer a separate question — **how does a human come to trust that the cited paragraph is
the right one for this case, and what happens when they don't?** This spec answers that.

## The trust problem, precisely

Two different beneficiaries were named during brainstorming, and they need different things:

1. **Trust before it becomes truth** — did the model apply the *correct* paragraph to *this*
   case, before that citation gets relied on?
2. **Trust after the fact** — if a handler, an inspector, or a compliance reviewer later asks
   "why did you say this," can the system defend it?

The Phase 1 freeze mechanism already solves #2 well: a frozen record proves what was cited and
in what state, at submission time, immutably. It does **not** solve #1 — freezing preserves
whatever was true at the time, right or wrong. This spec is about #1: what makes a citation
trustworthy before it's relied on, without making every citation expensive to trust.

## Rejected approach: gate on `human_signed_off`

The Phase 1 schema already has a `human_signed_off` boolean on `legal_paragraphs`, per the
parent architecture's §7 ("human sign-off on first use of a new paragraph"). The natural reading
is a gate: a fresh paragraph can't be used until a compliance person reviews and approves it.

Rejected during brainstorming, deliberately: gating punishes the common case (the model finds
the right real paragraph — the retrieval mechanism itself is already proven, not a guess) to
guard against the rare case (the model finds a real paragraph that's wrong *for this case*).
Every fresh citation would cost a human review cycle regardless of whether anything was ever
actually wrong.

## Chosen approach: trust-by-default, dispute-by-exception

A `grounded_high` citation is trusted and used automatically the moment `search()` finds it —
no approval step. It is always shown transparently (see "Inline citation" below) so a human
*can* catch a wrong application, but nothing blocks on them doing so.

`human_signed_off` is repurposed: instead of "a human approved this before use," it means "a
human has explicitly reviewed and endorsed this paragraph's use here" — set only when a dispute
resolves in the citation's favor, not on every fresh grounding. The default path never touches
it.

The action a human has is **"I disagree with this citation,"** not "I approve this citation."
This is the rare path, by design — the assumption (flagged below as the riskiest one) is that
wrong-paragraph-for-this-case is genuinely uncommon.

## UI surfaces

Three surfaces came out of brainstorming, each answering a different "when":

1. **Inline citation (build first)** — a small badge/tooltip on the grounded field itself (the
   `Checkbox10` note text from the Phase 1 slice is the un-interactive precursor to this).
   Shows the paragraph reference, verification date, and a link to the real source, plus the
   "I disagree" action. This is the surface that makes trust-by-default honest — it only works
   as a strategy if the citation is actually visible at the point of use, not buried.
2. **Aggregated "legal basis used" list, per case (parked)** — every citation actually used in
   one case, in one place. Explicitly NOT a browsable law-reference library; scoped tight to
   "what was cited here," closer to a bibliography than a search UI. Parked because it's real
   value but not urgent relative to #1 and #3.
3. **Frozen audit record (already built, Phase 1)** — `compliance_form_freezes`, unchanged by
   this spec. What was cited, and its state, at submission time. This is the "trust after the
   fact" surface and needs no new work here beyond what corrections add (next section).

## Corrections: a new record, never an edit to history

When a dispute is raised against an already-frozen form field, the frozen record must not
change — that would break the exact defensibility property freeze exists for. A dispute creates
a **new, separate correction record** that points at the original freeze, rather than reopening
or rewriting it. Confirmed during brainstorming as the legally and architecturally correct
choice: a frozen record is a fact about the past ("this is what was submitted and why"); a
correction is a fact about the present ("we now believe that was wrong"). Layering, not editing.

Sketch of the new table (naming/fields to be finalized in the implementation plan, not frozen
here):

```json
{
  "id": "uuid",
  "freeze_id": "references compliance_form_freezes(id) — the record being disputed",
  "disputed_paragraph_id": "the legal_paragraphs.id originally cited",
  "raised_by": "who disputed it",
  "raised_at": "timestamp",
  "reason": "free text — why this citation is believed wrong for this case",
  "resolution": "upheld | corrected | null (unresolved)",
  "corrected_paragraph_id": "legal_paragraphs.id | null — set only if resolution is 'corrected'",
  "resolved_by": "who resolved it | null",
  "resolved_at": "timestamp | null"
}
```

A correction never mutates `compliance_form_freezes`. A UI rendering a historical form shows the
original frozen citation AND, if one exists, any correction record layered on top of it —
visibly distinct, never merged into a single "current" value.

## Not in this spec

- **Handler-facing views.** Explicitly deferred — handler-matching itself isn't built yet. Not
  an architectural risk: grounding, freeze, and correction are already structured, provenance
  data, so a handler-facing export/view later is a rendering problem on top of existing data, not
  a redesign.
- **The aggregated per-case citation list** (UI surface #2 above) — parked, not scoped here.
- **Extending `BkField` with a real `citedParagraphId`** — a real, named gap from the Phase 1
  plan's "Known follow-ups" (item 3). The inline citation UI in this spec depends on that
  existing first; it's a prerequisite for implementation, not something this spec re-solves.

## Riskiest assumption

That disputes really will be rare. Trust-by-default means a wrong citation can be relied on and
even frozen before anyone happens to look at it — the design accepts that risk in exchange for
low day-to-day friction. If real usage shows the model frequently grounds the wrong *real*
paragraph (not "no paragraph found," which `no_match` already handles honestly, but "found a
real paragraph that doesn't actually apply here"), that's the signal to revisit whether some
category of field needs a review gate after all. Suggested cheap instrumentation once this
ships: track dispute rate per citation/field, no dashboard needed yet — just a queryable number.

## Decisions

All four questions raised during brainstorming/refinement are now resolved:

- **Who can raise "I disagree with this citation"?** Intent: compliance-team role only, to keep
  a dispute record meaningful — it should signal someone with real authority flagged it, matching
  the audit-trail/legal-defensibility framing this whole model serves. Reality check during
  planning: this app has no per-user role system at all today — one shared login
  (`BASIC_AUTH_USER`/`PASSWORD` in `proxy.ts`) for everyone, no per-user identity. Building real
  roles is out of scope for this feature. Decision: ship the dispute action available to anyone
  with app access for now — no role gating — and disclose this openly rather than pretend the
  intent is enforced. `raised_by` is still captured on every dispute record (free-text/session
  identity, whatever the app can attribute today) so provenance isn't lost even without
  enforcement. Real role-gating is a known, deferred follow-up once the app has actual per-user
  identity — see "Known follow-ups" in the implementation plan.
- **Does an unresolved dispute (`resolution: null`) block anything?** No — purely informational
  until resolved. Blocking would reintroduce the friction this whole model exists to avoid.
- **Correction table shape and its relationship to `BkField`'s `citedParagraphId`:** the sketch
  in "Corrections" above (`freeze_id`, `disputed_paragraph_id`, `raised_by`/`raised_at`,
  `reason`, `resolution`, `corrected_paragraph_id`, `resolved_by`/`resolved_at`) is final for
  planning purposes; exact column types/naming get finalized in the implementation plan the way
  the Phase 1 slice's schema was. It depends on `BkField.citedParagraphId` existing first (Known
  follow-up #3 from the Phase 1 plan) — that remains a hard prerequisite task in the
  implementation plan, not something this spec re-solves.
- **New citation of a paragraph with an unresolved dispute elsewhere:** show a subtle flag on
  the new citation too (something disputed once is worth a glance), but never block the field
  from being grounded and used — consistent with the informational, non-blocking answer above.
