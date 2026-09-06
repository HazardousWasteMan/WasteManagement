import ealKoder from "../data/eal-koder-full.json";

// Real catalogue quirk, not a bug: some EAL chapters have no mirror pair in either
// direction. Chapters 1301-1305, 1307, 1308, and 1406 (oils, solvents, refrigerants — 1306
// does not exist in the real catalogue) are entirely hazardous — assignEalCode correctly
// returns "no matching EAL code found" rather than a
// guess when isHazardous=false for these origins. Chapter 2003 (other municipal waste) is
// the inverse: entirely non-hazardous, so isHazardous=true correctly yields no match there.
// See tests/hp-classification/eal.test.ts for the real, verified examples.

export interface EalAssignment {
  code: string | null;
  description: string | null;
  /** Internal/machine-facing status — kept in English, matching this file's other note/log text. */
  confidence: string;
  /** Same status, in Norwegian — for the generated document text (buildDescription's "Merk:"
   * sentence), which is otherwise entirely Norwegian. Never mix languages in that sentence. */
  confidenceNo: string;
}

export function assignEalCode(
  isHazardous: boolean | null,
  originProcess: string | null,
  labStatedEalCode: string | null,
  originToChapterLookup: Record<string, string>
): EalAssignment {
  if (isHazardous === null) {
    return {
      code: null, description: null,
      confidence: "indeterminate — hazard status could not be determined (leaching-test data only), cannot assign an EAL code",
      confidenceNo: "ikke bestemt — farestatus kunne ikke fastslås (kun utlekkingstest-data), kan ikke tildele EAL-kode",
    };
  }

  if (!originProcess) {
    return {
      code: null, description: null,
      confidence: "HALT — missing origin/process metadata, cannot select EAL chapter",
      confidenceNo: "STANS — mangler informasjon om opprinnelse/prosess, kan ikke velge EAL-kapittel",
    };
  }

  const chapter = originToChapterLookup[originProcess];
  if (!chapter) {
    return {
      code: null, description: null,
      confidence: `no chapter mapping found for origin process "${originProcess}"`,
      confidenceNo: `fant ingen kapittelmapping for opprinnelse/prosess «${originProcess}»`,
    };
  }

  const candidates = ealKoder.filter(e => e.nivaa === 3 && e.kode.startsWith(chapter) && e.farlig === isHazardous);
  if (candidates.length === 0) {
    return {
      code: null, description: null,
      confidence: `no matching EAL code found in chapter ${chapter} for hazardous=${isHazardous}`,
      confidenceNo: `fant ingen samsvarende EAL-kode i kapittel ${chapter} for farlig=${isHazardous}`,
    };
  }
  const match = candidates[0];
  const code = `${match.kode.slice(0, 2)} ${match.kode.slice(2, 4)} ${match.kode.slice(4, 6)}${match.farlig ? "*" : ""}`;

  let confidence: string;
  let confidenceNo: string;
  if (labStatedEalCode) {
    if (code === labStatedEalCode) {
      confidence = "high — engine agrees with lab's own classification";
      confidenceNo = "høy — motoren er enig med laboratoriets egen klassifisering";
    } else {
      confidence = "FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed";
      confidenceNo = "FLAGG FOR GJENNOMGANG — motoren er uenig med laboratoriet, ikke fortsett automatisk";
    }
  } else if (candidates.length > 1) {
    const codeList = candidates.map(c => c.kode).join(", ");
    confidence = `AMBIGUOUS — multiple EAL codes match chapter/hazard status (${codeList}), used first match — manual review recommended`;
    confidenceNo = `TVETYDIG — flere EAL-koder samsvarer med kapittel/farestatus (${codeList}), brukte første treff — manuell gjennomgang anbefales`;
  } else {
    confidence = "engine-derived, no independent lab classification to cross-check against";
    confidenceNo = "avledet av motoren, ingen uavhengig laboratorieklassifisering å sammenligne mot";
  }

  // Prefer the real English translation; fall back to the Norwegian description only for the
  // handful of honest gap entries (see eal-koder-full.json's missingEnglishTranslation field) —
  // never a blank or fabricated string.
  return { code, description: match.beskrivelseEn ?? match.beskrivelse, confidence, confidenceNo };
}
