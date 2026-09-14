# Vedlegg/Annex Addressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `LovdataSource` fetch and cache a Vedlegg (annex) section of Avfallsforskriften — specifically kap. 11's Vedlegg 2, the real HP1-15 criteria table § 11-2 references but does not itself contain — and attach it as a second citation location on the existing `hp-methodology-basis` field.

**Architecture:** A Vedlegg location is addressed with the existing `{documentId, article, paragraph}` shape (`article` = human chapter number, `paragraph` = `"vedlegg-<label>"`), so the paragraph store, search, and resolve-legal-citations layers need zero structural changes. Only the archive parser (new `parseVedleggFromHtml`, disambiguated by a small confirmed chapter-internal-id map) and the citation-label formatter change.

**Tech Stack:** TypeScript, Vitest, Supabase (paragraph cache), Lovdata (`LovdataSource`), Voyage embeddings (`embedText`).

## Global Constraints

- Never fabricate: `parseVedleggFromHtml` returns `null` when the requested label/chapter combination isn't found — never a wrong section's content, never a guessed chapter mapping.
- `CHAPTER_INTERNAL_ID` contains ONLY the two entries confirmed by direct archive inspection this session: `"9": "11"`, `"11": "14"`. Do not add entries for chapters not independently verified.
- A Vedlegg's real, correct public URL is its own `data-lovdata-URL` attribute value (with the leading `SF/` dropped) — confirmed live (`https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2` resolves to the correct Vedlegg 2). A bare `/vedlegg2`-style URL is AMBIGUOUS even on the real site (confirmed: it resolves to chapter 1's Vedlegg 2, not chapter 11's) — never construct a sourceLink from just the label.
- The boundary between a Vedlegg's own content and the next unrelated section is: the next `<section class="section"` tag whose `id` does NOT start with the found vedlegg's own `id` as a prefix. An `id` that DOES nest under it (a real, confirmed case — e.g. kap. 1's Vedlegg 2 nests a `data-name="delA"` subsection) is part of the same vedlegg's content, not a boundary.
- `hp-methodology-basis` stays all-or-nothing across its (now two) locations — if either § 11-2 or Vedlegg 2 fails to resolve, the whole field degrades to `null`, same contract as every other multi-location field.
- Vedlegg 2's real text is ~54KB. Do not add speculative chunking/truncation logic — attempt the real seed step for real and handle whatever actually happens (same practice as the previous cycle's real Voyage 429 handling).

---

## Task 1: Vedlegg parsing in lovdata-archive.ts

**Files:**
- Modify: `lib/compliance/sources/lovdata-archive.ts`
- Test: `tests/compliance/sources/lovdata-archive.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses the existing `ParagraphResult` interface (`{text, lastChangedAt, sourceLink}`) already defined in this file, and the existing `stripTags` helper.
- Produces: `parseVedleggFromHtml(html: string, internalChapterId: string, vedleggLabel: string): ParagraphResult | null`, exported for direct testing. `getParagraphFromArchive` now routes to it when `query.paragraph` starts with `"vedlegg-"`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/compliance/sources/lovdata-archive.test.ts`, after the existing `import` line, add:

```typescript
import { parseVedleggFromHtml, getParagraphFromArchive } from "@/lib/compliance/sources/lovdata-archive";
```

(Add `parseVedleggFromHtml` to the existing import — do not duplicate the import line; merge it into the existing `import { parseParagraphFromHtml } from ...` line.)

Then append this fixture and test block at the end of the file (after the closing `});` of `describe("parseParagraphFromHtml", ...)`):

