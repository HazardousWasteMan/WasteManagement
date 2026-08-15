export interface OriginOption {
  value: string;
  label: string;
  chapter: string;
}

// Real EAL origin/process options, transcribed from lib/data/eal-koder-full.json's level-2
// (nivaa: 2) descriptions across the 7 chapters the user identified as relevant to their
// customer base: 17 (construction/demolition), 13 (oils), 14 (organic solvents/refrigerants/
// propellants), 08 (paints/adhesives), 15 (packaging/absorbents), 16 (WEEE/batteries/misc),
// 20 (municipal waste). "escavo terre e rocce" is kept as the exact value string for chapter
// 1705 since it's already what the Italian sample fixture and the existing
// ORIGIN_TO_CHAPTER_LOOKUP key on — changing it would break that regression test.
//
// Real catalogue quirks (see eal.ts and eal.test.ts for the verified examples): chapters
// 1301-1305, 1307, 1308, and 1406 (1306 does not exist in the real catalogue) are entirely
// hazardous (no non-hazardous mirror code exists), so selecting one of these origins for
// a non-hazardous sample
// correctly yields "no matching EAL code found" rather than a guess. Chapter 2003 is the
// inverse — entirely non-hazardous.
export const ORIGIN_OPTIONS: OriginOption[] = [
  { value: "escavo terre e rocce", label: "Excavated soil or rock", chapter: "1705" },
  { value: "concrete, brick, tile, or ceramic waste", label: "Concrete, brick, tile, or ceramic waste", chapter: "1701" },
  { value: "wood, glass, or plastic waste", label: "Wood, glass, or plastic waste", chapter: "1702" },
  { value: "bituminous mixtures, coal tar, or tar products", label: "Bituminous mixtures, coal tar, or tar products", chapter: "1703" },
  { value: "metal waste", label: "Metal waste", chapter: "1704" },
  { value: "insulation material or asbestos-containing building material", label: "Insulation material or asbestos-containing building material", chapter: "1706" },
  { value: "gypsum-based building material", label: "Gypsum-based building material", chapter: "1708" },
  { value: "other construction/demolition waste", label: "Other construction/demolition waste", chapter: "1709" },
  { value: "hydraulic oil waste", label: "Hydraulic oil waste", chapter: "1301" },
  { value: "engine, gear, or lubricating oil waste", label: "Engine, gear, or lubricating oil waste", chapter: "1302" },
  { value: "transformer or heat-transfer oil waste", label: "Transformer or heat-transfer oil waste", chapter: "1303" },
  { value: "bilge oil waste", label: "Bilge oil waste", chapter: "1304" },
  { value: "oil/water separator content", label: "Oil/water separator content", chapter: "1305" },
  { value: "liquid fuel waste (heating oil, diesel, petrol)", label: "Liquid fuel waste (heating oil, diesel, petrol)", chapter: "1307" },
  { value: "other oil waste, not otherwise specified", label: "Other oil waste, not otherwise specified", chapter: "1308" },
  { value: "organic solvent, refrigerant, or propellant waste", label: "Organic solvent, refrigerant, or propellant waste", chapter: "1406" },
  { value: "paint or varnish production/use/removal waste", label: "Paint or varnish production/use/removal waste", chapter: "0801" },
  { value: "adhesive or sealant (incl. waterproofing) waste", label: "Adhesive or sealant (incl. waterproofing) waste", chapter: "0804" },
  { value: "packaging waste (incl. separately collected)", label: "Packaging waste (incl. separately collected)", chapter: "1501" },
  { value: "absorbents, filter materials, wiping cloths, or protective clothing", label: "Absorbents, filter materials, wiping cloths, or protective clothing", chapter: "1502" },
  { value: "electrical or electronic equipment waste (WEEE)", label: "Electrical or electronic equipment waste (WEEE)", chapter: "1602" },
  { value: "gas in pressurized containers or discarded chemicals", label: "Gas in pressurized containers or discarded chemicals", chapter: "1605" },
  { value: "batteries and accumulators", label: "Batteries and accumulators", chapter: "1606" },
  { value: "separately collected municipal waste fraction (excl. packaging)", label: "Separately collected municipal waste fraction (excl. packaging, see chapter 15 01)", chapter: "2001" },
  { value: "other municipal waste", label: "Other municipal waste", chapter: "2003" },
];

// All 20 real EAL top-level chapters, with their real English titles — transcribed from
// lib/data/eal-koder-full.json's nivaa:1 entries (all 20 have a real, non-gap beskrivelseEn;
// verified during this feature's design). Used only by the custom-chapter fallback below: when
// a user's origin process doesn't match any curated ORIGIN_OPTIONS entry, they still need to be
// able to place their sample in *some* real EAL chapter for manual review, and ORIGIN_OPTIONS
// only covers 7 of these 20 chapters. This constant is intentionally chapter-level (2-digit),
// not sub-chapter-level like ORIGIN_OPTIONS — assignEalCode already does the fine-grained work
// of picking among a chapter's real leaf codes (see eal.ts).
export interface EalChapter {
  chapter: string; // 2-digit EAL chapter code, e.g. "05"
  label: string;   // real English chapter title, sourced from eal-koder-full.json's nivaa:1 beskrivelseEn
}

