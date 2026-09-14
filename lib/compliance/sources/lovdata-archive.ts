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

  return parseParagraphFromHtml(html, query.article, query.paragraph);
}
