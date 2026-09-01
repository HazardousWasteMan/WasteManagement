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

/**
 * BK-skjema part 4's two one-of-six columns, in the order printed on the form. The option strings
 * are exactly the enum the extraction schema offers, so matching is a string compare.
 */
export const PHYSICAL_FORMS = [
  { box: 27, option: "Pulver" },
  { box: 28, option: "Flytende" },
  { box: 29, option: "Stor gjenstand (monolittisk)" },
  { box: 30, option: "Sammensatt / heterogent" },
  { box: 31, option: "Ensartet / homogent" },
  { box: 32, option: "Annet" },
] as const;

export const PRETREATMENTS = [
  { box: 33, option: "Sorteringsanlegg" },
  { box: 34, option: "Biologisk behandling" },
  { box: 35, option: "Forbrenning" },
  { box: 36, option: "Oppmaling / kverning" },
  { box: 37, option: "Ingen" },
  { box: 38, option: "Annen forbehandling" },
] as const;

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
  /** True when the row is a leaching-test release, so it is excluded from hazard classification. */
  isLeachateResult?: boolean;
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
    /** Set when a labName was read but rejected as a subcontractor — see from-datalab.ts. */
    labNameNote?: string | null;
    /** Site the waste is collected from, when the document happens to carry it. */
    pickupLocation?: string | null;
    /** One of BK-skjema part 4's six "fysiske egenskaper" options, when the report states it. */
    physicalForm?: string | null;
    /** One of part 4's six "forbehandlet" options, when the report states it. */
    pretreatment?: string | null;
    /** Producer address block — present on most lab reports, as the customer address. */
    address?: string | null;
    postCode?: string | null;
    postArea?: string | null;
    contactPerson?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    /** Organic content, when measured. Both are commonly absent from a lab report. */
    tocPct?: number | null;
    glodetapPct?: number | null;
  };
  results: BkResultRow[];
  isHazardous: boolean;
  /**
   * False when the document carried no usable total-content analysis — every row was a leaching
   * result, or nothing matched a known analyte. `isHazardous` is then meaningless and the form
   * must say so rather than tick "ordinært avfall".
   */
  hazardAssessable?: boolean;
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

// Part 2 asks for the waste PRODUCER — the party that signs the declaration. A lab report only
// names the party that ordered the analysis, and on two of the three real forms tested those were
// different legal entities: the report said Prosjektil AS (the consultant) where the form says
// Veidekke Prefab AS, and Avinor AS (the site owner) where the form says Anlegg Nord AS. Filling
// produsent, adresse, postnummer, poststed and kontaktperson straight from the customer block put
// twelve wrong values on documents someone signs (bk/BIG-TEST-FINDINGS.md finding 3).
//
// Nothing in the document distinguishes the two cases, so this is not fixable by extracting
// better. The value stays as a prefilled suggestion — it is right when producer and customer are
// the same company, which does happen — but the field is `human`, so the UI renders it as an
// input to confirm and counts it as outstanding rather than as "from the document".
const CONFIRM_PRODUCER =
  "suggestion from the report's customer block — the lab's customer is often a consultant or site owner, not the waste producer who signs. Confirm before use";

