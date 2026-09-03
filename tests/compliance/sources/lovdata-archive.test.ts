import { describe, it, expect } from "vitest";
import { parseParagraphFromHtml } from "@/lib/compliance/sources/lovdata-archive";

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
