# Landfill Category Citation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the landfill-category decision (Checkbox1/2/3) in real, live-verified citations
(Avfallsforskriften § 9-5 + § 9-6), reusing the existing compliance mechanism unchanged, and
generalize `LegalCitationView` to carry more than one paragraph so future multi-paragraph fields
don't need another reshape.

**Architecture:** `LegalCitationView` changes from one flat paragraph's data to `{ citations:
SingleCitation[] }`, with one `SingleCitation` flagged `primary` (the paragraph a dispute
anchors on). `resolve-legal-citations.ts`'s config becomes multi-location per field key, all-or-
nothing (a multi-paragraph field only shows a citation once every one of its paragraphs
resolves — never a partial/misleading set). `LegalCitationBadge` gains a `variant` prop:
`"full"` (unchanged rendering, now looping over `citations`) and `"collapsed"` (a compact,
click-to-expand indicator for Checkbox1/2/3's two unchecked boxes — same citation content,
never a degraded one). No changes needed to `app/api/data-lab/route.ts`,
`reclassify/route.ts`, or `analyse-bundle.ts` — the `legalCitations` map they already thread
through is generic per-key, so a new key just flows through unchanged.

**Tech Stack:** TypeScript, Next.js, React, Vitest — all already in place.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-04-landfill-category-citation-design.md`. Builds on
  `docs/superpowers/plans/2026-09-04-compliance-trust-model.md` (all commits through `27dbf19`).
- Real legal basis (researched, not assumed): **§ 9-5** ("Kategorier av deponier") defines the
  three landfill categories; **§ 9-6** ("Avfall som tillates deponert på de ulike
  deponikategoriene") is the operative acceptance rule. Both from Avfallsforskriften,
  `documentId: "avfallsforskriften"` (same document Phase 1 already seeds § 11-4 from — no new
  adapter work).
- A multi-paragraph field is **all-or-nothing**: if any one of its locations fails to resolve
  (genuine `no_match`, or a compliance-layer error), the whole field's citation is `null` —
  never a partial set that could look complete but isn't.
- **Dispute anchors on the `primary` paragraph** — § 9-6 for the new field (the operative rule;
  § 9-5 is definitional scaffolding it depends on). Exactly one `SingleCitation` per field is
  `primary: true`.
- **Disclosed, not solved:** `CorrectionStore.hasUnresolved(paragraphId)` scopes by paragraph id
  alone. Today that's fine — § 9-6 has exactly one consumer (this field). If a future field ever
  reuses § 9-6, a dispute raised here would surface there too; the likely eventual fix is scoping
  by `(paragraphId, resolvedFieldKey)` composite instead. Not built now — flagged in this plan's
  own Known follow-ups, not silently risked.
- Collapsed badge variant must render the *same* citation content as the full variant, just
  compact — the collapsed indicator itself is the click target (no separate "why?" link), and it
  must never read as hidden or less trustworthy than the full badge.
- Every task ends green on `pnpm test` (`npx vitest run`) and `pnpm build`, matching this repo's
  existing verification standard. **Task 1 is a single, atomically-landed breaking type change**
  (`LegalCitationView`'s new shape plus its only two consumers, the badge component and
  Checkbox10) — split across three commits within one task rather than three separate tasks,
  specifically so no intermediate commit leaves the build broken.

---

### Task 1: `LegalCitationView` becomes multi-paragraph — type, badge, and Checkbox10 (atomic)

**Files:**
- Modify: `lib/compliance/citation-view.ts`
- Modify: `tests/compliance/citation-view.test.ts` (rewrite for the new signature — every
  existing test in this file needs updating, not just adding new ones)
- Modify: `components/data-lab/LegalCitationBadge.tsx`
- Modify: `lib/bk-skjema/form-map.ts` (Checkbox10 entry only)
- Modify: `components/data-lab/FieldsPane.tsx` (the `onDispute`/`handleDispute` wiring, if it
  references the old flat shape directly)
- Modify: `tests/bk-skjema/from-datalab.test.ts` (the two Checkbox10 tests from the trust-model
  plan need their `legalCitations` fixture updated to the new shape)
- Modify: `app/data-lab/page.tsx` (its `handleDispute`, from the trust-model plan's Task 5, reads
  `field.legalCitation.paragraphId` — that field no longer exists on the new shape)

**Interfaces:**
- Consumes: `LegalParagraph` from `lib/compliance/types.ts` (unmodified).
- Produces: `export interface SingleCitation { paragraphId: string; label: string; sourceLink:
  string; verifiedAt: string; disputed: boolean; primary: boolean }`, `export interface
  LegalCitationView { citations: SingleCitation[] }`, `export function buildLegalCitationView(
  paragraphs: { paragraph: LegalParagraph; primary: boolean }[], disputedByParagraphId:
  Record<string, boolean>): LegalCitationView` — consumed by Task 2
  (`resolve-legal-citations.ts`). `LegalCitationBadge` now takes `{ citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void>; variant?: "full" | "collapsed"
  }` (default `"full"`) — consumed by Task 3's Checkbox1/2/3 wiring (`variant="collapsed"` for
  the two unchecked boxes).

