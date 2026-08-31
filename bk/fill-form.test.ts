// Fills the BK-skjema AcroForm from bk/pipeline-output.json + bk/classified.json and writes a
// per-field coverage report. Field names in the PDF are generic (TextField1..53, Checkbox1..46,
// groupN); the semantic mapping below was derived geometrically by bk/map_fields.py (widget
// rectangles joined to the nearest printed label) — see bk/field-map-raw.json.
//
// Every field carries a `src`, which is the actual point of this exercise:
//   "extracted"  — value came straight out of the extraction pipeline
//   "derived"    — computed by the classification engine from extracted values
//   "human"      — the pipeline cannot supply this; a person must
//   "receiver"   — section 1, filled by the landfill, not the producer
//   "n/a"        — legitimately not applicable to this waste/delivery
import { test, expect } from "vitest";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

type Src = "extracted" | "derived" | "human" | "receiver" | "n/a";
interface Spec { field: string; label: string; src: Src; value?: string; check?: boolean; select?: string; note?: string }

const dump = JSON.parse(fs.readFileSync("bk/pipeline-output.json", "utf-8"));
const cls = JSON.parse(fs.readFileSync("bk/classified.json", "utf-8"));
const m = dump.extraction.metadata;
const results = dump.extraction.results as { rawAnalyteName: string; analyteId: string | null; resultValue: number | null; isBelowLoq: boolean; loqValue: number | null; unitRaw: string }[];
const eal: string = cls.withOrigin.eal.code;          // "17 01 01"
const ealDigits = eal.replace(/\D/g, "");             // "170101"
const isHazardous: boolean = cls.withOrigin.hazard.isHazardous;

const detected = results.filter(r => !r.isBelowLoq && r.resultValue !== null && !/terrstoff|tørrstoff/i.test(r.rawAnalyteName));
const top = (n: number) => detected.slice(0, n).map(r => `${r.rawAnalyteName} ${r.resultValue} ${r.unitRaw}`).join("; ");

const description = [
  `${m.matrixType} fra ${m.customerName ?? "ukjent produsent"}. Prøve ${m.sampleMarking}, analysert av ${m.labName}, rapport ${m.externalReportNo} (prøvetatt ${m.samplingDate}, mottatt ${m.receiptDate}).`,
  `Kjemisk analyse omfatter metaller, Cr(VI), alifater/aromater, PAH16 og PCB7 — ${results.length} analyseparametere. Påviste verdier over LOQ: ${top(8)}.`,
  `Alle øvrige parametere under deteksjonsgrense. Vurdert mot HP1-HP15 (avfallsforskriften kap. 11 / forordning 1357/2014): ingen HP-kategori utløst, avfallet er ikke farlig avfall. Tildelt EAL-kode ${eal}.`,
  `Merk: ${cls.withOrigin.eal.confidence}.`,
  `Sammenstilte analyseresultater og analyserapport fra laboratoriet vedlegges.`,
].join(" ");