```typescript
// Reproduces the real archive's confirmed structure: the SAME vedlegg label ("vedlegg2")
// recurs under a DIFFERENT chapter (must not be picked), the target vedlegg has a nested
// <section> belonging to it (must be included, not treated as a boundary), and a genuinely
// different next vedlegg follows (must not bleed in).
const VEDLEGG_FIXTURE = `
<html><body><header><dd class="lastChangeInForce">2026-01-01</dd></header>
<section class="section" data-name="vedlegg2" id="kapittel-9-kapittel-1" data-lovdata-URL="SF/forskrift/2004-06-01-930/KAPITTEL_9-1">
  <h3>Vedlegg 2. Wrong chapter's vedlegg 2</h3>
  <article class="legalP">This is chapter 9's vedlegg 2, must NOT be returned when asking for chapter 14.</article>
</section>
<section class="section" data-name="vedlegg2" id="kapittel-14-kapittel-2" data-lovdata-URL="SF/forskrift/2004-06-01-930/KAPITTEL_14-2">
  <h3>Vedlegg 2. Kriterier som gjør avfall til farlig avfall</h3>
  <article class="legalP" id="kapittel-14-kapittel-2-ledd-1">Real body text for HP criteria.</article>
  <section class="section" data-name="delA" id="kapittel-14-kapittel-2-kapittel-1">
    <article class="legalP">Nested subsection text that must still be included in Vedlegg 2's body.</article>
  </section>
  <article class="legalP" id="kapittel-14-kapittel-2-ledd-2">More real body text after the nested subsection, must also be included.</article>
</section>
<section class="section" data-name="vedlegg3" id="kapittel-14-kapittel-3" data-lovdata-URL="SF/forskrift/2004-06-01-930/KAPITTEL_14-3">
  <h3>Vedlegg 3. A different vedlegg entirely.</h3>
  <article class="legalP">Vedlegg 3 content, must not appear in Vedlegg 2's result.</article>
</section>
</body></html>
`;

describe("parseVedleggFromHtml", () => {
  it("extracts the target chapter's vedlegg, not a same-labeled vedlegg under a different chapter", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "14", "2");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Real body text for HP criteria");
    expect(result!.text).not.toContain("Wrong chapter's vedlegg 2");
  });

  it("includes a nested subsection's content rather than stopping at it as a boundary", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "14", "2");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Nested subsection text that must still be included");
    expect(result!.text).toContain("More real body text after the nested subsection");
  });

  it("stops at the next genuinely different vedlegg, not bleeding its content in", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "14", "2");
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("Vedlegg 3 content");
  });

  it("builds sourceLink from the matched section's own data-lovdata-URL, not a constructed label-only URL", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "14", "2");
    expect(result).not.toBeNull();
    expect(result!.sourceLink).toBe("https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2");
  });

  it("returns null when the requested chapter/label combination doesn't exist", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "99", "2");
    expect(result).toBeNull();
  });

  it("parses the document-level last-changed date the same way parseParagraphFromHtml does", () => {
    const result = parseVedleggFromHtml(VEDLEGG_FIXTURE, "14", "2");
    expect(result).not.toBeNull();
    expect(result!.lastChangedAt).toBe(new Date("2026-01-01").toISOString());
  });
});

describe("getParagraphFromArchive routing", () => {
  it("routes a paragraph starting with 'vedlegg-' through the vedlegg parser using the confirmed chapter map", async () => {
    // This test exercises the real archive download/extraction path (network), matching how
    // this file's other getParagraphFromArchive-level behavior is verified elsewhere in this
    // suite — it requires network access to Lovdata's real archive.
    const result = await getParagraphFromArchive({
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "vedlegg-2",
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain("HP");
  });

  it("returns null for a chapter with no confirmed entry in CHAPTER_INTERNAL_ID, never guessing", async () => {
    const result = await getParagraphFromArchive({
      documentId: "avfallsforskriften",
      article: "3", // not in CHAPTER_INTERNAL_ID
      paragraph: "vedlegg-1",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/sources/lovdata-archive.test.ts`
Expected: FAIL — `parseVedleggFromHtml` is not exported.

- [ ] **Step 3: Implement `parseVedleggFromHtml` and the routing**

