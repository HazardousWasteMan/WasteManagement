// Thin client for Datalab's document APIs (datalab.to). No official JS SDK exists, and the
// whole surface we need is two POSTs and a poll, so this is plain fetch rather than a dependency.
//
// The flow, and why it is two calls rather than one:
//   1. POST /api/v1/convert  (output_format=json, add_block_ids, save_checkpoint)
//        -> a block tree where every block has an id like "/page/2/Table/11", a bbox, and html,
//           plus a checkpoint_id.
//   2. POST /api/v1/extract  (checkpoint_id, page_schema)
//        -> the schema filled in, with a "<field>_citations" sibling for every field and every
//           table cell, holding those same block ids.
// Passing the checkpoint means the document is parsed once and paid for once. Resolving a
// citation id against the block tree is what makes "press the field, see the original text"
// possible — the ids are the join key.
import analyteReferenceRaw from "../data/analyte-reference.json";

const API = "https://www.datalab.to/api/v1";
const POLL_INTERVAL_MS = 2_000;
// Deliberately under the route's maxDuration (300s) so a slow job produces an honest error
// instead of the platform killing the function silently — same margin the Anthropic extraction
// path uses. A full 15-page bundled report has been measured at 4.3 min, i.e. right at this
// ceiling; that is a reason to extract per sub-report, not to raise the limit.
const POLL_TIMEOUT_MS = 270_000;

/** A cell or row inside a block, with its own box — see NARROWING below. */
export interface BlockRegion {
  /** The whole row's text. */
  text: string;
  /** Each cell's text, used to decide whether this row is the one that holds a value. */
  cells: string[];
  bbox: [number, number, number, number];
  kind: "row";
}

export interface DatalabBlock {
  id: string;
  /** 0-indexed page the block sits on, parsed out of the id. */
  page: number;
  blockType: string;
  /** [x0, y0, x1, y1] in Datalab's rendered-page pixel space, top-left origin. */
  bbox: [number, number, number, number];
  /** Plain text of the block, tags stripped. */
  text: string;
  /** Row sub-regions, when the block is a table. Empty otherwise. */
  regions: BlockRegion[];
}

export interface DatalabPage {
  page: number;
  /** The Page block's own bbox width/height — the frame every other bbox on that page is in. */
  width: number;
  height: number;
}

export interface ConvertResult {
  checkpointId: string | null;
  blocks: Record<string, DatalabBlock>;
  pages: DatalabPage[];
  pageCount: number;
  costCents: number;
}

function assertKey(): string {
  const key = process.env.DATALAB_API_KEY;
  if (!key) throw new Error("DATALAB_API_KEY is not configured");
  return key;
}