This task's UI half (`LegalCitationBadge`) has no dedicated rendering test file (this repo has no
React component-rendering test harness — the same situation the trust-model plan's own Task 4
already established and disclosed; `canSubmitDispute` is already covered and is untouched by the
`variant` addition). The `"collapsed"` variant gets its first real manual verification in Task 4,
once Checkbox1/2/3 actually render it.

- [ ] **Step 1: Write the failing citation-view tests (full rewrite of the existing file)**

```ts
// tests/compliance/citation-view.test.ts
import { describe, it, expect } from "vitest";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import type { LegalParagraph } from "@/lib/compliance/types";

const paragraph9_5: LegalParagraph = {
  id: "no-avfallsforskriften-9-5", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "9", paragraph: "5",
  text: "Deponier deles inn i følgende kategorier...", inForce: true,
  lastVerifiedAt: "2026-09-04T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5",
};

const paragraph9_6: LegalParagraph = {
  id: "no-avfallsforskriften-9-6", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "9", paragraph: "6",
  text: "Avfall som tillates deponert på de ulike deponikategoriene...", inForce: true,
  lastVerifiedAt: "2026-09-04T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6",
};

describe("buildLegalCitationView", () => {
  it("builds one SingleCitation per paragraph, in the order given", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      {}
    );
    expect(view.citations).toHaveLength(2);
    expect(view.citations[0].label).toBe("Avfallsforskriften § 9-5");
    expect(view.citations[1].label).toBe("Avfallsforskriften § 9-6");
  });

  it("falls back to the raw documentId when it isn't in the known label map", () => {
    const unknownDoc: LegalParagraph = { ...paragraph9_5, documentId: "some-future-forskrift", article: "3", paragraph: "1" };
    const view = buildLegalCitationView([{ paragraph: unknownDoc, primary: true }], {});
    expect(view.citations[0].label).toBe("some-future-forskrift § 3-1");
  });

  it("passes through paragraphId, sourceLink, and verifiedAt unchanged per citation", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_6, primary: true }], {});
    expect(view.citations[0].paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(view.citations[0].sourceLink).toBe("https://lovdata.no/forskrift/2004-06-01-930/§9-6");
    expect(view.citations[0].verifiedAt).toBe("2026-09-04T00:00:00.000Z");
  });

  it("marks exactly the citation flagged primary, and no other, as primary", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      {}
    );
    expect(view.citations[0].primary).toBe(false);
    expect(view.citations[1].primary).toBe(true);
  });

  it("looks up disputed status per paragraph id from the provided map, defaulting to false", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      { "no-avfallsforskriften-9-6": true }
    );
    expect(view.citations[0].disputed).toBe(false);
    expect(view.citations[1].disputed).toBe(true);
  });

  it("a single-paragraph field (e.g. eal-legal-basis) is a one-element citations array", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_5, primary: true }], {});
    expect(view.citations).toHaveLength(1);
    expect(view.citations[0].primary).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: FAIL — the current `buildLegalCitationView(paragraph, disputed)` signature doesn't
match these calls.

- [ ] **Step 3: Rewrite `lib/compliance/citation-view.ts`**

```ts
import type { LegalParagraph } from "@/lib/compliance/types";

export interface SingleCitation {
  paragraphId: string;
  label: string;
  sourceLink: string;
  verifiedAt: string;
  disputed: boolean;
  /** The paragraph a dispute against this field anchors on — exactly one per LegalCitationView. */
  primary: boolean;
}

export interface LegalCitationView {
  citations: SingleCitation[];
}

// Real, sourced document titles for the ids this cache currently seeds. Extend as the seed
// corpus grows — never guess a title for an id not listed here, fall back to the raw documentId
// instead (see DOCUMENT_LABELS[...] ?? paragraph.documentId below).
const DOCUMENT_LABELS: Record<string, string> = {
  avfallsforskriften: "Avfallsforskriften",
};

function buildSingleCitation(paragraph: LegalParagraph, primary: boolean, disputed: boolean): SingleCitation {
  const docLabel = DOCUMENT_LABELS[paragraph.documentId] ?? paragraph.documentId;
  return {
    paragraphId: paragraph.id,
    label: `${docLabel} § ${paragraph.article}-${paragraph.paragraph}`,
    sourceLink: paragraph.sourceLink,
    verifiedAt: paragraph.lastVerifiedAt,
    disputed,
    primary,
  };
}