const SPECS: Spec[] = [
  { field: "group1", label: "Skjemaet gjelder: En enkelt leveranse", src: "human", select: "Radio1", note: "delivery type is a commercial fact, not in the lab report; single delivery assumed" },

  // 1. Fylles ut av avfallsmottaker
  { field: "TextField1", label: "Kundenummer", src: "receiver" },
  { field: "TextField2", label: "Prosjektnummer og navn", src: "receiver", note: "lab report carries referanse 'Alta lufthavn - PFAS-prosjektet' but extraction has no field for it" },
  { field: "TextField3", label: "Deponiets merknad", src: "receiver" },

  // 2. Avfallsprodusent
  { field: "TextField4", label: "Hentested for avfallet", src: "human", note: "site address not extracted (no metadata field for it)" },
  { field: "TextField5", label: "ID nr. fra avfallsprodusent", src: "extracted", value: m.sampleMarking, note: "PARTIAL: this is the lab's Prøvenr.; the producer's own marking (ENAT-BØF1-BO9OB1) was not captured" },
  { field: "TextField6", label: "Avfallsprodusent", src: "extracted", value: m.customerName ?? "" },
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

  // 3. Avfallstype og kode — EAL digits, one box each
  ...ealDigits.split("").map((d, i) => ({
    field: `TextField${17 + i}`, label: `EAL-kode siffer ${i + 1}`, src: "derived" as Src, value: d,
  })),
  ...[23, 24, 25, 26].map(n => ({ field: `TextField${n}`, label: "Avfallsstoffnummer NS 9431", src: "human" as Src, note: "avfallsstoffnummer-eal-crosswalk.json holds only 4 entries, none for chapter 1701" })),
  ...[27, 28, 29].map(n => ({ field: `TextField${n}`, label: "Næring", src: "human" as Src, note: "administrative code, not analysis data" })),
  ...[30, 31, 32, 33, 34].map(n => ({ field: `TextField${n}`, label: "Kommune", src: "human" as Src, note: "administrative code, not analysis data" })),

  { field: "Checkbox1", label: "Deponi for ordinært avfall", src: "derived", check: true, note: "CONSERVATIVE: non-hazardous, but no leaching test in the report, so inert cannot be claimed" },
  { field: "Checkbox2", label: "Deponi for inert avfall", src: "derived", check: false },
  { field: "Checkbox3", label: "Deponi for farlig avfall", src: "derived", check: false },
  { field: "Checkbox4", label: "Avfallstype: Ordinært avfall", src: "derived", check: !isHazardous },
  { field: "Checkbox5", label: "Avfallstype: Inert avfall", src: "derived", check: false },
  { field: "Checkbox6", label: "Avfallstype: Farlig avfall", src: "derived", check: isHazardous },
  { field: "Checkbox7", label: "Testpliktig: Nei", src: "derived", check: false },
  { field: "Checkbox8", label: "Testpliktig: Ja", src: "derived", check: true, note: "chemical analysis exists and is attached" },
  { field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "derived", check: false },
  { field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived", check: true, note: "hazardous substances detected above LOQ (PAH, alifater, Cr(VI)) but all below HP thresholds" },
  { field: "TextField35", label: "TOC %", src: "human", note: "GAP: TOC not measured in this report, and it is required for ordinært deponi" },
  { field: "TextField36", label: "Glødetap %", src: "human", note: "GAP: not measured in this report" },
  { field: "group2", label: "Ristetest", src: "derived", select: "Radio1", note: "Nei — no leaching test in the report" },
  { field: "group3", label: "Kolonnetest", src: "derived", select: "Radio1", note: "Nei — no column test in the report" },
  { field: "TextField37", label: "Tilstandsklasse 1-5 (gravemasser/jord/sediment)", src: "n/a", note: "matrix is concrete, not soil/sediment" },
  { field: "TextField38", label: "Beskriv avfallet og hvordan det oppstår", src: "derived", value: description },

  // 4. Avfallets egenskaper
  ...[11, 12, 13, 14, 15, 16, 17, 18].map(n => ({ field: `Checkbox${n}`, label: "Avfallets opprinnelse", src: "human" as Src, check: false, note: "GAP: extraction returned suggestedOriginProcess = null, so origin is unknown" })),
  { field: "Checkbox23", label: "Avfallstype: Betong eller tegl", src: "extracted", check: true, note: `from matrixType "${m.matrixType}"` },
  ...[19, 20, 21, 22, 24, 25, 26, 39, 40].map(n => ({ field: `Checkbox${n}`, label: "Avfallstype (annen)", src: "extracted" as Src, check: false })),
  ...[27, 28, 29, 30, 31, 32].map(n => ({ field: `Checkbox${n}`, label: "Fysiske egenskaper", src: "human" as Src, check: false, note: `GAP: physicalState "${m.physicalState}" does not map onto any of the form's six options` })),
  ...[33, 34, 35, 36, 37, 38].map(n => ({ field: `Checkbox${n}`, label: "Forbehandling", src: "human" as Src, check: false, note: "GAP: pre-treatment is not lab-report data" })),
  ...[41, 42, 43, 44, 45, 46].map(n => ({ field: `Checkbox${n}`, label: "Forbudt å deponere", src: "derived" as Src, check: false, note: "left unticked = negative declaration; note TOC/glødetap were not measured, so those two cannot be positively confirmed" })),
  { field: "TextField39", label: "Farge", src: "human", note: "GAP: not observed in a lab report" },
  { field: "TextField40", label: "Lukt", src: "human", note: "GAP: not observed in a lab report" },
  { field: "TextField41", label: "Må deponiet treffe ekstra forhåndsregler?", src: "derived", value: "Nei — ingen HP-kategori utløst." },

  // 5. Avfall som oppstår jevnlig
  { field: "group6", label: "Oppstår avfallet jevnlig?", src: "human", select: "Radio1", note: "Nei — single delivery; recurrence is a commercial fact" },
  ...[42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53].map(n => ({ field: `TextField${n}`, label: "Del 5 (jevnlig avfall)", src: "n/a" as Src, note: "not applicable — waste does not arise regularly" })),
];

test("fill the BK-skjema from the extraction", async () => {
  const pdf = await PDFDocument.load(fs.readFileSync("bk/bk-skjema-blank.pdf"), { updateMetadata: false });
  const form = pdf.getForm();
  const report: Record<string, unknown>[] = [];

  for (const s of SPECS) {
    let filled = false;
    if (s.select !== undefined) {
      form.getRadioGroup(s.field).select(s.select);
      filled = true;
    } else if (s.check !== undefined) {
      const cb = form.getCheckBox(s.field);
      if (s.check) { cb.check(); filled = true; } else { cb.uncheck(); }
    } else if (s.value) {
      form.getTextField(s.field).setText(s.value);
      filled = true;
    }
    report.push({ field: s.field, label: s.label, src: s.src, filled, value: s.select ?? s.check ?? s.value ?? null, note: s.note ?? null });
  }

  form.updateFieldAppearances();
  fs.writeFileSync("bk/bk-skjema-utfylt.pdf", await pdf.save());

  const bySrc = (src: Src) => report.filter(r => r.src === src);
  const summary = {
    totalFormFields: 103,
    fieldsMapped: report.length,
    filled: report.filter(r => r.filled).length,
    fromExtraction: bySrc("extracted").filter(r => r.filled).length,
    fromClassificationEngine: bySrc("derived").filter(r => r.filled).length,
    needsHuman: bySrc("human").length,
    landfillFills: bySrc("receiver").length,
    notApplicable: bySrc("n/a").length,
  };
  fs.writeFileSync("bk/coverage-report.json", JSON.stringify({ summary, fields: report }, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  expect(summary.filled).toBeGreaterThan(0);
});
