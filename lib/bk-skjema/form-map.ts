// The BK-skjema (Sammendrag av basiskarakterisering for avfall til deponi) AcroForm has 103
// generically named fields — TextField1..53, Checkbox1..46, group1/2/3/6. This module is the
// single source of truth mapping them to their printed labels and to where each value comes
// from. The mapping was derived geometrically (widget rects joined to the nearest printed
// label) by bk/map_fields.py; bk/field-map-raw.json is its output.
//
// Deliberately independent of any one extraction backend: callers normalize whatever their
// provider returns into BkSource, so the Anthropic pipeline and Datalab both feed the same code.
import type { EalAssignment } from "../hp-classification/eal";

/** Where a field's value comes from — the whole point of the coverage exercise. */
export type BkSrc =
  | "extracted"  // straight out of the document
  | "derived"    // computed by the classification engine from extracted values
  | "human"      // the pipeline cannot supply this; a person must
  | "receiver"   // section 1 — filled by the landfill, not the producer
  | "n/a";       // legitimately not applicable to this waste/delivery

/** A citation back into the source document, so the UI can show the original text. */
export interface BkCitation {
  blockId: string | null;
  page: number | null;
  text: string | null;
  /** [x0, y0, x1, y1] in PDF points, top-left origin, or null when the provider gave none. */
  bbox: [number, number, number, number] | null;
}

export interface BkField {
  /** AcroForm field name, e.g. "TextField6". */
  field: string;
  label: string;
  src: BkSrc;
  /** Text value, or undefined for checkbox/radio fields. */
  value?: string;
  /** Checkbox state. */
  check?: boolean;
  /** Radio group export value, e.g. "Radio1". */
  select?: string;
  /** Why this field is blank, or what to distrust about it. */
  note?: string;
  /** Where in the document this came from. Empty for derived/human fields. */
  citations?: BkCitation[];
  /** Provider confidence, 1-5, when the provider reports one. */
  score?: number | null;
}

export interface BkResultRow {
  rawAnalyteName: string;
  analyteId: string | null;
  resultValue: number | null;
  isBelowLoq: boolean;
  loqValue: number | null;
  unitRaw: string;
  citations?: BkCitation[];
}

/** Backend-neutral input to the field builder. */
export interface BkSource {
  metadata: {
    externalReportNo?: string | null;
    labName?: string | null;
    customerName?: string | null;
    producerName?: string | null;
    sampleMarking?: string | null;
    matrixType?: string | null;
    samplingDate?: string | null;
    receiptDate?: string | null;
    physicalState?: string | null;
    /** Site the waste is collected from, when the document happens to carry it. */
    pickupLocation?: string | null;
    /** Organic content, when measured. Both are commonly absent from a lab report. */
    tocPct?: number | null;
    glodetapPct?: number | null;
  };
  results: BkResultRow[];
  isHazardous: boolean;
  eal: EalAssignment;
  /** Per-metadata-key citations, keyed by the metadata field name above. */
  citations?: Record<string, BkCitation[]>;
  /** Per-metadata-key confidence scores, keyed the same way. */
  scores?: Record<string, number | null>;
}

const cite = (s: BkSource, key: string): Pick<BkField, "citations" | "score"> => ({
  citations: s.citations?.[key] ?? [],
  score: s.scores?.[key] ?? null,
});