// Shapes one or more cached LegalParagraphs plus their current dispute state into exactly what
// the UI needs to render an inline citation — kept as a pure function so the UI-facing shape can
// be unit tested without a live Supabase paragraph store or corrections store. A field grounded
// by a single paragraph (e.g. Checkbox10/"eal-legal-basis") passes a one-element array; a field
// grounded by more than one (e.g. Checkbox1/2/3/"deponi-category-basis", § 9-5 + § 9-6) passes
// all of them, in display order, with exactly one flagged primary.
export function buildLegalCitationView(
  paragraphs: { paragraph: LegalParagraph; primary: boolean }[],
  disputedByParagraphId: Record<string, boolean>
): LegalCitationView {
  return {
    citations: paragraphs.map(({ paragraph, primary }) =>
      buildSingleCitation(paragraph, primary, disputedByParagraphId[paragraph.id] ?? false)
    ),
  };
}
```

- [ ] **Step 4: Run the citation-view tests to verify they pass**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Rewrite `components/data-lab/LegalCitationBadge.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { LegalCitationView } from "@/lib/compliance/citation-view";

export function canSubmitDispute(reason: string, raisedBy: string): boolean {
  return reason.trim().length > 0 && raisedBy.trim().length > 0;
}

/**
 * Inline, non-blocking legal citation display. Trust-by-default: the citation is shown and used
 * without any approval step. The only action available is disputing it — no role gating (this
 * app has no per-user identity yet) — which posts a dispute against the citation's `primary`
 * paragraph and never edits any already-frozen record; it only ever adds a new one.
 *
 * `variant="collapsed"` renders a compact, click-to-expand indicator carrying the SAME citation
 * content as `"full"` — never a degraded or hidden version, just compact. Used for fields where
 * more than one rendered outcome shares one citation (e.g. Checkbox1/2/3), so the reasoning isn't
 * printed three times over on the unchecked outcomes.
 */