/** Datalab's convert/extract are async: the POST returns a URL to poll until status=complete. */
async function poll(checkUrl: string, key: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(checkUrl, { headers: { "X-API-Key": key } });
    if (!res.ok) throw new Error(`Datalab poll failed: ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    if (body.status === "complete") return body;
    if (body.status === "failed" || body.error) {
      throw new Error(`Datalab job failed: ${String(body.error ?? body.status)}`);
    }
  }
  throw new Error("Datalab job did not finish within the timeout");
}

async function start(path: string, form: FormData, key: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/${path}`, { method: "POST", headers: { "X-API-Key": key }, body: form });
  if (!res.ok) throw new Error(`Datalab ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const init = (await res.json()) as { request_check_url?: string; error?: string };
  if (!init.request_check_url) throw new Error(`Datalab ${path} returned no check URL: ${init.error ?? "unknown"}`);
  return poll(init.request_check_url, key);
}

// Decodes HTML entities after tags are stripped — &amp; must be last, or "&amp;lt;" would
// double-decode into "<" instead of the literal "&lt;" it actually represents.
const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#xa0;|&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// NARROWING
// Datalab cites a whole block, and its table blocks are huge — on a Eurofins report one Table
// block covers the sample header *and* every analyte row, so highlighting the block lights up the
// whole page. extras=table_cell_bboxes makes convert emit per-row and per-cell geometry as
// data-bbox attributes inside the block html, which has to be parsed back out.
//
// Only the ROW geometry is used. Per-cell x-boundaries proved unreliable on real reports: on the
// Eurofins sample Datalab returns data-bbox="799.55 511.5 810.1 532.0" — ten pixels wide — for the
// cell containing "Prøvetakingsdato:", so a cell-level box lands on the wrong column while
// claiming to show the matched value. Row boxes are correct vertically and span the table, so they
// point at the right line without ever pointing at the wrong content. Cell *text* is still used to
// decide which row matched.
const ROW_RE = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const BBOX_RE = /data-bbox="([\d.\s-]+)"/;

function parseBbox(attrs: string): [number, number, number, number] | null {
  const m = BBOX_RE.exec(attrs);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

/** One table row: its box, plus the text of each cell in it for matching. */
export function parseRegions(html: string): BlockRegion[] {
  const regions: BlockRegion[] = [];
  ROW_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW_RE.exec(html)) !== null) {
    const bbox = parseBbox(m[1]);
    if (!bbox) continue;
    const cells: string[] = [];
    CELL_RE.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CELL_RE.exec(m[2])) !== null) {
      const t = stripTags(c[2]);
      if (t) cells.push(t);
    }
    const text = stripTags(m[2]);
    if (text) regions.push({ text, cells, bbox, kind: "row" });
  }
  return regions;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Picks the table row that holds `match`, so a citation points at one line rather than the whole
 * analysis table. Falls back to the block's own box when nothing matches — better a box that is
 * too big than one that is confidently wrong.
 */
export function narrowCitation(block: DatalabBlock, match: string | null): { bbox: [number, number, number, number]; text: string } {
  const whole = { bbox: block.bbox, text: block.text };
  if (!match || block.regions.length === 0) return whole;
  const want = normalize(match);
  if (!want) return whole;

  const pick = (r: BlockRegion) => ({ bbox: r.bbox, text: r.text });

  // A cell equal to the value is the strongest signal: it means this row states exactly it.
  const exact = block.regions.find(r => r.cells.some(c => normalize(c) === want));
  if (exact) return pick(exact);

  // Otherwise a cell that is mostly the value — guards against a bare "1.8" matching a row that
  // merely mentions it in passing.
  const partial = block.regions.find(r =>
    r.cells.some(c => {
      const t = normalize(c);
      return t.includes(want) && want.length >= t.length * 0.5;
    })
  );
  if (partial) return pick(partial);

  const inRow = block.regions.find(r => normalize(r.text).includes(want));
  if (inRow) return pick(inRow);

  return whole;
}

/** Page index is only available on the block id ("/page/2/Table/11"), not as a field. */
const pageOf = (id: string): number => {
  const m = /^\/page\/(\d+)\//.exec(id);
  return m ? Number(m[1]) : -1;
};

/** Walks the nested block tree into a flat id -> block index. */
export function flattenBlocks(root: unknown): { blocks: Record<string, DatalabBlock>; pages: DatalabPage[] } {
  const blocks: Record<string, DatalabBlock> = {};
  const pages: DatalabPage[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const id = typeof n.id === "string" ? n.id : null;
    const bbox = Array.isArray(n.bbox) && n.bbox.length === 4 ? (n.bbox.map(Number) as [number, number, number, number]) : null;

    if (id && bbox) {
      const page = pageOf(id);
      const blockType = String(n.block_type ?? "");
      const html = String(n.html ?? "");
      const text = stripTags(html || String(n.text ?? ""));
      if (blockType === "Page") {
        pages.push({ page, width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] });
      }
      blocks[id] = { id, page, blockType, bbox, text, regions: parseRegions(html) };
    }
    for (const child of (Array.isArray(n.children) ? n.children : [])) walk(child);
  };

  walk(root);
  pages.sort((a, b) => a.page - b.page);
  return { blocks, pages };
}

export interface ConvertOptions {
  /** Datalab page_range syntax, e.g. "2-4" or "0,5-10". Omit for the whole document. */
  pageRange?: string;
  mode?: "fast" | "balanced" | "accurate";
}

export async function convertDocument(pdf: Buffer, filename: string, opts: ConvertOptions = {}): Promise<ConvertResult> {
  const key = assertKey();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  form.append("output_format", "json");
  form.append("add_block_ids", "true");
  form.append("save_checkpoint", "true");
  form.append("mode", opts.mode ?? "fast");
  // Per-cell and per-list-item boxes, so a citation can be narrowed to the cell that holds the
  // value instead of highlighting an entire table. Emitted as data-bbox attributes in the html.
  form.append("extras", "table_cell_bboxes,list_item_bboxes");
  if (opts.pageRange) form.append("page_range", opts.pageRange);

  const body = await start("convert", form, key);
  const { blocks, pages } = flattenBlocks(body.json);
  return {
    checkpointId: typeof body.checkpoint_id === "string" ? body.checkpoint_id : null,
    blocks,
    pages,
    pageCount: Number(body.page_count ?? pages.length),
    costCents: Number(body.total_cost ?? 0),
  };
}

export interface ExtractResult {
  /** The filled schema, with "<field>_citations" siblings left in place. */
  data: Record<string, unknown>;
  costCents: number;
  scoreAverage: number | null;
}

export async function extractStructured(
  pageSchema: object,
  source: { checkpointId: string } | { pdf: Buffer; filename: string },
  opts: { pageRange?: string; extractionMode?: "turbo" | "fast" | "balanced" } = {}
): Promise<ExtractResult> {
  const key = assertKey();
  const form = new FormData();
  if ("checkpointId" in source) {
    form.append("checkpoint_id", source.checkpointId);
  } else {
    form.append("file", new Blob([new Uint8Array(source.pdf)], { type: "application/pdf" }), source.filename);
  }
  form.append("page_schema", JSON.stringify(pageSchema));
  form.append("extraction_mode", opts.extractionMode ?? "fast");
  if (opts.pageRange) form.append("page_range", opts.pageRange);

  const body = await start("extract", form, key);
  const raw = body.extraction_schema_json;
  const data = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  return {
    data: data as Record<string, unknown>,
    costCents: Number(body.total_cost ?? 0),
    scoreAverage: body.extraction_score_average == null ? null : Number(body.extraction_score_average),
  };
}

/**
 * The extraction schema, written to mirror the BK-skjema's own fields rather than a generic
 * lab-report shape — the point of the tab is "put in the sample, get back the form's fields".
 *
 * analyte_id is an enum of the real AnalyteReference vocabulary, so Datalab does the
 * analyte-name matching against the same 92 ids the classification engine keys on, instead of
 * us guessing at Norwegian synonyms locally. Descriptions are Norwegian because the reports are.
 */
export function buildBkPageSchema(): object {
  const analyteIds = (analyteReferenceRaw as { analyteId: string }[]).map(a => a.analyteId);
  return {
    type: "object",
    properties: {
      rapportnummer: { type: "string", description: "Laboratoriets rapportnummer for denne prøven, f.eks. AR-25-MM-118438-01" },
      laboratorium: { type: "string", description: "Navnet på laboratoriet som utførte analysen, slik det står i rapporthodet" },
      oppdragsgiver: { type: "string", description: "Kunden/oppdragsgiver som bestilte analysen" },
      avfallsprodusent: { type: "string", description: "Avfallsprodusent hvis oppgitt særskilt, ellers samme som oppdragsgiver" },
      // The customer address block on a Eurofins report carries most of BK-skjema part 2.
      oppdragsgiver_adresse: { type: "string", description: "Oppdragsgivers gateadresse eller postboks, fra adressefeltet øverst i rapporten. Kun gate/postboks, ikke postnummer eller poststed" },
      oppdragsgiver_postnummer: { type: "string", description: "Oppdragsgivers postnummer, fire siffer" },
      oppdragsgiver_poststed: { type: "string", description: "Oppdragsgivers poststed" },
      kontaktperson: { type: "string", description: "Navngitt kontaktperson hos oppdragsgiver, f.eks. etter 'Attn:'. Bare personnavn" },
      kontaktperson_epost: { type: "string", description: "E-postadressen som tilhører kontaktpersonen. Utelat feltet hvis rapporten ikke knytter en e-post til nettopp denne personen — ikke bruk laboratoriets egen e-post eller en generisk adresse" },
      kontaktperson_telefon: { type: "string", description: "Telefonnummer til oppdragsgiver eller kontaktpersonen. Utelat feltet hvis bare laboratoriets eget telefonnummer står i rapporten" },
      provemerking: { type: "string", description: "Kundens egen prøvemerking/prøveidentifikasjon, IKKE laboratoriets interne prøvenummer" },
      provenummer: { type: "string", description: "Laboratoriets eget prøvenummer, f.eks. 439-2025-10080994" },
      hentested: { type: "string", description: "Sted/lokalitet prøven er tatt fra, f.eks. prosjektnavn eller adresse" },
      matrise: { type: "string", description: "Matrise/materialtype, f.eks. Betong, Jord, Asfalt, Aske" },
      provetakingsdato: { type: "string", description: "Prøvetakingsdato som den står i rapporten" },
      mottaksdato: { type: "string", description: "Dato prøven ble mottatt av laboratoriet" },
      torrstoff_prosent: { type: "number", description: "Tørrstoff i prosent" },
      toc_prosent: { type: "number", description: "TOC (totalt organisk karbon) i prosent. Kun hvis faktisk målt" },
      glodetap_prosent: { type: "number", description: "Glødetap i prosent. Kun hvis faktisk målt" },
      ph: { type: "number", description: "pH hvis målt" },
      fysisk_form: { type: "string", description: "Prøvens fysiske form: fast, flytende eller pulver" },
      ristetest_utfort: { type: "boolean", description: "True bare hvis rapporten inneholder resultater fra en ristetest (utlekkingstest)" },
      kolonnetest_utfort: { type: "boolean", description: "True bare hvis rapporten inneholder resultater fra en kolonnetest" },
      totalinnhold_utfort: { type: "boolean", description: "True bare hvis rapporten inneholder resultater fra totalinnhold (bulk) analyse, ikke bare utlekking/eluat" },
      analyseresultater: {
        type: "array",
        description: "Hver enkelt analyseparameter i rapporten, med resultat. Ta med alle rader, også de under deteksjonsgrensen.",
        items: {
          type: "object",
          properties: {
            raw_value_text: { type: "string", description: "Exact printed result text, preserving <, <=, ND and decimal notation. Do not invent a measured value." },
            analytical_context: { type: "string", description: "Quote the row/table heading or nearby test context establishing total content, batch/ristetest, column/kolonne, eluate, L/S or composition. Include dry/as-received footnotes if present. Do not infer purpose from units. Omit if absent." },
            concentration_basis: { type: "string", enum: ["dry", "as_received", "liquid_volume", "unknown"], description: "Reported basis from units/footnotes; unknown when not established. No automatic dry assumption." },
            method: { type: "string", description: "Reported analytical/test method, if present." },
            parameter: { type: "string", description: "Parameternavnet slik det står i rapporten, f.eks. 'Arsen (As)'" },
            analyte_id: {
              type: "string",
              enum: analyteIds,
              description: "Hvilken kjent analyte denne parameteren tilsvarer. Utelat feltet helt hvis ingen av verdiene passer — ikke gjett.",
            },
            verdi: { type: "number", description: "Måleresultatet. Hvis resultatet er oppgitt som '<x', sett under_loq=true og loq=x" },
            under_loq: { type: "boolean", description: "True hvis resultatet er oppgitt som mindre enn deteksjonsgrensen" },
            loq: { type: "number", description: "Deteksjonsgrensen (LOQ/LOD) for parameteren" },
            enhet: { type: "string", description: "Enheten slik den står i rapporten, f.eks. 'mg/kg TS' eller 'µg/kg TS'" },
          },
          required: ["parameter", "enhet"],
        },
      },
    },
    required: ["analyseresultater"],
  };
}
