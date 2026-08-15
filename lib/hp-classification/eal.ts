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
  confidence: string;
}

export function assignEalCode(
  isHazardous: boolean,
  originProcess: string | null,
  labStatedEalCode: string | null,
  originToChapterLookup: Record<string, string>
): EalAssignment {
  if (!originProcess) {
    return { code: null, description: null, confidence: "HALT — missing origin/process metadata, cannot select EAL chapter" };
  }

  const chapter = originToChapterLookup[originProcess];
  if (!chapter) {
    return { code: null, description: null, confidence: `no chapter mapping found for origin process "${originProcess}"` };
  }

  const candidates = ealKoder.filter(e => e.nivaa === 3 && e.kode.startsWith(chapter) && e.farlig === isHazardous);
  if (candidates.length === 0) {
    return { code: null, description: null, confidence: `no matching EAL code found in chapter ${chapter} for hazardous=${isHazardous}` };
  }
  const match = candidates[0];
  const code = `${match.kode.slice(0, 2)} ${match.kode.slice(2, 4)} ${match.kode.slice(4, 6)}${match.farlig ? "*" : ""}`;

  let confidence: string;
  if (labStatedEalCode) {
    confidence = code === labStatedEalCode
      ? "high — engine agrees with lab's own classification"
      : "FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed";
  } else if (candidates.length > 1) {
    confidence = `AMBIGUOUS — multiple EAL codes match chapter/hazard status (${candidates.map(c => c.kode).join(", ")}), used first match — manual review recommended`;
  } else {
    confidence = "engine-derived, no independent lab classification to cross-check against";
  }

  // Prefer the real English translation; fall back to the Norwegian description only for the
  // handful of honest gap entries (see eal-koder-full.json's missingEnglishTranslation field) —
  // never a blank or fabricated string.
  return { code, description: match.beskrivelseEn ?? match.beskrivelse, confidence };
}