/** Builds the human-readable free-text description for TextField38. */
export function buildDescription(s: BkSource): string {
  const m = s.metadata;
  const detected = s.results.filter(
    r => !r.isBelowLoq && r.resultValue !== null && !/t[øe]rrstoff/i.test(r.rawAnalyteName)
  );
  const top = detected.slice(0, 8).map(r => `${r.rawAnalyteName} ${r.resultValue} ${r.unitRaw}`).join("; ");
  return [
    `${m.matrixType ?? "Ukjent masse"} fra ${m.customerName ?? m.producerName ?? "ukjent produsent"}.`,
    `Prøve ${m.sampleMarking ?? "uten merking"}, analysert av ${m.labName ?? "ukjent laboratorium"}, rapport ${m.externalReportNo ?? "uten nummer"}`,
    `(prøvetatt ${m.samplingDate ?? "ukjent dato"}, mottatt ${m.receiptDate ?? "ukjent dato"}).`,
    `Kjemisk analyse omfatter ${s.results.length} analyseparametere.`,
    detected.length > 0 ? `Påviste verdier over LOQ: ${top}.` : `Ingen parametere påvist over LOQ.`,
    `Alle øvrige parametere under deteksjonsgrense.`,
    `Vurdert mot HP1-HP15 (avfallsforskriften kap. 11 / forordning 1357/2014):`,
    s.isHazardous ? `avfallet er farlig avfall.` : `ingen HP-kategori utløst, avfallet er ikke farlig avfall.`,
    s.eal.code ? `Tildelt EAL-kode ${s.eal.code}.` : `EAL-kode ikke tildelt: ${s.eal.confidence}.`,
    s.eal.code ? `Merk: ${s.eal.confidence}.` : "",
    `Sammenstilte analyseresultater og analyserapport fra laboratoriet vedlegges.`,
  ].filter(Boolean).join(" ");
}

/**
 * Maps a normalized source onto all 103 AcroForm fields. Fields the source cannot supply are
 * returned with a `note` explaining why rather than omitted — the gaps are the interesting part.
 */