export const EAL_CHAPTERS: EalChapter[] = [
  { chapter: "01", label: "Wastes resulting from exploration, Mining, Quarrying, Physical and Chemical treatment of Minerals" },
  { chapter: "02", label: "Wastes from Agriculture, Horticulture, Aquaculture, Forestry, Hunting and Fishing, Food Preparation and Processing" },
  { chapter: "03", label: "Wastes from Wood Processing and the Production of Panels and Furniture, Pulp, Paper and Cardboard" },
  { chapter: "04", label: "Wastes from the Leather, Fur and Textile Industries" },
  { chapter: "05", label: "Wastes from the Petroleum Refining, Natural Gas Purification and Pyrolitic Treatment of Coal" },
  { chapter: "06", label: "Wastes from Inorganic Chemical Processes" },
  { chapter: "07", label: "Wastes from Organic Chemical Processes" },
  { chapter: "08", label: "Wastes from the MFSU of Coatings (Paints, Varnishes and Vitreous Enamels), Adhesives, Sealants and Printing Inks" },
  { chapter: "09", label: "Wastes from the Photographic Industry" },
  { chapter: "10", label: "Waste From Thermal Processes" },
  { chapter: "11", label: "Wastes from Chemical Surface Treatment and Coating of Metals and Other Materials, Non- Ferrous HydroMetallurgy" },
  { chapter: "12", label: "Wastes from Shaping and Physical and Mechanical Surface Treatment of Metals and Plastics" },
  { chapter: "13", label: "Oil Wastes and Wastes of Liquid Fuels (except edible oils and those in chapters 05,12 and 19)" },
  { chapter: "14", label: "Waste Organic Solvents, Refrigerants and Propellants (except 07 and 08)" },
  { chapter: "15", label: "Waste Packaging, Absorbents, Wiping Cloths, Filter Materials and Protective Clothing Not Otherwise Specified" },
  { chapter: "16", label: "Wastes Not Otherwise Specified in the List" },
  { chapter: "17", label: "Construction and Demolition Wastes (including Excavated Soil from Contaminated Sites)" },
  { chapter: "18", label: "Wastes From Human or Animal Health Care and/or Related Research (except kitchen wastes not arising from immediate health care)" },
  { chapter: "19", label: "Wastes from Waste Management Facilities, Off-Site Waste Water Treatment Plants and the Preparation of Water for Human Consumption and Water for Industrial Use" },
  { chapter: "20", label: "Municipal Wastes (Household Waste and Similar Commercial, Industrial and Institutional Wastes) Including Separately Collected Fractions" },
];

// Merges a request-scoped custom origin->chapter mapping into a base lookup, WITHOUT
// mutating the base object — each request gets its own merged copy, so a custom entry
// from one submission never leaks into another request's lookup.
export function withCustomOrigin(
  baseLookup: Record<string, string>,
  originProcess: string | null,
  customChapter: string | null
): Record<string, string> {
  if (!originProcess || !customChapter) return baseLookup;
  return { ...baseLookup, [originProcess]: customChapter };
}

// Derives the origin option matching a lab-stated EAL code's chapter, if the lab already told
// us. Strips everything except digits (handles "17 05 03*", "170503", spaces, the trailing "*"
// hazard marker) and takes the first 4 digits — the chapter. Returns null if the code is too
// short to contain a chapter, or if its chapter isn't one of the 25 curated ORIGIN_OPTIONS
// entries (this does NOT reach the wider 20-chapter catalogue — see the plan's Global
// Constraints for why that's a deliberate boundary, not an oversight).
export function deriveOriginFromLabCode(labStatedEalCode: string | null): string | null {
  if (!labStatedEalCode) return null;
  const digitsOnly = labStatedEalCode.replace(/[^0-9]/g, "");
  if (digitsOnly.length < 4) return null;
  const chapter = digitsOnly.slice(0, 4);
  const match = ORIGIN_OPTIONS.find(o => o.chapter === chapter);
  return match ? match.value : null;
}

// Combines both suggestion sources with a strict precedence: a lab-derived origin (grounded in
// the lab's own stated classification) always wins over Claude's inferred suggestion. Claude's
// suggestion is only used as a fallback, and only if it's actually a real ORIGIN_OPTIONS value
// — this function re-validates that defensively (extraction-time normalization already does
// this too, but this is a public function other code may call directly, so it never trusts an
// unvalidated string). Returns null when neither source yields a real, curated origin.
export function suggestOriginProcess(
  labStatedEalCode: string | null,
  claudeSuggested: string | null
): string | null {
  const fromLabCode = deriveOriginFromLabCode(labStatedEalCode);
  if (fromLabCode) return fromLabCode;
  if (claudeSuggested && ORIGIN_OPTIONS.some(o => o.value === claudeSuggested)) {
    return claudeSuggested;
  }
  return null;
}