const suggestion = (
  s: BkSource, key: string, value: string | null | undefined
): Pick<BkField, "src" | "value" | "citations" | "score" | "note"> => ({
  src: "human",
  value: value ?? undefined,
  ...cite(s, key),
  note: CONFIRM_PRODUCER,
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
    s.hazardAssessable === false
      ? `Dokumentet inneholder ingen brukbar totalanalyse (kun utlekkingsresultater), så fareklassifisering mot HP1-HP15 er ikke utført — må vurderes manuelt.`
      : `Vurdert mot HP1-HP15 (avfallsforskriften kap. 11 / forordning 1357/2014): ${s.isHazardous ? "avfallet er farlig avfall." : "ingen HP-kategori utløst, avfallet er ikke farlig avfall."}`,
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

  // When no total-content analysis survived, the hazard columns have no answer. Ticking the
  // non-hazardous half would be the guess that called big_test/test_1's hazardous waste clean.
  const assessable = s.hazardAssessable !== false;
  const NO_VERDICT = "GAP: the document carries no usable total-content analysis (leaching results only, or nothing matched a known analyte), so hazard status is unknown — a person must classify";
  const verdict = (check: boolean, note?: string): Pick<BkField, "src" | "check" | "note"> =>
    assessable ? { src: "derived", check, note } : { src: "human", check: false, note: NO_VERDICT };

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
    { field: "TextField5", label: "ID nr. fra avfallsprodusent", ...suggestion(s, "sampleMarking", m.sampleMarking),
      note: "suggestion from the sample marking — the form asks for the producer's own ID, not the lab's Prøvenr. Confirm before use" },
    { field: "TextField6", label: "Avfallsprodusent", ...suggestion(s, "customerName", m.producerName ?? m.customerName) },
    { field: "TextField7", label: "Organisasjonsnummer", src: "human", note: "not present in a lab report" },
    { field: "TextField8", label: "Adresse", ...suggestion(s, "address", m.address) },
    { field: "TextField11", label: "Postnummer", ...suggestion(s, "postCode", m.postCode) },
    { field: "TextField14", label: "Poststed", ...suggestion(s, "postArea", m.postArea) },
    { field: "TextField9", label: "Kontaktperson", ...suggestion(s, "contactPerson", m.contactPerson) },
    { field: "TextField12", label: "Telefon (produsent)", ...suggestion(s, "contactPhone", m.contactPhone),
      note: m.contactPhone ? CONFIRM_PRODUCER : "not stated for the producer — a lab report carries the lab's own number" },
    { field: "TextField15", label: "e-post (produsent)", ...suggestion(s, "contactEmail", m.contactEmail) },
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

    { field: "Checkbox1", label: "Deponi for ordinært avfall",
      ...verdict(!s.isHazardous, "CONSERVATIVE: inert cannot be claimed without a leaching test") },
    { field: "Checkbox2", label: "Deponi for inert avfall",
      ...verdict(false, "requires ristetest/kolonnetest results, which a standard total-analysis report lacks") },
    { field: "Checkbox3", label: "Deponi for farlig avfall", ...verdict(s.isHazardous) },
    { field: "Checkbox4", label: "Avfallstype: Ordinært avfall", ...verdict(!s.isHazardous) },
    { field: "Checkbox5", label: "Avfallstype: Inert avfall", ...verdict(false) },
    { field: "Checkbox6", label: "Avfallstype: Farlig avfall", ...verdict(s.isHazardous) },
    { field: "Checkbox7", label: "Testpliktig: Nei", src: "derived", check: false },
    { field: "Checkbox8", label: "Testpliktig: Ja", src: "derived", check: true, note: "chemical analysis exists and is attached" },
    // "Innhold av farlige stoffer" is the filer's judgement, not a measurement: the Veidekke form
    // (big_test/test_3) answers Nei with substances detected above LOQ but all under the limits,
    // while the Avinor form answers Ja on the same footing. Hardcoding Ja asserted one reading of
    // a question the form leaves to a person, so it is now a suggestion.
    { field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "human", check: false,
      note: "a judgement call: tick Nei if nothing exceeds the limits in avfallsforskriften kap. 11 vedlegg III" },
    { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "human",
      check: assessable && s.results.some(r => !r.isBelowLoq && r.resultValue !== null && !r.isLeachateResult),
      note: "suggestion: substances were detected above LOQ. Confirm — the same facts are filed both ways on real forms" },
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
    // Part 4's two one-of-six columns. Ticked only when the document actually said so; otherwise
    // every box stays clear and editable, because both describe the delivered waste rather than
    // the analysed sample and a lab report normally states neither.
    ...PHYSICAL_FORMS.map(({ box, option }) => ({
      field: `Checkbox${box}`,
      label: `Fysiske egenskaper: ${option}`,
      src: m.physicalForm ? ("extracted" as BkSrc) : ("human" as BkSrc),
      check: m.physicalForm === option,
      ...(m.physicalForm === option ? cite(s, "physicalForm") : {}),
      note: m.physicalForm
        ? undefined
        : "the report does not describe the physical form of the delivery — pick one",
    })),
    ...PRETREATMENTS.map(({ box, option }) => ({
      field: `Checkbox${box}`,
      label: `Forbehandlet: ${option}`,
      src: m.pretreatment ? ("extracted" as BkSrc) : ("human" as BkSrc),
      check: m.pretreatment === option,
      ...(m.pretreatment === option ? cite(s, "pretreatment") : {}),
      note: m.pretreatment
        ? undefined
        : "not in a lab report: the lab's own sample preparation (e.g. \"Homogenisering, knusing\", SS-EN 15002) is not pre-treatment of the waste — pick one",
    })),
    ...[41, 42, 43, 44, 45, 46].map(n => ({
      field: `Checkbox${n}`, label: "Forbudt å deponere", src: "derived" as BkSrc, check: false,
      note: "left unticked = negative declaration; TOC and glødetap were not measured, so those two cannot be positively confirmed",
    })),
    { field: "TextField39", label: "Farge (beskriv)", src: "human", note: "GAP: visual observation, not in a lab report" },
    { field: "TextField40", label: "Lukt (beskriv)", src: "human", note: "GAP: visual observation, not in a lab report" },
    { field: "TextField41", label: "Må deponiet treffe ekstra forhåndsregler?",
      src: assessable ? "derived" : "human",
      value: assessable ? (s.isHazardous ? "Ja — se analyserapport." : "Nei — ingen HP-kategori utløst.") : undefined,
      note: assessable ? undefined : NO_VERDICT },

    // 5. Avfall som oppstår jevnlig
    { field: "group6", label: "Oppstår avfallet jevnlig?", src: "human", select: "Radio1",
      note: "Nei — single delivery; recurrence is a commercial fact" },
    ...Array.from({ length: 12 }, (_, i) => ({
      field: `TextField${42 + i}`, label: "Del 5 (jevnlig avfall)", src: "n/a" as BkSrc,
      note: "not applicable — waste does not arise regularly",
    })),
  ];

  // Waste-type column (Checkbox19..26, 39, 40) — driven by the matrix, with two corrections
  // from the big_test run (bk/BIG-TEST-FINDINGS.md finding 5):
  //
  //  * No "Annet" catch-all. The form's list has no asphalt row, and the human form for the Alta
  //    asphalt delivery left the whole column blank rather than ticking "Annet". A matrix the
  //    form does not name is a matrix this column cannot express.
  //  * `Prøvetype` is the lab's intake category, not the waste type. "Uspesifisert jord" is the
  //    lab saying it does not know, and it ticked "Jord og sediment som er forurenset" on a
  //    betongslam delivery the human filed as "Avløpsslam". A non-answer ticks nothing.
  //
  // What survives is a real signal — "Betong" really does mean "Betong eller tegl" — so the tick
  // stays, as a `human` suggestion the reviewer confirms rather than an extracted fact.
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
    { box: 40, label: "Annet", match: /$^/ },
  ];
  /** The lab booking the sample in as "unspecified" is not a statement about the waste. */
  const UNSPECIFIED_MATRIX = /uspesifisert|unspecified|ukjent|ikke\s+spesifisert/i;

  const matrix = (m.matrixType ?? "").trim();
  const usable = matrix && !UNSPECIFIED_MATRIX.test(matrix);
  const ticked = usable ? MATRIX_CHECKBOX.find(c => c.match.test(matrix))?.box ?? null : null;

  for (const c of MATRIX_CHECKBOX) {
    const isTicked = ticked === c.box;
    fields.push({
      field: `Checkbox${c.box}`,
      label: `Avfallstype (materiale): ${c.label}`,
      src: "human",
      check: isTicked,
      ...(isTicked ? cite(s, "matrixType") : {}),
      note: isTicked
        ? `suggestion from Prøvetype "${matrix}" — Prøvetype is the lab's intake category, not the waste type. Confirm`
        : !matrix
          ? "GAP: no matrix/material type was read from the document"
          : !usable
            ? `Prøvetype "${matrix}" states no material — pick the row that describes the delivery`
            : ticked === null
              ? `Prøvetype "${matrix}" is not one of the form's listed waste types — pick a row, or leave the column blank`
              : undefined,
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
