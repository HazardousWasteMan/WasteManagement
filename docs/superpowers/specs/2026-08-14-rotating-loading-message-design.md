# Rotating Loading Message

Date: 2026-08-14

## Context

The wizard's extraction step shows a single, static loading label ("Extracting data…" in
`UploadStep.tsx`, "Extracting…" as a button label in `SampleSelectionStep.tsx`) for the entire
duration of a Stage B extraction call. Following the recent truncation/timeout fix, extraction can
now legitimately run for several minutes on large, dense reports (empirically observed up to
~4.5 minutes) — a static, unchanging label for that long risks the user thinking the app has
frozen. This is a small, standalone UX fix, decoupled from the three larger backend/data items
queued after it (analyte-reference expansion, EAL English translation, `customChapter` reach).

## Scope of this slice

**In scope:**
- A new shared component, `RotatingLoadingMessage`, cycling through a fixed set of short text
  messages every ~2.5s while mounted.
- Wiring it into both existing loading states: `UploadStep.tsx`'s upload-and-extract flow, and
  `SampleSelectionStep.tsx`'s per-sample extraction flow.

**Explicitly out of scope:**
- Any real progress indication (percentage, stage tracking, elapsed time) — this requires new
  backend instrumentation/streaming to the client and is a separate, larger feature. This slice
  is purely a "the app hasn't frozen" signal.
- Any change to the extraction pipeline, timeout behavior, or error handling — already fixed in
  the prior branch; untouched here.
- Any change to `ExtractionReviewStep.tsx`'s "Classifying…" state or `FacilityMatchStep.tsx`'s
  loading state — those calls are fast (classification/facility-matching are synchronous
  computation, not multi-minute LLM extraction) and don't need this treatment.

## Component — `components/wizard/RotatingLoadingMessage.tsx`

No required props. Internally holds a fixed, ordered array of messages. Revised per the user's
follow-up direction: rather than playful filler, the messages honestly describe the real steps
the extraction pipeline actually performs — the single Stage B call to Claude (see
`lib/hp-classification/extract.ts`'s `buildSchemaInstructions`) does, in substance, read the
document, extract metadata and analyte results, match those results against the known-substance
reference list, and check for the specific hazard-relevant free-text statements
(flammability/corrosion/irritation). The messages name these real steps, cycling roughly in the
order they'd logically occur — this is not a live, server-synced progress bar (the call is one
opaque streaming request from the client's point of view, so there's no real per-step signal to
sync to), but it is an honest description of real pipeline behavior, not fabricated flavor text:

```
"Reading the document…"
"Extracting analyte results…"
"Matching known substances…"
"Checking for hazard-relevant data…"
"Finalizing extracted data…"
"Large reports can take a few minutes…"
```

Cycles sequentially with wraparound via `useEffect` + `setInterval` at a ~2.5s interval, cleaned
up on unmount (component only mounts while its parent's loading state is true, so no cleanup
edge case beyond a standard `useEffect` return). Renders as a single `<p>` matching this
codebase's existing loading-text styling (`text-sm`, same as what it replaces). The final message
("Large reports can take a few minutes…") sets an honest expectation given the real, empirically
observed multi-minute durations from the prior extraction-fix work — included deliberately,
matching this project's established "never leave the user guessing, disclose real constraints"
discipline rather than letting a long wait go unexplained.

## Wiring

- `UploadStep.tsx`: `{loading && <p className="text-sm">Extracting data…</p>}` becomes
  `{loading && <RotatingLoadingMessage />}`.
- `SampleSelectionStep.tsx`: the per-sample button's label stays static ("Extracting…" — no room
  to rotate text inside a button), but a `<RotatingLoadingMessage />` is added below the button
  list, shown whenever `loadingId !== null`.

## Testing

- A unit test for `RotatingLoadingMessage` using Vitest's fake timers: renders the first message
  immediately, advances the mock clock by one interval, confirms the message changed to the
  second in the list, and confirms it wraps back to the first after cycling through all of them.
- No changes needed to `UploadStep.tsx`/`SampleSelectionStep.tsx`'s existing tests (if any exist)
  beyond confirming the new component renders in the loading state — this is a visual/text swap,
  not a behavior change to either component's existing logic.
