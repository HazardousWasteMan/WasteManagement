// lib/compliance/sources/lovdata-archive.ts
//
// REAL ARCHIVE STRUCTURE (verified 2026-09-03 by downloading and extracting the live archive —
// `curl -sL https://api.lovdata.no/v1/publicData/get/gjeldende-sentrale-forskrifter.tar.bz2`,
// ~21.3MB, 5117 entries under `sf/`):
//
// - Avfallsforskriften's file inside the archive: `sf/sf-20040601-0930.xml` (filename pattern
//   is `sf/sf-<YYYYMMDD>-<NNNN>.xml`, i.e. the regulation's date and its 4-digit forskrift
//   number, zero-padded — matches the tail of its real Lovdata document id below).
// - Real Lovdata document id: `FOR-2004-06-01-930` (confirmed via the file's own
//   `<dd class="legacyID">FOR-2004-06-01-930</dd>` header; internal doc id is
//   `SF/forskrift/2004-06-01-930`).
// - Format: despite the `.xml` extension the content is actually the "XML-compatible HTML"
//   described on api.lovdata.no/om-api-tjenesten/ — a full `<!DOCTYPE html><html>...` document,
//   parseable as HTML/text, not strict XML (unescaped `&nbsp;`-style entities like `&#xa0;`
//   appear inline).
// - Paragraph markup (confirmed by inspecting real §11-1 and §11-4 in the extracted file): each
//   provision is an `<article class="legalArticle" data-lovdata-URL="SF/forskrift/2004-06-01-930/§11-4"
//   data-name="§11-4" id="...">` element. IMPORTANT: the `id` attribute is an internal running
//   counter tied to document order (e.g. `kapittel-14-paragraf-4` for `§11-4` in this document)
//   and does NOT reliably encode the visible article/paragraph number — the brief's assumption
//   of an `id="§11-4"`-style anchor is WRONG for this archive. The reliable anchor is the
//   `data-name` (and equivalently `data-lovdata-URL`) attribute, which always holds the exact
//   `§<article>-<paragraph>` string. Sibling `<article class="legalArticle">` elements are not
//   nested inside each other (only inside a shared ancestor), so a paragraph's own content runs
//   from its opening tag up to the next sibling with the same `class="legalArticle"`.
// - Per-provision text: the heading `<h3 class="legalArticleHeader">` holds the
//   `§ 11-4` label and title; nested `<article class="legalP">` (and `listArticle`) elements
//   hold the body text. This module extracts all text after the header, tags stripped.
// - Stable per-paragraph anchor for `sourceLink`: confirmed against both the archive's
//   `data-lovdata-URL` value and Lovdata's public site convention —
//   `https://lovdata.no/forskrift/2004-06-01-930/§11-4` (i.e. `https://lovdata.no/` +
//   the `data-lovdata-URL` value with the leading `SF/` segment dropped and lowercased,
//   `forskrift/2004-06-01-930/§<article>-<paragraph>`).
// - Per-paragraph last-changed date: NOT present in the archive at the individual-provision
//   level (a provision only carries a free-text "Endret ved ..." note when it has amendment
//   history, not a machine-readable date). The only structured last-changed value found is
//   document-level: `<dd class="lastChangeInForce">` in the document `<header>` (e.g.
//   `2026-01-01`). This module uses that document-level date for every paragraph's
//   `lastChangedAt` as an approximation — this is a known limitation, not a per-paragraph date.
//
// Lovdata publishes no per-document REST endpoint — only a nightly bulk tar.bz2 of ALL current
// central regulations (api.lovdata.no/om-api-tjenesten/). This module downloads and caches that
// archive once per process, then serves individual paragraph lookups from the cached extraction
// rather than re-downloading per call.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ARCHIVE_URL = "https://api.lovdata.no/v1/publicData/get/gjeldende-sentrale-forskrifter.tar.bz2";