In `lib/compliance/sources/lovdata-archive.ts`, add after the existing `AVFALLSFORSKRIFTEN_DOC_ID` constant:

```typescript
// Archive-internal chapter numbering is offset from the human-facing chapter label (same quirk
// already known for §-paragraph ids, e.g. § 9-6's real internal id is kapittel-11-paragraf-6).
// Confirmed by direct inspection of the real archive (2026-09-06) — extend only after
// independently confirming a new chapter's real internal id the same way, never guess.
const CHAPTER_INTERNAL_ID: Record<string, string> = {
  "9": "11",
  "11": "14",
};
```

Add this function after `parseParagraphFromHtml`:

```typescript
// Locates a Vedlegg (annex) section, disambiguated by chapter: the same vedlegg label (e.g.
// "vedlegg2") recurs across multiple unrelated chapters in the real archive, so a bare
// data-name match is not enough — the section's own `id` attribute (which always starts with
// `kapittel-<internalChapterId>-`) is the real disambiguator. Returns null if no section with
// BOTH the right data-name AND the right chapter-id prefix exists — never a wrong chapter's
// same-labeled vedlegg.
export function parseVedleggFromHtml(
  html: string,
  internalChapterId: string,
  vedleggLabel: string
): ParagraphResult | null {
  const marker = `data-name="vedlegg${vedleggLabel}"`;
  let searchFrom = 0;
  let tagStart = -1;
  let sectionId = "";
  let sourceUrl = "";
  for (;;) {
    const markerIdx = html.indexOf(marker, searchFrom);
    if (markerIdx === -1) return null;
    const candidateTagStart = html.lastIndexOf("<section", markerIdx);
    if (candidateTagStart === -1) {
      searchFrom = markerIdx + marker.length;
      continue;
    }
    const tagEnd = html.indexOf(">", candidateTagStart);
    const openTag = html.slice(candidateTagStart, tagEnd + 1);
    const idMatch = openTag.match(/id="([^"]+)"/);
    const candidateId = idMatch ? idMatch[1] : "";
    if (candidateId.startsWith(`kapittel-${internalChapterId}-`)) {
      tagStart = candidateTagStart;
      sectionId = candidateId;
      const urlMatch = openTag.match(/data-lovdata-URL="([^"]+)"/);
      sourceUrl = urlMatch ? urlMatch[1] : "";
      break;
    }
    searchFrom = markerIdx + marker.length;
  }

  // Find the next sibling <section class="section" whose id does NOT nest under this one's id —
  // that's the true end of this vedlegg. An id that DOES nest under it (starts with sectionId +
  // "-") is a subsection belonging to the same vedlegg, not a boundary — keep scanning past it.
  let boundaryIdx = html.length;
  let searchBoundaryFrom = tagStart + 1;
  for (;;) {
    const nextSectionIdx = html.indexOf('<section class="section"', searchBoundaryFrom);
    if (nextSectionIdx === -1) break;
    const nextTagEnd = html.indexOf(">", nextSectionIdx);
    const nextOpenTag = html.slice(nextSectionIdx, nextTagEnd + 1);
    const nextIdMatch = nextOpenTag.match(/id="([^"]+)"/);
    const nextId = nextIdMatch ? nextIdMatch[1] : "";
    if (nextId === sectionId || nextId.startsWith(`${sectionId}-`)) {
      searchBoundaryFrom = nextTagEnd + 1;
      continue;
    }
    boundaryIdx = nextSectionIdx;
    break;
  }

  const sectionHtml = html.slice(tagStart, boundaryIdx);
  const headerEnd = sectionHtml.indexOf("</h3>");
  const bodyHtml = headerEnd === -1 ? sectionHtml : sectionHtml.slice(headerEnd + "</h3>".length);
  const text = stripTags(bodyHtml);
  if (!text) return null;

  const lastChangeMatch = html.match(/<dd class="lastChangeInForce">([^<]+)<\/dd>/);
  const lastChangedAt = lastChangeMatch
    ? new Date(lastChangeMatch[1].trim()).toISOString()
    : new Date(0).toISOString();

  // The real, confirmed-live public URL for a vedlegg is its own data-lovdata-URL value with
  // the leading "SF/" segment dropped — NOT a constructed "vedlegg<label>"-only URL, which is
  // ambiguous even on the real site (confirmed: /forskrift/2004-06-01-930/vedlegg2 resolves to
  // chapter 1's Vedlegg 2, not chapter 11's).
  const sourceLink = `https://lovdata.no/${sourceUrl.replace(/^SF\//, "")}`;

  return { text, lastChangedAt, sourceLink };
}
```

Then modify `getParagraphFromArchive` to route vedlegg-shaped paragraph queries:

```typescript
export async function getParagraphFromArchive(query: {
  documentId: string;
  article: string;
  paragraph: string;
}): Promise<ParagraphResult | null> {
  if (query.documentId !== "avfallsforskriften") return null; // only document seeded in this slice

  const dir = await ensureArchiveExtracted();
  const filePath = join(dir, AVFALLSFORSKRIFTEN_ARCHIVE_PATH);
  const html = await readFile(filePath, "utf-8").catch(() => null);
  if (!html) return null;

  if (query.paragraph.startsWith("vedlegg-")) {
    const internalChapterId = CHAPTER_INTERNAL_ID[query.article];
    if (!internalChapterId) return null; // never guess an unconfirmed chapter's internal id
    const vedleggLabel = query.paragraph.slice("vedlegg-".length);
    return parseVedleggFromHtml(html, internalChapterId, vedleggLabel);
  }

  return parseParagraphFromHtml(html, query.article, query.paragraph);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/sources/lovdata-archive.test.ts`
Expected: PASS — all existing `parseParagraphFromHtml` tests unaffected, all new `parseVedleggFromHtml` tests pass. The two `getParagraphFromArchive routing` tests require real network access to Lovdata's archive (same as this suite's existing network-dependent tests, if any — check by running the full file; if network access is unavailable in this environment, note it in your report and confirm the OTHER tests in this task still pass deterministically).

- [ ] **Step 5: Commit**

```bash
git add lib/compliance/sources/lovdata-archive.ts tests/compliance/sources/lovdata-archive.test.ts
git commit -m "feat: add Vedlegg/annex parsing to LovdataSource, disambiguated by chapter-internal id

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Vedlegg citation label formatting

**Files:**
- Modify: `lib/compliance/citation-view.ts`
- Test: `tests/compliance/citation-view.test.ts`

**Interfaces:**
- Consumes: `LegalParagraph` (unchanged) — `buildSingleCitation` reads `paragraph.paragraph` to decide the label format.
- Produces: no signature change to `buildLegalCitationView`/`buildSingleCitation` — only the label text differs for a vedlegg-shaped paragraph.

- [ ] **Step 1: Write the failing test**

Add to `tests/compliance/citation-view.test.ts`, after the existing `paragraph9_6` fixture declaration, add:

```typescript
const vedlegg2: LegalParagraph = {
  id: "no-avfallsforskriften-11-vedlegg-2", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2",
  text: "Vedlegget skal benyttes for avfallstyper...", inForce: true,
  lastVerifiedAt: "2026-09-06T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2",
};
```

Then add this test inside the existing `describe("buildLegalCitationView", ...)` block, after the last existing `it`:

```typescript
  it("renders a vedlegg-shaped paragraph as 'Vedlegg <label>', not '§ 11-vedlegg-2'", () => {
    const view = buildLegalCitationView([{ paragraph: vedlegg2, primary: false }], {});
    expect(view.citations[0].label).toBe("Avfallsforskriften Vedlegg 2");
  });

  it("still renders an ordinary paragraph's label unchanged, regression coverage", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_6, primary: true }], {});
    expect(view.citations[0].label).toBe("Avfallsforskriften § 9-6");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: FAIL — label is `"Avfallsforskriften § 11-vedlegg-2"`, not `"Avfallsforskriften Vedlegg 2"`.

- [ ] **Step 3: Implement the label branch**

In `lib/compliance/citation-view.ts`, modify `buildSingleCitation`:

```typescript
function buildSingleCitation(paragraph: LegalParagraph, primary: boolean, disputed: boolean): SingleCitation {
  const docLabel = DOCUMENT_LABELS[paragraph.documentId] ?? paragraph.documentId;
  const label = paragraph.paragraph.startsWith("vedlegg-")
    ? `${docLabel} Vedlegg ${paragraph.paragraph.slice("vedlegg-".length)}`
    : `${docLabel} § ${paragraph.article}-${paragraph.paragraph}`;
  return {
    paragraphId: paragraph.id,
    label,
    sourceLink: paragraph.sourceLink,
    verifiedAt: paragraph.lastVerifiedAt,
    disputed,
    primary,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/citation-view.test.ts`
Expected: PASS — all existing tests plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/compliance/citation-view.ts tests/compliance/citation-view.test.ts
git commit -m "feat: render a vedlegg-shaped citation as 'Vedlegg <label>' instead of a malformed §-label

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire Vedlegg 2 into hp-methodology-basis and seed it for real

**Files:**
- Modify: `lib/compliance/resolve-legal-citations.ts`
- Modify: `scripts/seed-lovdata.ts`
- Test: `tests/compliance/resolve-legal-citations.test.ts`
- Test: `tests/compliance/seed-lovdata.test.ts`

**Interfaces:**
- Consumes: `parseVedleggFromHtml`/routing from Task 1 (via `LovdataSource.fetchParagraph`, unchanged signature), the label formatting from Task 2 — neither needs direct importing here, both apply transparently through the existing `resolveLegalCitations`/`search` pipeline.
- Produces: `resolveLegalCitations(...)`'s `"hp-methodology-basis"` entry now has two locations (§ 11-2 and Vedlegg 2), all-or-nothing. `buildSeedLocations("avfallsforskriften")` includes `{documentId, article: "11", paragraph: "vedlegg-2"}`.

- [ ] **Step 1: Write the failing test for the new seed location**

Add to `tests/compliance/seed-lovdata.test.ts`, as a new `it` after the existing `"also returns § 11-2..."` test:

```typescript
  it("also returns the Vedlegg 2 location for the HP-criteria table citation", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2" });
  });
```

- [ ] **Step 2: Write the failing test for the two-location hp-methodology-basis field**

Add to `tests/compliance/resolve-legal-citations.test.ts`. First add a new fixture paragraph near the existing `p11_2` declaration:

```typescript
const pVedlegg2: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-11-vedlegg-2", article: "11", paragraph: "vedlegg-2", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2" };
```

Replace the existing `it("resolves hp-methodology-basis (§ 11-2, single location) to a one-element citations array, primary true", ...)` test with:

```typescript
  it("resolves hp-methodology-basis (§ 11-2 + Vedlegg 2) to a two-element citations array, § 11-2 primary", async () => {
    const store = fakeStore([p11_2, pVedlegg2]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]?.citations).toHaveLength(2);
    const primary = result["hp-methodology-basis"]?.citations.find(c => c.primary);
    expect(primary?.paragraphId).toBe("no-avfallsforskriften-11-2");
  });

  it("hp-methodology-basis is null when only one of § 11-2 / Vedlegg 2 is cached (all-or-nothing)", async () => {
    const store = fakeStore([p11_2]); // Vedlegg 2 missing
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]).toBeNull();
  });