export function LegalCitationBadge({
  citation,
  onDispute,
  variant = "full",
}: {
  citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void>;
  variant?: "full" | "collapsed";
}) {
  const [expanded, setExpanded] = useState(variant === "full");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justDisputed, setJustDisputed] = useState(false);

  const disputed = citation.citations.some(c => c.disputed) || justDisputed;
  const primaryLabel = citation.citations.find(c => c.primary)?.label ?? citation.citations[0]?.label ?? "";

  async function submit() {
    if (!canSubmitDispute(reason, raisedBy)) return;
    setSubmitting(true);
    try {
      await onDispute(reason.trim(), raisedBy.trim());
      setJustDisputed(true);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (variant === "collapsed" && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-forest/40 underline decoration-dotted underline-offset-2 hover:text-forest/70"
      >
        {disputed && <span className="mr-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">disputed</span>}
        same legal basis as &ldquo;{primaryLabel}&rdquo;
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11px]">
      {citation.citations.map(c => (
        <div key={c.paragraphId} className="flex items-center gap-1.5">
          {c.disputed && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800" title="This citation has an unresolved dispute">
              disputed
            </span>
          )}
          <a
            href={c.sourceLink}
            target="_blank"
            rel="noreferrer"
            className="text-forest/60 underline decoration-dotted underline-offset-2 hover:text-forest"
          >
            {c.label}
          </a>
          <span className="text-forest/35">verified {new Date(c.verifiedAt).toLocaleDateString("no-NO")}</span>
        </div>
      ))}
      {!disputed && (
        <button type="button" onClick={() => setOpen(v => !v)} className="self-start text-forest/40 underline decoration-dotted hover:text-forest/70">
          I disagree
        </button>
      )}

      {open && (
        <div className="flex flex-col gap-1 rounded-lg border border-forest/15 bg-white/60 p-2">
          <input
            value={raisedBy}
            onChange={e => setRaisedBy(e.target.value)}
            placeholder="Your name"
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why doesn't this citation apply here?"
            rows={2}
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={!canSubmitDispute(reason, raisedBy) || submitting}
            onClick={submit}
            className="self-start rounded bg-forest px-2 py-1 text-[11px] text-lime disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit dispute"}
          </button>
        </div>
      )}
    </div>
  );
}
```

Note the collapsed→expanded transition is one-way local state (`expanded`) — once a person
expands it, it stays expanded for that render; this matches "compact by default, never hidden"
rather than a toggle that could re-collapse content someone is reading.

- [ ] **Step 6: Run `tests/compliance/legal-citation-badge.test.tsx` to confirm no regression**

Run: `npx vitest run tests/compliance/legal-citation-badge.test.tsx`
Expected: PASS — the 4 `canSubmitDispute` tests are untouched by this change and still pass.

- [ ] **Step 7: Update the Checkbox10 test fixture in `tests/bk-skjema/from-datalab.test.ts`**

Find the test added by the trust-model plan (`grep -n "legalCitations:" tests/bk-skjema/from-datalab.test.ts`).
Its fixture currently looks like:

```ts
legalCitations: {
  "eal-legal-basis": {
    paragraphId: "no-avfallsforskriften-11-4",
    label: "Avfallsforskriften § 11-4",
    sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
    verifiedAt: "2026-09-03T19:26:14.030Z",
    disputed: false,
  },
},
```

Replace it with the new shape:

```ts
legalCitations: {
  "eal-legal-basis": {
    citations: [{
      paragraphId: "no-avfallsforskriften-11-4",
      label: "Avfallsforskriften § 11-4",
      sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
      verifiedAt: "2026-09-03T19:26:14.030Z",
      disputed: false,
      primary: true,
    }],
  },
},
```

The test's assertion `expect(checkbox10.legalCitation?.paragraphId).toBe(...)` needs updating to
`expect(checkbox10.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-11-4")`.

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — `form-map.ts`'s Checkbox10 entry still builds `note` from the old flat shape
(`.label` directly on the object, not `.citations[0].label`).

- [ ] **Step 9: Update Checkbox10's entry in `lib/bk-skjema/form-map.ts`**

Find the current entry (`grep -n "Checkbox10" lib/bk-skjema/form-map.ts`) and replace its
`note`/`legalCitation` lines:

```ts
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived", check: true,
      // Compliance trust model: legalCitation is resolved server-side and passed in via
      // s.legalCitations["eal-legal-basis"]. LegalCitationView now carries a `citations` array
      // so multi-paragraph fields (e.g. Checkbox1/2/3) can share the same shape — Checkbox10 is
      // a one-element case. The note stays truthful either way: it names the real primary
      // citation when one was resolved this time, and falls back to the plain classification
      // note when it wasn't — never claims a citation that isn't attached.
      legalCitation: s.legalCitations?.["eal-legal-basis"] ?? null,
      note: s.legalCitations?.["eal-legal-basis"]?.citations[0]
        ? `hazardous substances detected above LOQ, though all below HP thresholds. Rettslig grunnlag: ${s.legalCitations["eal-legal-basis"]!.citations[0].label}.`
        : "hazardous substances detected above LOQ, though all below HP thresholds" },
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — all tests in the file pass, including the 103-field-count invariant.

- [ ] **Step 11: Fix `app/data-lab/page.tsx`'s `handleDispute`**

Find it (`grep -n "handleDispute" app/data-lab/page.tsx`). It currently reads
`field.legalCitation.paragraphId` to build the dispute request body. Change it to read the
*primary* citation's paragraph id:

```ts
const primary = field.legalCitation?.citations.find(c => c.primary) ?? field.legalCitation?.citations[0];
if (!primary) return;
// ...use primary.paragraphId in place of the old field.legalCitation.paragraphId
```

Read the surrounding function fully first — match its existing structure/error-handling exactly
(this is the same file the trust-model plan's Task 5 already wired, following its own
conventions; don't restructure anything beyond this one field-access change).

- [ ] **Step 12: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass (same pre-existing unrelated failures only).

Run: `pnpm build`
Expected: compiles successfully. If `components/data-lab/FieldsPane.tsx` itself references the
old flat shape anywhere (e.g. `f.legalCitation.paragraphId` directly rather than only passing
`f.legalCitation` through to `LegalCitationBadge`), fix it here too — read the file fully to
check before concluding the build is clean.

- [ ] **Step 13: Commit — one commit for the whole atomic reshape**

```bash
git add lib/compliance/citation-view.ts tests/compliance/citation-view.test.ts \
        components/data-lab/LegalCitationBadge.tsx lib/bk-skjema/form-map.ts \
        components/data-lab/FieldsPane.tsx tests/bk-skjema/from-datalab.test.ts \
        app/data-lab/page.tsx
git commit -m "feat(compliance): LegalCitationView becomes multi-paragraph, badge gets a collapsed variant

Landed as one commit rather than split across tasks: the type change breaks
every consumer's compile simultaneously (form-map.ts's Checkbox10 note
construction, LegalCitationBadge's props, app/data-lab/page.tsx's dispute
handler), so splitting it would leave an intermediate commit with a broken
build.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `resolve-legal-citations.ts` — multi-location config and all-or-nothing resolution

**Files:**
- Modify: `lib/compliance/resolve-legal-citations.ts`
- Modify: `tests/compliance/resolve-legal-citations.test.ts`

**Interfaces:**
- Consumes: `buildLegalCitationView` (Task 1, new signature), `search` (Phase 1, unmodified).
- Produces: `resolveLegalCitations`/`resolveLegalCitationsWithTimeout` keep their existing
  exported names and `Promise<Record<string, LegalCitationView | null>>` return type (the
  route-level callers in `app/api/data-lab/route.ts` and `reclassify/route.ts` are completely
  unaffected — they treat this as an opaque map) — only the internal `RESOLVED_FIELDS` config
  shape and resolution loop change.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/compliance/resolve-legal-citations.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveLegalCitations } from "@/lib/compliance/resolve-legal-citations";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalParagraph } from "@/lib/compliance/types";