// Confirmed real values (see header comment above).
const AVFALLSFORSKRIFTEN_ARCHIVE_PATH = "sf/sf-20040601-0930.xml";
const AVFALLSFORSKRIFTEN_DOC_ID = "2004-06-01-930";

// Archive-internal chapter numbering is offset from the human-facing chapter label (same quirk
// already known for §-paragraph ids, e.g. § 9-6's real internal id is kapittel-11-paragraf-6).
// Confirmed by direct inspection of the real archive (2026-09-06) — extend only after
// independently confirming a new chapter's real internal id the same way, never guess.
const CHAPTER_INTERNAL_ID: Record<string, string> = {
  "9": "11",
  "11": "14",
};

interface ParagraphResult {
  text: string;
  lastChangedAt: string;
  sourceLink: string;
}

// Pure parsing logic, extracted so it can be tested directly against hand-written fixture HTML
// without hitting the network or the filesystem. `getParagraphFromArchive` below is the thin I/O
// wrapper: it downloads/extracts the real archive and delegates the actual parsing here.
export function parseParagraphFromHtml(
  html: string,
  article: string,
  paragraph: string
): ParagraphResult | null {
  const anchorName = `§${article}-${paragraph}`;
  const marker = `data-name="${anchorName}"`;
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  // Walk back to the start of this <article class="legalArticle" ...> tag, then forward to
  // the next sibling <article class="legalArticle" so we capture the full provision (heading +
  // body) without needing a balanced-tag HTML parser.
  const tagStart = html.lastIndexOf("<article", markerIdx);
  if (tagStart === -1) return null;

  const nextSiblingIdx = html.indexOf('<article class="legalArticle"', markerIdx + marker.length);
  const provisionHtml = nextSiblingIdx === -1 ? html.slice(tagStart) : html.slice(tagStart, nextSiblingIdx);

  // Drop the heading (article number + title) so `text` holds the substantive provision body;
  // fall back to the full provision text if no heading is found.
  const headerEnd = provisionHtml.indexOf("</h3>");
  const bodyHtml = headerEnd === -1 ? provisionHtml : provisionHtml.slice(headerEnd + "</h3>".length);
  const text = stripTags(bodyHtml);
  if (!text) return null;

  const lastChangeMatch = html.match(
    /<dd class="lastChangeInForce">([^<]+)<\/dd>/
  );
  // Fallback when no document-level last-changed date is found: epoch (1970-01-01T00:00:00.000Z).
  // This is a known placeholder, not a real date — LegalParagraph.lastChangedAt is typed as a
  // required string so we cannot return null here; callers must not treat this value as a
  // genuine "last changed" timestamp.
  const lastChangedAt = lastChangeMatch
    ? new Date(lastChangeMatch[1].trim()).toISOString()
    : new Date(0).toISOString();

  return {
    text,
    lastChangedAt,
    sourceLink: `https://lovdata.no/forskrift/${AVFALLSFORSKRIFTEN_DOC_ID}/${anchorName}`,
  };
}

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

let cachedExtractionDir: string | null = null;

async function ensureArchiveExtracted(): Promise<string> {
  if (cachedExtractionDir) return cachedExtractionDir;
  const dir = await mkdtemp(join(tmpdir(), "lovdata-"));
  const archivePath = join(dir, "forskrifter.tar.bz2");
  const res = await fetch(ARCHIVE_URL);
  if (!res.ok) throw new Error(`Lovdata archive download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(archivePath, buf);
  // Extract only the one file we need rather than all 5000+ regulations.
  await execFileAsync("tar", ["-xjf", archivePath, "-C", dir, AVFALLSFORSKRIFTEN_ARCHIVE_PATH]);
  cachedExtractionDir = dir;
  return dir;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#xa0;|&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Locates and parses one paragraph out of the extracted Avfallsforskriften file. Returns null
// if the document or paragraph isn't found — never fabricates a result.
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
