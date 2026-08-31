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
const POLL_TIMEOUT_MS = 300_000;

export interface DatalabBlock {
  id: string;
  /** 0-indexed page the block sits on, parsed out of the id. */
  page: number;
  blockType: string;
  /** [x0, y0, x1, y1] in Datalab's rendered-page pixel space, top-left origin. */
  bbox: [number, number, number, number];
  /** Plain text of the block, tags stripped. */
  text: string;
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

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

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
      const text = stripTags(String(n.html ?? n.text ?? ""));
      if (blockType === "Page") {
        pages.push({ page, width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] });
      }
      blocks[id] = { id, page, blockType, bbox, text };
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
      analyseresultater: {
        type: "array",
        description: "Hver enkelt analyseparameter i rapporten, med resultat. Ta med alle rader, også de under deteksjonsgrensen.",
        items: {
          type: "object",
          properties: {
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