vi.mock("@/lib/compliance/embeddings", () => ({ embedText: vi.fn().mockResolvedValue([0.1]) }));

const p11_4: LegalParagraph = {
  id: "no-avfallsforskriften-11-4", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig", inForce: true,
  lastVerifiedAt: new Date().toISOString(), lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};
const p9_5: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-9-5", article: "9", paragraph: "5", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5" };
const p9_6: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-9-6", article: "9", paragraph: "6", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6" };

function fakeStore(rows: LegalParagraph[]): ParagraphStore {
  return {
    async findByLocation(d, a, p) { return rows.find(r => r.documentId === d && r.article === a && r.paragraph === p) ?? null; },
    async hybridSearch() { throw new Error("not used in this test"); },
    async insert() {},
  };
}

describe("resolveLegalCitations", () => {
  it("resolves eal-legal-basis (single location) to a one-element citations array", async () => {
    const store = fakeStore([p11_4]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.citations).toHaveLength(1);
    expect(result["eal-legal-basis"]?.citations[0].paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(result["eal-legal-basis"]?.citations[0].primary).toBe(true);
  });

  it("resolves deponi-category-basis (two locations) to a two-element citations array, § 9-6 primary", async () => {
    const store = fakeStore([p11_4, p9_5, p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["deponi-category-basis"]?.citations).toHaveLength(2);
    const primary = result["deponi-category-basis"]?.citations.find(c => c.primary);
    expect(primary?.paragraphId).toBe("no-avfallsforskriften-9-6");
  });

  it("is all-or-nothing: if one of a multi-location field's paragraphs is missing, the whole field is null", async () => {
    // Only § 9-5 present, § 9-6 missing.
    const store = fakeStore([p11_4, p9_5]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["deponi-category-basis"]).toBeNull();
  });

  it("checks dispute status independently per paragraph within a multi-location field", async () => {
    const store = fakeStore([p11_4, p9_5, p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = {
      raise: vi.fn(),
      hasUnresolved: vi.fn().mockImplementation(async (id: string) => id === "no-avfallsforskriften-9-6"),
    };

    const result = await resolveLegalCitations(store, source, corrections);
    const citations = result["deponi-category-basis"]?.citations ?? [];
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-5")?.disputed).toBe(false);
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-6")?.disputed).toBe(true);
  });

  it("returns eal-legal-basis: null, never throws, when the underlying search fails", async () => {
    const store: ParagraphStore = {
      async findByLocation() { throw new Error("supabase unreachable"); },
      async hybridSearch() { throw new Error("not used"); },
      async insert() {},
    };
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn() };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]).toBeNull();
    expect(result["deponi-category-basis"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: FAIL — `result["deponi-category-basis"]` doesn't exist yet; the old single-location
config/logic doesn't match these shapes.

- [ ] **Step 3: Rewrite `lib/compliance/resolve-legal-citations.ts`**

```ts
// lib/compliance/resolve-legal-citations.ts
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalCitationView } from "@/lib/compliance/citation-view";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import { search } from "@/lib/compliance/search";
import type { LegalParagraph } from "@/lib/compliance/types";

interface ResolvedFieldLocation {
  documentId: string;
  article: string;
  paragraph: string;
  queryText: string;
  /** Exactly one location per field must set this true — the paragraph a dispute anchors on. */
  primary?: boolean;
}

interface ResolvedFieldConfig {
  key: string;
  locations: ResolvedFieldLocation[];
}

// Every field this codebase grounds. Extending this list is real, deliberate work (see each
// plan's Known follow-ups) — do not silently expand it without also updating BkField's callers
// in form-map.ts. A field with more than one location is resolved all-or-nothing (see
// resolveLegalCitations below) — never a partial citation set.
const RESOLVED_FIELDS: ResolvedFieldConfig[] = [
  {
    key: "eal-legal-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "4", queryText: "farlig avfall håndtering", primary: true },
    ],
  },
  {
    key: "deponi-category-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "5", queryText: "kategorier av deponier" },
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
];

// Resolves every field this codebase grounds into a real, live-verified citation, checking
// dispute state per paragraph. A multi-location field only produces a citation once EVERY one of
// its locations resolves — a partial set could look complete when it isn't, so it's null instead.
// A failure anywhere in the compliance layer (Supabase down, Voyage down, a genuine no_match)
// degrades that field to null rather than throwing — the surrounding extraction pipeline must
// never break because the compliance layer had a bad day.
export async function resolveLegalCitations(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore
): Promise<Record<string, LegalCitationView | null>> {
  const result: Record<string, LegalCitationView | null> = {};
  for (const field of RESOLVED_FIELDS) {
    try {
      const resolved: { paragraph: LegalParagraph; primary: boolean }[] = [];
      for (const location of field.locations) {
        const grounded = await search(store, source, {
          queryText: location.queryText,
          documentId: location.documentId,
          article: location.article,
          paragraph: location.paragraph,
        });
        if (!grounded.paragraph) {
          resolved.length = 0; // all-or-nothing: one miss invalidates the whole field
          break;
        }
        resolved.push({ paragraph: grounded.paragraph, primary: location.primary === true });
      }
      if (resolved.length !== field.locations.length) {
        result[field.key] = null;
        continue;
      }
      const disputedByParagraphId: Record<string, boolean> = {};
      for (const { paragraph } of resolved) {
        disputedByParagraphId[paragraph.id] = await corrections.hasUnresolved(paragraph.id);
      }
      result[field.key] = buildLegalCitationView(resolved, disputedByParagraphId);
    } catch {
      // Never let a compliance-layer failure break the surrounding extraction pipeline.
      result[field.key] = null;
    }
  }
  return result;
}

/**
 * Same as resolveLegalCitations, but bounded: resolution is hoisted to run once, before the
 * stream/response starts, so a hung dependency (Voyage, Lovdata, Supabase — none of which have
 * their own timeout) would otherwise stall the entire request until the route's own maxDuration
 * kills it. Racing against a short timeout that degrades to {} keeps that risk localized to this
 * one call, matching resolveLegalCitations's own contract of degrading rather than throwing.
 */
export async function resolveLegalCitationsWithTimeout(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore,
  timeoutMs = 5000
): Promise<Record<string, LegalCitationView | null>> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      resolveLegalCitations(store, source, corrections),
      new Promise<Record<string, LegalCitationView | null>>(resolve => {
        timer = setTimeout(() => resolve({}), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
```

Note: this task adds the real `"deponi-category-basis"` config entry directly (§ 9-5 + § 9-6) —
its own tests exercise it against a fake store, so it's covered before the real paragraphs are
even seeded (Task 3 seeds them for real). This is deliberately safe: until Task 3 seeds the
paragraphs, `resolveLegalCitations` in the real running app will genuinely get a `no_match` on
these two locations (or a real live Lovdata fetch attempt) and correctly return `null` for
`"deponi-category-basis"` — never break, just no citation yet, exactly the "never fabricate,
honest gap" behavior this whole system is built around.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass (same pre-existing unrelated failures only).

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add lib/compliance/resolve-legal-citations.ts tests/compliance/resolve-legal-citations.test.ts
git commit -m "feat(compliance): multi-location, all-or-nothing field resolution; add deponi-category-basis config

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Seed § 9-5 and § 9-6

**Files:**
- Modify: `scripts/seed-lovdata.ts`
- Modify: `tests/compliance/seed-lovdata.test.ts`

**Interfaces:**
- Consumes: `LovdataSource` (Phase 1, unmodified — same document, `avfallsforskriften`, so no
  new adapter research is needed; the real archive structure was already confirmed in Phase 1's
  Task 3).
- Produces: nothing new consumed by later tasks — extends the existing seed script's coverage.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/compliance/seed-lovdata.test.ts (extend the existing file — do not remove its current tests)
import { describe, it, expect } from "vitest";
import { buildSeedLocations } from "@/scripts/seed-lovdata";

describe("buildSeedLocations", () => {
  it("returns at least the § 11-4 hazardous-waste-handling location for Avfallsforskriften", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "11", paragraph: "4" });
  });

  it("also returns § 9-5 and § 9-6 for the landfill-category citation", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "9", paragraph: "5" });
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "9", paragraph: "6" });
  });

  it("every location has a non-empty article and paragraph", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    for (const loc of locations) {
      expect(loc.article.length).toBeGreaterThan(0);
      expect(loc.paragraph.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run tests/compliance/seed-lovdata.test.ts`
Expected: FAIL on the "§ 9-5 and § 9-6" test — `buildSeedLocations` only returns § 11-4 today.

- [ ] **Step 3: Extend `buildSeedLocations` in `scripts/seed-lovdata.ts`**

```ts
// The paragraphs this codebase seeds. Extend this list once more of the seed corpus is added —
// see each plan's Known follow-ups for what still needs a real citation.
export function buildSeedLocations(documentId: string): { documentId: string; article: string; paragraph: string }[] {
  return [
    { documentId, article: "11", paragraph: "4" }, // hazardous-waste handling obligation (Checkbox10)
    { documentId, article: "9", paragraph: "5" },  // landfill categories (Checkbox1/2/3)
    { documentId, article: "9", paragraph: "6" },  // waste permitted per landfill category (Checkbox1/2/3)
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/seed-lovdata.test.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 6: Actually run the seed script against real infrastructure**

Requires real `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY` in `.env.local` (all
already populated and proven working earlier on this branch). Run:

```bash
node --env-file=.env.local ./node_modules/.bin/tsx scripts/seed-lovdata.ts
```

Expected: three `Seeded no-avfallsforskriften-...` lines (11-4 already seeded from Phase 1 — a
second insert attempt against an existing `id` primary key will fail with a real Postgres
conflict error; if that happens, this is expected for the ALREADY-seeded § 11-4 row, not a bug —
confirm § 9-5 and § 9-6 seed successfully by checking the script's per-location output, and note
in your report whether § 11-4's re-seed attempt errored as expected. If the whole script exits
non-zero because of that, that's a real, pre-existing gap this task should NOT silently paper
over — report it as a concern (the seed script isn't idempotent) rather than fixing it
unilaterally, since fixing idempotency is out of this task's scope).

- [ ] **Step 7: Verify via SQL**

Use the Supabase MCP `execute_sql` tool against project_id `zrexxdnlonleijhlmnjp`:

```sql
select id, article, paragraph, verification_status from legal_paragraphs order by article, paragraph;
```

Expected: three rows, including `no-avfallsforskriften-9-5` and `no-avfallsforskriften-9-6`.

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-lovdata.ts tests/compliance/seed-lovdata.test.ts
git commit -m "feat(compliance): seed Avfallsforskriften § 9-5 and § 9-6

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire Checkbox1/2/3 to `deponi-category-basis`, checked-full/unchecked-collapsed

**Files:**
- Modify: `lib/bk-skjema/form-map.ts` (Checkbox1/2/3 entries)
- Modify: `components/data-lab/FieldsPane.tsx` (render `variant="collapsed"` for an unchecked
  field whose citation is shared with a checked sibling)
- Modify: `tests/bk-skjema/from-datalab.test.ts` (new tests for Checkbox1/2/3's citation wiring)

**Interfaces:**
- Consumes: `LegalCitationView`/`SingleCitation`/`LegalCitationBadge`'s `variant` prop (Task 1),
  `s.legalCitations?.["deponi-category-basis"]` (Task 2's real config, Task 3's real seeded
  data).
- Produces: nothing new consumed by later tasks — this is the plan's final, integrating task.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bk-skjema/from-datalab.test.ts`, following the exact fixture pattern the existing
Checkbox10 tests already use (found and matched in Task 1, Step 7 of this plan):

```ts
  it("Checkbox1/2/3 all carry the same deponi-category-basis citation when one is resolved", () => {
    const citation = {
      citations: [
        { paragraphId: "no-avfallsforskriften-9-5", label: "Avfallsforskriften § 9-5", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5", verifiedAt: "2026-09-04T00:00:00.000Z", disputed: false, primary: false },
        { paragraphId: "no-avfallsforskriften-9-6", label: "Avfallsforskriften § 9-6", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6", verifiedAt: "2026-09-04T00:00:00.000Z", disputed: false, primary: true },
      ],
    };
    const source: BkSource = {
      /* ...same minimal fixture the existing Checkbox10 tests use... */
      legalCitations: { "deponi-category-basis": citation },
    } as BkSource;
    const fields = buildBkFields(source);
    const checkbox1 = fields.find(f => f.field === "Checkbox1")!;
    const checkbox2 = fields.find(f => f.field === "Checkbox2")!;
    const checkbox3 = fields.find(f => f.field === "Checkbox3")!;
    expect(checkbox1.legalCitation?.citations).toHaveLength(2);
    expect(checkbox2.legalCitation?.citations).toHaveLength(2);
    expect(checkbox3.legalCitation?.citations).toHaveLength(2);
  });

  it("Checkbox1/2/3 have no legalCitation when deponi-category-basis wasn't resolved", () => {
    const source: BkSource = { /* ...same minimal fixture, no legalCitations key... */ } as BkSource;
    const fields = buildBkFields(source);
    expect(fields.find(f => f.field === "Checkbox1")!.legalCitation ?? null).toBeNull();
    expect(fields.find(f => f.field === "Checkbox2")!.legalCitation ?? null).toBeNull();
    expect(fields.find(f => f.field === "Checkbox3")!.legalCitation ?? null).toBeNull();
  });
```

Fill in the fixture spots using the exact pattern found earlier in this plan — don't invent a
new one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: FAIL — Checkbox1/2/3 don't read `legalCitations` yet.

- [ ] **Step 3: Wire Checkbox1/2/3 in `lib/bk-skjema/form-map.ts`**

Find the current entries (`grep -n "Checkbox1\"\\|Checkbox2\"\\|Checkbox3\"" lib/bk-skjema/form-map.ts`)
and replace them:

```ts
    { field: "Checkbox1", label: "Deponi for ordinært avfall", src: "derived", check: !s.isHazardous,
      // Same shared citation as Checkbox2/3 — see the comment on Checkbox3 below for why.
      legalCitation: s.legalCitations?.["deponi-category-basis"] ?? null,
      note: "CONSERVATIVE: inert cannot be claimed without a leaching test" },
    { field: "Checkbox2", label: "Deponi for inert avfall", src: "derived", check: false,
      legalCitation: s.legalCitations?.["deponi-category-basis"] ?? null,
      note: "requires ristetest/kolonnetest results, which a standard total-analysis report lacks" },
    // Checkbox1/2/3 are mutually exclusive outcomes of ONE classification decision (which
    // landfill category this waste belongs in), so they share ONE resolved citation
    // ("deponi-category-basis", § 9-5 + § 9-6) rather than each having its own — the citation
    // grounds the decision, not any one checkbox's specific state. All three carry it (not just
    // whichever is checked) so a reviewer can see the same basis regardless of which outcome the
    // classifier landed on, and dispute the classification itself if they think it landed wrong.
    { field: "Checkbox3", label: "Deponi for farlig avfall", src: "derived", check: s.isHazardous,
      legalCitation: s.legalCitations?.["deponi-category-basis"] ?? null },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/bk-skjema/from-datalab.test.ts`
Expected: PASS — all tests pass, including the 103-field-count invariant (this task only adds
`legalCitation`, doesn't add/remove fields).

- [ ] **Step 5: Wire the checked/collapsed variant split into `components/data-lab/FieldsPane.tsx`**

Read the file's current rendering block (found in the trust-model plan's Task 4, unchanged
through Task 1 of this plan):

```tsx
                    {f.legalCitation && onDispute && (
                      <LegalCitationBadge
                        citation={f.legalCitation}
                        onDispute={(reason, raisedBy) => onDispute(f, reason, raisedBy)}
                      />
                    )}
```

Replace it with a version that renders `"collapsed"` for an unchecked field sharing its citation
with a checked sibling, `"full"` otherwise (this correctly keeps Checkbox10 — the only checkbox
where nothing else shares its citation — always `"full"`, and only affects Checkbox1/2/3):

```tsx
                    {f.legalCitation && onDispute && (
                      <LegalCitationBadge
                        citation={f.legalCitation}
                        onDispute={(reason, raisedBy) => onDispute(f, reason, raisedBy)}
                        variant={f.field.startsWith("Checkbox") && !valueOf(f) ? "collapsed" : "full"}
                      />
                    )}
```

This reuses `valueOf(f)` (already defined earlier in this same file, used by the existing
`value`/checkbox rendering) — `valueOf` returns `null` for an unchecked checkbox, so
`!valueOf(f)` is exactly "this checkbox is currently false." Confirm `valueOf` is in scope at
this point in the file (it is — it's a module-level function in this same file) before using it
here.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass (same pre-existing unrelated failures only).

Run: `pnpm build`
Expected: compiles successfully.

- [ ] **Step 7: Manual verification**

Run `pnpm dev` (or reuse the running instance), upload a real waste characterization report
through Data Lab, and confirm: Checkbox3 (or whichever of 1/2/3 ends up checked for that
sample) shows the full badge with BOTH § 9-5 and § 9-6 listed; the other two show the collapsed
"same legal basis as..." indicator; clicking a collapsed indicator expands it to the identical
two-paragraph citation; "I disagree" on any of the three raises a dispute against § 9-6 (confirm
via `execute_sql`: `select disputed_paragraph_id from compliance_corrections order by raised_at desc limit 1;`
shows `no-avfallsforskriften-9-6`, not § 9-5).

- [ ] **Step 8: Commit**

```bash
git add lib/bk-skjema/form-map.ts components/data-lab/FieldsPane.tsx tests/bk-skjema/from-datalab.test.ts
git commit -m "feat(compliance): ground Checkbox1/2/3 in § 9-5 + § 9-6, checked-full/unchecked-collapsed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Known follow-ups this plan surfaces but does not resolve

1. **Cross-field dispute-scoping collision** (spec, disclosed): `hasUnresolvedDispute()` scopes
   by paragraph id alone. § 9-6 has one consumer today; if a future field reuses it, disputes
   would leak across fields. Likely eventual fix: composite `(paragraphId, resolvedFieldKey)`
   scoping — not built now.
2. **Seed script isn't idempotent** (surfaced in Task 3, not fixed): re-running
   `scripts/seed-lovdata.ts` against an already-seeded paragraph errors on the primary-key
   conflict rather than skipping or upserting. Real gap, deliberately out of this plan's scope —
   fix before this script is run routinely rather than once per new paragraph batch.
3. **Only two fields grounded now** (Checkbox10, Checkbox1/2/3) out of 100+ on the BK-skjema.
   Extending further needs the same real-research-per-paragraph discipline this plan and its
   predecessor both followed — no shortcut exists or should be built.
