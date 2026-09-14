import { describe, it, expect } from "vitest";
import { parseParagraphFromHtml, parseVedleggFromHtml, getParagraphFromArchive } from "@/lib/compliance/sources/lovdata-archive";

// Two adjacent provisions back-to-back, matching the real archive's sibling structure: each
// provision is an <article class="legalArticle" data-name="§X-Y" ...> with a header + body,
// and the next provision starts immediately with another such <article> sibling.
const TWO_ADJACENT_PROVISIONS = `
<html><body><header><dd class="lastChangeInForce">2026-01-01</dd></header>
<article class="legalArticle" data-lovdata-URL="SF/forskrift/2004-06-01-930/§11-4" data-name="§11-4" id="kapittel-14-paragraf-4">
  <h3 class="legalArticleHeader">§ 11-4. Første bestemmelse</h3>
  <article class="legalP">Dette er teksten til paragraf 11-4.</article>
</article>
<article class="legalArticle" data-lovdata-URL="SF/forskrift/2004-06-01-930/§11-5" data-name="§11-5" id="kapittel-14-paragraf-5">
  <h3 class="legalArticleHeader">§ 11-5. Andre bestemmelse</h3>
  <article class="legalP">Dette er teksten til paragraf 11-5, som ikke skal blandes inn i forrige.</article>
</article>
</body></html>
`;

const NO_LAST_CHANGE_DATE = `
<html><body><header></header>
<article class="legalArticle" data-name="§1-1" id="kapittel-1-paragraf-1">
  <h3 class="legalArticleHeader">§ 1-1. Formål</h3>
  <article class="legalP">Formålsteksten.</article>
</article>
</body></html>
`;

describe("parseParagraphFromHtml", () => {
  it("extracts the first of two adjacent provisions without bleeding into the second", () => {
    const result = parseParagraphFromHtml(TWO_ADJACENT_PROVISIONS, "11", "4");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Dette er teksten til paragraf 11-4");
    expect(result!.text).not.toContain("11-5");
    expect(result!.text).not.toContain("blandes inn");
  });

  it("extracts the second of two adjacent provisions correctly", () => {
    const result = parseParagraphFromHtml(TWO_ADJACENT_PROVISIONS, "11", "5");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Dette er teksten til paragraf 11-5");
    expect(result!.text).toContain("blandes inn");
  });

  it("returns null when the requested marker doesn't exist", () => {
    const result = parseParagraphFromHtml(TWO_ADJACENT_PROVISIONS, "99", "99");
    expect(result).toBeNull();
  });

  it("parses the document-level last-changed date when present", () => {
    const result = parseParagraphFromHtml(TWO_ADJACENT_PROVISIONS, "11", "4");
    expect(result).not.toBeNull();
    expect(result!.lastChangedAt).toBe(new Date("2026-01-01").toISOString());
  });

  it("falls back to the epoch placeholder date when no last-changed element is found", () => {
    const result = parseParagraphFromHtml(NO_LAST_CHANGE_DATE, "1", "1");
    expect(result).not.toBeNull();
    expect(result!.lastChangedAt).toBe(new Date(0).toISOString());
  });
});

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

  it("returns null rather than a bare-domain sourceLink when the section has no data-lovdata-URL", () => {
    const fixtureWithoutUrl = `
<html><body><header><dd class="lastChangeInForce">2026-01-01</dd></header>
<section class="section" data-name="vedlegg9" id="kapittel-14-kapittel-9">
  <h3>Vedlegg 9. Missing its data-lovdata-URL attribute</h3>
  <article class="legalP">Real body text, but no source URL to cite.</article>
</section>
</body></html>
`;
    const result = parseVedleggFromHtml(fixtureWithoutUrl, "14", "9");
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
    // suite — it requires network access to Lovdata's real archive. Explicit timeout: downloading
    // the real ~21MB archive takes ~4-5s standalone and can exceed vitest's 5000ms default under
    // full-suite concurrency (observed flaking intermittently) — this is a real network op, not a
    // slow assertion, so it gets a longer allowance rather than a tighter one.
    const result = await getParagraphFromArchive({
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "vedlegg-2",
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain("HP");
  }, 20000);

  it("returns null for a chapter with no confirmed entry in CHAPTER_INTERNAL_ID, never guessing", async () => {
    const result = await getParagraphFromArchive({
      documentId: "avfallsforskriften",
      article: "3", // not in CHAPTER_INTERNAL_ID
      paragraph: "vedlegg-1",
    });
    expect(result).toBeNull();
  });
});