export function buildBkFields(s: BkSource): BkField[] {
  const m = s.metadata;
  const ealDigits = (s.eal.code ?? "").replace(/\D/g, "");

  const fields: BkField[] = [
    { field: "group1", label: "Skjemaet gjelder: En enkelt leveranse", src: "human", select: "Radio1",
      note: "delivery type is a commercial fact, not in the lab report; single delivery assumed" },

    // 1. Fylles ut av avfallsmottaker
    { field: "TextField1", label: "Kundenummer", src: "receiver" },
    { field: "TextField2", label: "Prosjektnummer og navn", src: "receiver" },
    { field: "TextField3", label: "Deponiets merknad", src: "receiver" },

    // 2. Avfallsprodusent
    { field: "TextField4", label: "Hentested for avfallet", src: m.pickupLocation ? "extracted" : "human",
      value: m.pickupLocation ?? undefined, ...cite(s, "pickupLocation"),
      note: m.pickupLocation ? undefined : "site address not present in the document" },
    { field: "TextField5", label: "ID nr. fra avfallsprodusent", src: "extracted",
      value: m.sampleMarking ?? undefined, ...cite(s, "sampleMarking"),
      note: "verify this is the producer's own marking and not the lab's Prøvenr." },
    { field: "TextField6", label: "Avfallsprodusent", src: "extracted",
      value: m.producerName ?? m.customerName ?? undefined, ...cite(s, "customerName") },
    { field: "TextField7", label: "Organisasjonsnummer", src: "human", note: "not present in a lab report" },
    { field: "TextField8", label: "Adresse", src: "human" },
    { field: "TextField11", label: "Postnummer", src: "human" },
    { field: "TextField14", label: "Poststed", src: "human" },
    { field: "TextField9", label: "Kontaktperson", src: "human" },
    { field: "TextField12", label: "Telefon (produsent)", src: "human" },
    { field: "TextField15", label: "e-post (produsent)", src: "human" },
    { field: "TextField10", label: "Transportør/Entreprenør", src: "human", note: "never in a lab report by nature" },
    { field: "TextField13", label: "Telefon (transportør)", src: "human" },
    { field: "TextField16", label: "e-post (transportør)", src: "human" },

    // 3. Avfallstype og kode — EAL code, one digit per box
    ...Array.from({ length: 6 }, (_, i) => ({
      field: `TextField${17 + i}`,
      label: `EAL-kode siffer ${i + 1}`,
      src: "derived" as BkSrc,
      value: ealDigits[i],
      note: s.eal.code ? undefined : `EAL not assigned: ${s.eal.confidence}`,
    })),
    ...[23, 24, 25, 26].map(n => ({
      field: `TextField${n}`, label: "Avfallsstoffnummer NS 9431", src: "human" as BkSrc,
      note: "avfallsstoffnummer-eal-crosswalk.json holds only 4 entries, none for chapter 1701",
    })),
    ...[27, 28, 29].map(n => ({ field: `TextField${n}`, label: "Næring", src: "human" as BkSrc, note: "administrative code, not analysis data" })),
    ...[30, 31, 32, 33, 34].map(n => ({ field: `TextField${n}`, label: "Kommune", src: "human" as BkSrc, note: "administrative code, not analysis data" })),

    { field: "Checkbox1", label: "Deponi for ordinært avfall", src: "derived", check: !s.isHazardous,
      note: "CONSERVATIVE: inert cannot be claimed without a leaching test" },
    { field: "Checkbox2", label: "Deponi for inert avfall", src: "derived", check: false,
      note: "requires ristetest/kolonnetest results, which a standard total-analysis report lacks" },
    { field: "Checkbox3", label: "Deponi for farlig avfall", src: "derived", check: s.isHazardous },
    { field: "Checkbox4", label: "Avfallstype: Ordinært avfall", src: "derived", check: !s.isHazardous },
    { field: "Checkbox5", label: "Avfallstype: Inert avfall", src: "derived", check: false },
    { field: "Checkbox6", label: "Avfallstype: Farlig avfall", src: "derived", check: s.isHazardous },
    { field: "Checkbox7", label: "Testpliktig: Nei", src: "derived", check: false },
    { field: "Checkbox8", label: "Testpliktig: Ja", src: "derived", check: true, note: "chemical analysis exists and is attached" },
    { field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "derived", check: false },
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived", check: true,
      note: "hazardous substances detected above LOQ, though all below HP thresholds" },
    { field: "TextField35", label: "TOC %", src: m.tocPct != null ? "extracted" : "human",
      value: m.tocPct != null ? String(m.tocPct) : undefined, ...cite(s, "tocPct"),
      note: m.tocPct != null ? undefined : "GAP: TOC not measured, but required for deponi for ordinært avfall" },
    { field: "TextField36", label: "Glødetap %", src: m.glodetapPct != null ? "extracted" : "human",
      value: m.glodetapPct != null ? String(m.glodetapPct) : undefined, ...cite(s, "glodetapPct"),
      note: m.glodetapPct != null ? undefined : "GAP: not measured in this report" },
    { field: "group2", label: "Ristetest", src: "derived", select: "Radio1", note: "Nei — no leaching test in the document" },
    { field: "group3", label: "Kolonnetest", src: "derived", select: "Radio1", note: "Nei — no column test in the document" },
    { field: "TextField37", label: "Tilstandsklasse 1-5 (gravemasser/jord/sediment)", src: "n/a",
      note: `only applies to soil/sediment; matrix here is ${m.matrixType ?? "unknown"}` },
    { field: "TextField38", label: "Beskriv avfallet og hvordan det oppstår", src: "derived", value: buildDescription(s) },

    // 4. Avfallets egenskaper
    ...[11, 12, 13, 14, 15, 16, 17, 18].map(n => ({
      field: `Checkbox${n}`, label: "Avfallets opprinnelse", src: "human" as BkSrc, check: false,
      note: "GAP: origin/process is not stated in a lab report; a person must pick it",
    })),
    ...[27, 28, 29, 30, 31, 32].map(n => ({
      field: `Checkbox${n}`, label: "Avfallets fysiske egenskaper", src: "human" as BkSrc, check: false,
      note: `GAP: physicalState "${m.physicalState ?? "unknown"}" does not map onto any of the form's six options`,
    })),
    ...[33, 34, 35, 36, 37, 38].map(n => ({
      field: `Checkbox${n}`, label: "Har avfallet vært forbehandlet?", src: "human" as BkSrc, check: false,
      note: "GAP: pre-treatment is not lab-report data",
    })),
    ...[41, 42, 43, 44, 45, 46].map(n => ({
      field: `Checkbox${n}`, label: "Forbudt å deponere", src: "derived" as BkSrc, check: false,
      note: "left unticked = negative declaration; TOC and glødetap were not measured, so those two cannot be positively confirmed",
    })),
    { field: "TextField39", label: "Farge (beskriv)", src: "human", note: "GAP: visual observation, not in a lab report" },
    { field: "TextField40", label: "Lukt (beskriv)", src: "human", note: "GAP: visual observation, not in a lab report" },
    { field: "TextField41", label: "Må deponiet treffe ekstra forhåndsregler?", src: "derived",
      value: s.isHazardous ? "Ja — se analyserapport." : "Nei — ingen HP-kategori utløst." },

    // 5. Avfall som oppstår jevnlig
    { field: "group6", label: "Oppstår avfallet jevnlig?", src: "human", select: "Radio1",
      note: "Nei — single delivery; recurrence is a commercial fact" },
    ...Array.from({ length: 12 }, (_, i) => ({
      field: `TextField${42 + i}`, label: "Del 5 (jevnlig avfall)", src: "n/a" as BkSrc,
      note: "not applicable — waste does not arise regularly",
    })),
  ];

  // Waste-type column (Checkbox19..26, 39, 40) — the one column the matrix type actually decides.
  const MATRIX_CHECKBOX: { box: number; label: string; match: RegExp }[] = [
    { box: 19, label: "Jord og sediment som er forurenset", match: /jord|sediment|terra|soil/i },
    { box: 20, label: "Gravemasser som inneholder avfall", match: /gravemasse|excavat/i },
    { box: 21, label: "Gateoppsop og strøsand", match: /gateoppsop|strøsand/i },
    { box: 22, label: "Sandfangmasser", match: /sandfang/i },
    { box: 23, label: "Betong eller tegl", match: /betong|tegl|concrete|brick/i },
    { box: 24, label: "Aske eller slagg", match: /aske|slagg|ash|slag/i },
    { box: 25, label: "Avløpsslam", match: /avløpsslam|sludge/i },
    { box: 26, label: "Ristegods, silgods", match: /ristegods|silgods/i },
    { box: 39, label: "Blandet", match: /blandet|mixed/i },
    { box: 40, label: "Annet", match: /^$/ },
  ];
  const matrix = m.matrixType ?? "";
  const hit = MATRIX_CHECKBOX.find(c => c.match.test(matrix));
  for (const c of MATRIX_CHECKBOX) {
    fields.push({
      field: `Checkbox${c.box}`,
      // "Avfallstype (materiale)" rather than plain "Avfallstype": part 3 already has an
      // "Avfallstype" column (ordinært / inert / farlig). Sharing the label made the two
      // impossible to tell apart in the field list.
      label: `Avfallstype (materiale): ${c.label}`,
      src: hit ? "extracted" : "human",
      check: hit?.box === c.box,
      ...(hit?.box === c.box ? cite(s, "matrixType") : {}),
      note: hit ? (hit.box === c.box ? `from matrixType "${matrix}"` : undefined)
                : `GAP: matrixType "${matrix}" matched none of the form's waste types`,
    });
  }

  return fields;
}

/**
 * The form's own six numbered parts. Grouping the UI by these rather than by our provenance
 * categories means the reviewer reads the fields in the order the paper form asks for them.
 */
export const BK_SECTIONS = [
  { index: 0, title: "Skjemaet gjelder" },
  { index: 1, title: "1. Fylles ut av avfallsmottaker" },
  { index: 2, title: "2. Avfallsprodusent" },
  { index: 3, title: "3. Avfallstype og kode" },
  { index: 4, title: "4. Avfallets egenskaper" },
  { index: 5, title: "5. Avfall som oppstår jevnlig" },
] as const;

/** Which part of the paper form an AcroForm field sits in, derived from its name. */
export function bkSection(field: string): number {
  const n = Number(/\d+$/.exec(field)?.[0] ?? -1);
  if (field === "group1") return 0;
  if (field === "group6") return 5;
  if (field === "group2" || field === "group3") return 3;
  if (field.startsWith("TextField")) {
    if (n <= 3) return 1;
    if (n <= 16) return 2;
    if (n <= 38) return 3;
    if (n <= 41) return 4;
    return 5;
  }
  if (field.startsWith("Checkbox")) return n <= 10 ? 3 : 4;
  return 3;
}
