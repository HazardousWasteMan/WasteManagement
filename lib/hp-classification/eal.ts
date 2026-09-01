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

// Words that appear in half the catalogue and so carry no signal when matching a description.
const STOPWORDS = new Set([
  "avfall", "annet", "andre", "annen", "nevnt", "enn", "den", "det", "dem", "som", "eller", "og",
  "fra", "med", "uten", "inneholder", "farlige", "stoffer", "waste", "wastes", "other", "than",
  "those", "mentioned", "containing", "dangerous", "substances", "from", "and", "the",
  // Catalogue boilerplate: "Avfall som ikke er spesifisert andre steder" is the -99 entry of
  // every chapter, so these words match everything and mean nothing.
  "spesifisert", "steder", "specified", "elsewhere", "blandinger", "fraksjoner",
  // Lab non-answers. "Uspesifisert jord" scored against 10 13 99 "…ikke spesifisert andre
  // steder" and won, which is worse than admitting the hint was empty.
  "uspesifisert", "unspecified", "ukjent", "unknown", "diverse",
]);

const tokens = (s: string): Set<string> =>
  new Set(
    s.toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w))
  );

/**
 * How well a candidate's own description matches what we know the waste is.
 *
 * Without this the picker took `candidates[0]`, which is file order — for a non-hazardous
 * chapter-1013 sample that is `10 13 01 "Avfall av råstoffblanding før varmebehandling"`, where
 * the real answer for a concrete-sludge delivery is `10 13 14 "Betongavfall og betongslam"` nine
 * entries later. File order is not a ranking, and a chapter can hold nine candidates.
 */
function describeScore(hint: Set<string>, beskrivelse: string, beskrivelseEn: string | null): number {
  if (hint.size === 0) return 0;
  const cand = tokens([beskrivelse, beskrivelseEn ?? ""].join(" "));
  let score = 0;
  for (const w of hint) {
    for (const c of cand) {
      // Norwegian compounds mean the hint word is often a prefix of the catalogue word
      // ("betong" in "betongavfall", "betongslam"), so containment counts, not just equality.
      if (c === w) { score += 2; break; }
      // Norwegian compounds put the hint word inside the catalogue word ("betong" in
      // "betongavfall"). Short fragments match far too much, so a partial needs real length.
      if (w.length >= 5 && (c.includes(w) || w.includes(c))) { score += 1; break; }
    }
  }
  return score;
}

/**
 * @param descriptionHint What the waste is, in the words the document used (matrix, sample type,
 *                        free-text description). Used only to rank candidates within the chapter
 *                        the origin already fixed — it can never move the answer to another
 *                        chapter, and it never overrides the hazard filter.
 */
export function assignEalCode(
  isHazardous: boolean,
  originProcess: string | null,
  labStatedEalCode: string | null,
  originToChapterLookup: Record<string, string>,
  descriptionHint: string | null = null
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
  const hint = tokens(descriptionHint ?? "");
  const scored = candidates.map(c => ({ c, score: describeScore(hint, c.beskrivelse, c.beskrivelseEn) }));
  const best = Math.max(...scored.map(s => s.score));
  // A tie at the top is no better than file order, so only trust a single clear winner.
  const winners = scored.filter(s => s.score === best);
  const matchedOnDescription = best > 0 && winners.length === 1;
  const match = matchedOnDescription ? winners[0].c : candidates[0];
  const code = `${match.kode.slice(0, 2)} ${match.kode.slice(2, 4)} ${match.kode.slice(4, 6)}${match.farlig ? "*" : ""}`;

  let confidence: string;
  if (labStatedEalCode) {
    confidence = code === labStatedEalCode
      ? "high — engine agrees with lab's own classification"
      : "FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed";
  } else if (matchedOnDescription && candidates.length > 1) {
    confidence = `matched on description among ${candidates.length} candidates in chapter ${chapter} (${candidates.map(c => c.kode).join(", ")}) — confirm the code describes the delivery`;
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