```

(Leave the existing `"hp-methodology-basis is null when § 11-2 is not cached"` test as-is — it already covers the single-missing-location case from the § 11-2-only side; the new second test above covers the same all-or-nothing contract from the Vedlegg-2-missing side.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts`
Expected: FAIL — `buildSeedLocations` doesn't include the vedlegg location yet; `hp-methodology-basis` still resolves to one element, not two.

- [ ] **Step 4: Add the Vedlegg 2 location to `buildSeedLocations` and `RESOLVED_FIELDS`**

In `scripts/seed-lovdata.ts`, modify `buildSeedLocations`:

```typescript
export function buildSeedLocations(documentId: string): { documentId: string; article: string; paragraph: string }[] {
  return [
    { documentId, article: "11", paragraph: "4" }, // hazardous-waste handling obligation (Checkbox10)
    { documentId, article: "9", paragraph: "5" },  // landfill categories (Checkbox1/2/3)
    { documentId, article: "9", paragraph: "6" },  // waste permitted per landfill category (Checkbox1/2/3)
    { documentId, article: "11", paragraph: "2" }, // HP1-15 methodology basis (TextField38, every sample)
    { documentId, article: "11", paragraph: "vedlegg-2" }, // HP1-15 criteria table (TextField38, every sample)
  ];
}
```

In `lib/compliance/resolve-legal-citations.ts`, modify the `hp-methodology-basis` entry in `RESOLVED_FIELDS`:

```typescript
  {
    key: "hp-methodology-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "2", queryText: "definisjon av farlig avfall HP1-HP15 vedlegg", primary: true },
      { documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2", queryText: "kriterier som gjør avfall til farlig avfall HP1-HP15" },
    ],
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/compliance/resolve-legal-citations.ts scripts/seed-lovdata.ts tests/compliance/resolve-legal-citations.test.ts tests/compliance/seed-lovdata.test.ts
git commit -m "feat: add Vedlegg 2 as a second hp-methodology-basis location (HP1-15 criteria table)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the real seed script against the live Supabase project**

Requires real Supabase/Lovdata/Voyage credentials in `.env.local` (same as every prior seeding step on this branch).

Run: `npx tsx scripts/seed-lovdata.ts`

This is the step where Vedlegg 2's real size (~54KB) meets Voyage's real embedding call for the first time. Do not pre-guess the outcome:

- If it succeeds, expected output includes a line `Seeded no-avfallsforskriften-11-vedlegg-2`.
- If Voyage rejects the request (e.g. an input-too-large error), STOP and report BLOCKED with the exact error — do not truncate the text speculatively or fabricate a workaround. This becomes a real, scoped follow-up decision (e.g. embedding a truncated/summarized portion of the text while storing the full text for citation display) for the human to decide, not something to guess at inline.
- If it fails with a transient rate-limit (429), the same real workaround used for § 11-2's seeding in the previous cycle applies — retry with a delay, do not fabricate a row.

- [ ] **Step 8: Verify the seeded row exists via a direct query**

If Step 7 succeeded, use the Supabase MCP tool (`mcp__4cb1564a-c04a-4cb1-9d6f-71b8b991fa4b__execute_sql`) against project `zrexxdnlonleijhlmnjp` to run:

```sql
select id, article, paragraph, in_force, length(text) as text_length from legal_paragraphs where id = 'no-avfallsforskriften-11-vedlegg-2';
```

Expected: exactly one row, `in_force = true`, `text_length` in the tens of thousands (confirming the real, full Vedlegg 2 text was stored, not a truncated fragment).

## Known follow-ups (not built in this plan, disclosed per the spec)

- Only kap. 9 (→ internal 11) and kap. 11 (→ internal 14) have confirmed `CHAPTER_INTERNAL_ID` entries. Any future Vedlegg citation for a different chapter needs its own independently-confirmed mapping entry.
- Subsection-level addressing within a Vedlegg (e.g. citing one specific HP threshold row rather than the whole Vedlegg text) is out of scope — this plan fetches and caches the whole Vedlegg as one paragraph-shaped blob, the same granularity as every existing §-paragraph citation.
- If Step 7 hits a real size-related failure, resolving it is explicitly deferred to a follow-up decision, not solved speculatively in this plan.
