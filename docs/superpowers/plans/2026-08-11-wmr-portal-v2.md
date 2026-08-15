# WM Recovery Customer Portal v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing WasteMatch demo into a WM Recovery (WMR)-branded portal: dashboard-styled UI, a second "search by chemical" entry mode alongside PDF upload, and a real (not generic) partner network + case-study data sourced from WMR's published references.

**Architecture:** Same Next.js app, same 3-step wizard shell. Step 1 gains an Upload/Search toggle that both converge on the same `ClassificationResult`/`FacilityMatch` state. Matching now runs against a new `wmr-partners.json` dataset (real, case-study-documented WMR partners) instead of the generic Norwegian facility directory. A new case-study dataset (`wmr-cases.json`) surfaces "similar project" social proof on the Matches step. Visual layer is restyled toward a dark-forest-green/cream dashboard aesthetic via Tailwind v4 theme tokens and three new shared presentational components (stat/hero/progress cards).

**Tech Stack:** Next.js 16 (App Router), HeroUI v3, Tailwind v4, TypeScript, Vitest — all already in place, no new dependencies.

## Global Constraints

- No task history or persistence across sessions, no accounts/login (spec Non-goals) — the "project" framing is visual only, applied to the single active screening task.
- No public deployment under WMR's name/branding/domain — this is a private local prototype (spec Non-goals).
- No fabricated partner facilities or case studies — every partner and case must trace to a real fact from `wmrecovery.no/references/` (spec Non-goals / §3–4).
- No changes to `/api/extract`'s underlying extraction logic — only its visual presentation changes (spec Non-goals).
- Coverage gaps (business areas with no documented partner) must be shown honestly, never papered over with an invented facility (spec §3, Error handling).
- Search-mode classification must never fabricate a result on an unmatched query — explicit "no matching waste code found," matching the existing "no false positives" principle (spec §6, Error handling).

---

## File Structure

```
lib/
  types.ts                        # Modify: Facility gains dataConfidence "verified-partner", caseReferences?
  data/
    wmr-partners.json             # New: ~5 real WMR partners
    wmr-cases.json                # New: 7 real WMR case studies
  search-classify.ts              # New: classifyByQuery(query) — deterministic keyword lookup
  wmr-cases.ts                    # New: findSimilarCase(classification, cases)
  matching.ts                     # Unchanged (logic) — call sites switch data source
app/
  globals.css                     # Modify: forest/cream/lime theme tokens
  layout.tsx                      # Modify: metadata title/description
  api/
    search-classify/route.ts      # New
    classify/route.ts             # Modify: use wmr-partners.json instead of facilities.json
components/
  dashboard/
    DashboardCards.tsx            # New: StatCard, HeroCard, ProgressCard (shared presentational)
  wizard/
    Wizard.tsx                    # Modify: mode toggle, extracted-data state, project progress card
    UploadStep.tsx                # Modify: restyled dropzone
    SearchStep.tsx                # New: text-query entry mode
    ReviewStep.tsx                # Modify: hero card + extracted-composition card
    MatchesStep.tsx                # Modify: partner cards, honest gap message, similar-project card
tests/
  search-classify.test.ts         # New
  wmr-cases.test.ts               # New
  matching.test.ts                # Modify: test against wmr-partners-shaped data + gap scenario
```

---

### Task 1: Extend `Facility` type + real WMR partner data

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/data/wmr-partners.json`

**Interfaces:**
- Produces: `Facility` interface (extended), consumed by Task 4, 5, 9.

- [ ] **Step 1: Extend the `Facility` interface in `lib/types.ts`**

Change the existing `Facility` interface (currently lines 35-44) to:

```typescript
export interface Facility {
  id: string;
  name: string;
  orgNumber: string;
  address: string;
  municipality: string;
  acceptedEalCodes: string[];   // exact EAL codes from the facility's permit
  acceptedEalPrefixes: string[]; // broader categories, e.g. "17 05" accepts all of sub-chapter 17 05
  dataConfidence: "verified-permit" | "verified-partner" | "best-effort";
  caseReferences?: string[];    // ids into wmr-cases.json documenting this partner relationship
}
```

Only two changes from the current type: `dataConfidence` union gains `"verified-partner"`, and an optional `caseReferences?: string[]` field is added. `caseReferences` is optional so `lib/data/facilities.json` and `tests/matching.test.ts`'s existing literal `Facility` objects (which don't set it) keep compiling without modification.

- [ ] **Step 2: Run the build to confirm the type change alone doesn't break anything**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds (the type change is additive/widening only).

- [ ] **Step 3: Write `lib/data/wmr-partners.json`**

Real partners documented in WM Recovery's published case studies at `wmrecovery.no/references/`. All EAL codes used below must exist verbatim in `lib/data/eal-codes.json` — verify against that file before committing.

```json
[
  {
    "id": "miljoteknikk-rana",
    "name": "Miljøteknikk",
    "orgNumber": "",
    "address": "Rana, Norway",
    "municipality": "Rana",
    "acceptedEalCodes": ["17 05 03*"],
    "acceptedEalPrefixes": ["17 05"],
    "dataConfidence": "verified-partner",
    "caseReferences": ["odda-boliden", "scana-steel-jorpeland", "eramet-kvinesdal"]
  },
  {
    "id": "svaheia-landfill",
    "name": "Svåheia Landfill",
    "orgNumber": "",
    "address": "Egersund, Norway",
    "municipality": "Egersund",
    "acceptedEalCodes": ["17 05 03*", "17 05 04"],
    "acceptedEalPrefixes": ["17 05"],
    "dataConfidence": "verified-partner",
    "caseReferences": ["odda-boliden", "eramet-kvinesdal"]
  },
  {
    "id": "carmans-blue-belgium",
    "name": "Carmans Blue",
    "orgNumber": "",
    "address": "Belgium",
    "municipality": "",
    "acceptedEalCodes": ["17 05 03*"],
    "acceptedEalPrefixes": ["17 05"],
    "dataConfidence": "verified-partner",
    "caseReferences": ["bijela-shipyard"]
  },
  {
    "id": "unnamed-ore-treatment-be-de",
    "name": "Unnamed ore treatment/separation facility (Belgium/Germany)",
    "orgNumber": "",
    "address": "Belgium / Germany",
    "municipality": "",
    "acceptedEalCodes": [],
    "acceptedEalPrefixes": [],
    "dataConfidence": "verified-partner",
    "caseReferences": ["lkab-narvik"]
  },
  {
    "id": "unnamed-landfills-no-se",
    "name": "Unnamed licensed landfills (Norway/Sweden)",
    "orgNumber": "",
    "address": "Norway / Sweden",
    "municipality": "",
    "acceptedEalCodes": ["17 05 03*", "17 05 04"],
    "acceptedEalPrefixes": ["17 05"],
    "dataConfidence": "verified-partner",
    "caseReferences": ["goteborg-hamn"]
  }
]
```

Note: `unnamed-ore-treatment-be-de` intentionally has empty `acceptedEalCodes`/`acceptedEalPrefixes` — the current EAL code dataset has no mineral/ore-processing codes, so this partner genuinely cannot be matched by the classification engine. It's still listed for documentation/case-linking completeness, not to be matchable. This is a deliberate honest gap, not an oversight — do not add a fabricated code to make it "work."

- [ ] **Step 4: Validate JSON syntax**

```bash
node -e "
const data = JSON.parse(require('fs').readFileSync('lib/data/wmr-partners.json'));
if (!Array.isArray(data) || data.length !== 5) throw new Error('expected 5 partner entries');
const ealCodes = new Set(JSON.parse(require('fs').readFileSync('lib/data/eal-codes.json')).map(c => c.code));
for (const p of data) {
  for (const code of p.acceptedEalCodes) {
    if (!ealCodes.has(code)) throw new Error('unknown EAL code ' + code + ' on ' + p.id);
  }
}
console.log('valid:', data.length, 'partners, all EAL codes exist');
"
```

Expected: `valid: 5 partners, all EAL codes exist`

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/data/wmr-partners.json
git commit -m "feat: extend Facility type, add real WMR partner network data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: WMR case study data + similar-case lookup

**Files:**
- Create: `lib/data/wmr-cases.json`
- Create: `lib/wmr-cases.ts`
- Test: `tests/wmr-cases.test.ts`

**Interfaces:**
- Consumes: `ClassificationResult` from `lib/types.ts` (Task 1, unchanged shape).
- Produces: `findSimilarCase(classification: ClassificationResult, cases: WmrCase[]): WmrCase | null` and the `WmrCase` type, exported from `lib/wmr-cases.ts`, consumed by Task 9 (`MatchesStep.tsx`).

- [ ] **Step 1: Write `lib/data/wmr-cases.json`**

The 7 real WM Recovery reference projects, with real published facts. `ealChapters` is a curated tag (not published by WMR) mapping each case's material to the EAL chapter(s) it corresponds to in this app's own code list, used only for surfacing "similar project" — not claimed as WMR's own classification. `keywords` are case-insensitive substrings checked against the classified waste's description/compliance-flag text for a more specific match than chapter alone.

```json
[
  {
    "id": "odda-boliden",
    "projectName": "Odda Boliden — Green Zink Expansion",
    "location": "Odda, Norway",
    "client": "Boliden",
    "material": "Heavy-metal-contaminated soil, hazardous and non-hazardous",
    "quantity": "~35,000 MT hazardous soil",
    "whatWmrDid": "Sea transport and stabilization of hazardous soil; sea transport and final disposal of non-hazardous soil, clearing the site for a new production area.",
    "ealChapters": ["17"],
    "keywords": ["heavy metal", "heavy-metal"]
  },
  {
    "id": "slettebakken-bergen",
    "projectName": "Slettebakken Deponi",
    "location": "Bergen, Norway",
    "client": "Bergen Kommune (via VeDeCi)",
    "material": "Contaminated soil/materials from a historic municipal landfill",
    "quantity": "~65,000 MT",
    "whatWmrDid": "Transported and provided final treatment at licensed landfills for filtercake, outsorted waste, and peat produced by on-site soil washing.",
    "ealChapters": ["17"],
    "keywords": []
  },
  {
    "id": "lkab-narvik",
    "projectName": "LKAB Narvik",
    "location": "Narvik, Norway",
    "client": "LKAB (Luossavaara-Kiirunavaara AB)",
    "material": "Off-grade iron ore with moisture and foreign particles",
    "quantity": "~150,000 MT",
    "whatWmrDid": "Transported ore to treatment facilities in Belgium/Germany for separation and recovery, upgrading it to usable secondary raw material.",
    "ealChapters": [],
    "keywords": ["iron ore", "ore"]
  },
  {
    "id": "scana-steel-jorpeland",
    "projectName": "Scana Steel — Jørpeland",
    "location": "Jørpeland, Norway",
    "client": "Scana Steel",
    "material": "Contaminated hazardous soil plus filterdust from flue gas cleaning",
    "quantity": "~4,000 MT",
    "whatWmrDid": "Ground remediation, quayside loading, and transport/solidification of soil and filterdust.",
    "ealChapters": ["17"],
    "keywords": ["filterdust", "flue gas"]
  },
  {
    "id": "bijela-shipyard",
    "projectName": "Bijela Shipyard",
    "location": "Montenegro",
    "client": "Valgo",
    "material": "PFAS-contaminated soil (PFAS, heavy metals, organic components)",
    "quantity": "35,000 MT",
    "whatWmrDid": "Qualified a soil-washing plant in Belgium to wash the soil for reuse; residual filter cake sent for thermal destruction.",
    "ealChapters": ["17"],
    "keywords": ["pfas", "pfos", "perfluor"]
  },
  {
    "id": "goteborg-hamn",
    "projectName": "Gøteborg Hamn",
    "location": "Gothenburg, Sweden",
    "client": "Gothenburg Hamn (port authority)",
    "material": "Contaminated sediments from port maintenance dredging",
    "quantity": "~45,000 MT",
    "whatWmrDid": "Partial on-site stabilization, then transport and final disposal at landfills in Norway and Sweden selected by the sediments' properties.",
    "ealChapters": ["17"],
    "keywords": ["sediment", "dredg"]
  },
  {
    "id": "eramet-kvinesdal",
    "projectName": "Eramet Kvinesdal",
    "location": "Kvinesdal, Norway",
    "client": "Kvina Maskin (for Eramet Kvinesdal)",
    "material": "Contaminated hazardous soil from groundworks",
    "quantity": "~8,000 MT",
    "whatWmrDid": "Separated soil by stability — unstable soil to Miljøteknikk Rana for treatment, stable soil to a dedicated landfill cell.",
    "ealChapters": ["17"],
    "keywords": []
  }
]
```

- [ ] **Step 2: Write the failing test for `findSimilarCase`**

`tests/wmr-cases.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findSimilarCase } from "../lib/wmr-cases";
import type { ClassificationResult } from "../lib/types";

const pfasClassification: ClassificationResult = {
  ealCode: "17 05 03*",
  ealDescription: "Jord og stein som inneholder farlige stoffer",
  avfallsstoffnummer: "7022",
  avfallsstoffnummerDescription: "Oljeforurenset masse",
  complianceFlags: [
    {
      code: "POP",
      label: "POP-listed substance",
      detail: "Contains PFOS (perfluoroktansulfonsyre), listed as a Persistent Organic Pollutant.",
    },
  ],
  quantityKg: null,
  sourceDescription: "test",
};

const genericSoilClassification: ClassificationResult = {
  ...pfasClassification,
  complianceFlags: [],
};

const oreClassification: ClassificationResult = {
  ealCode: "99 99 99",
  ealDescription: "not in our chapter set",
  avfallsstoffnummer: null,
  avfallsstoffnummerDescription: null,
  complianceFlags: [],
  quantityKg: null,
  sourceDescription: "test",
};

describe("findSimilarCase", () => {
  it("prefers a keyword match over a generic chapter match", () => {
    const result = findSimilarCase(pfasClassification, [
      { id: "generic", projectName: "Generic", location: "", client: "", material: "", quantity: "", whatWmrDid: "", ealChapters: ["17"], keywords: [] },
      { id: "bijela-shipyard", projectName: "Bijela", location: "", client: "", material: "", quantity: "", whatWmrDid: "", ealChapters: ["17"], keywords: ["pfas", "pfos"] },
    ]);
    expect(result?.id).toBe("bijela-shipyard");
  });

  it("falls back to the first chapter match when no keyword matches", () => {
    const result = findSimilarCase(genericSoilClassification, [
      { id: "odda-boliden", projectName: "Odda", location: "", client: "", material: "", quantity: "", whatWmrDid: "", ealChapters: ["17"], keywords: [] },
    ]);
    expect(result?.id).toBe("odda-boliden");
  });

  it("returns null when no case matches by keyword or chapter", () => {
    const result = findSimilarCase(oreClassification, [
      { id: "odda-boliden", projectName: "Odda", location: "", client: "", material: "", quantity: "", whatWmrDid: "", ealChapters: ["17"], keywords: [] },
    ]);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/wmr-cases.test.ts
```

Expected: FAIL — `Cannot find module '../lib/wmr-cases'`.

- [ ] **Step 4: Write `lib/wmr-cases.ts`**

```typescript
import type { ClassificationResult } from "./types";

export interface WmrCase {
  id: string;
  projectName: string;
  location: string;
  client: string;
  material: string;
  quantity: string;
  whatWmrDid: string;
  ealChapters: string[];
  keywords: string[];
}

export function findSimilarCase(classification: ClassificationResult, cases: WmrCase[]): WmrCase | null {
  const haystack = (
    classification.ealDescription + " " +
    classification.complianceFlags.map(f => f.detail).join(" ")
  ).toLowerCase();

  const keywordMatch = cases.find(c =>
    c.keywords.some(k => haystack.includes(k.toLowerCase()))
  );
  if (keywordMatch) return keywordMatch;

  const chapter = classification.ealCode.slice(0, 2);
  return cases.find(c => c.ealChapters.includes(chapter)) ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/wmr-cases.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Validate the JSON data file's shape**

```bash
node -e "
const data = JSON.parse(require('fs').readFileSync('lib/data/wmr-cases.json'));
if (!Array.isArray(data) || data.length !== 7) throw new Error('expected 7 cases');
for (const c of data) {
  for (const key of ['id','projectName','location','client','material','quantity','whatWmrDid','ealChapters','keywords']) {
    if (!(key in c)) throw new Error('missing ' + key + ' on ' + c.id);
  }
}
console.log('valid:', data.length, 'cases');
"
```

Expected: `valid: 7 cases`

- [ ] **Step 7: Commit**

```bash
git add lib/data/wmr-cases.json lib/wmr-cases.ts tests/wmr-cases.test.ts
git commit -m "feat: add real WMR case studies and similar-project lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Chemical/waste-description search classifier

**Files:**
- Create: `lib/search-classify.ts`
- Test: `tests/search-classify.test.ts`

**Interfaces:**
- Consumes: `ClassificationResult`, `ComplianceFlag` from `lib/types.ts`; `lib/data/eal-codes.json`, `lib/data/pops.json`, `lib/data/avfallsstoffnummer.json`.
- Produces: `classifyByQuery(query: string): ClassificationResult | null`, consumed by Task 4 (`/api/search-classify`).

- [ ] **Step 1: Write the failing tests**

`tests/search-classify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyByQuery } from "../lib/search-classify";

describe("classifyByQuery", () => {
  it("classifies an asbestos query as EAL 17 06 05*", () => {
    const result = classifyByQuery("asbestos insulation from demolition");
    expect(result?.ealCode).toBe("17 06 05*");
  });

  it("classifies a spent-solvent query as EAL 07 01 04*", () => {
    const result = classifyByQuery("spent organic solvent from cleaning");
    expect(result?.ealCode).toBe("07 01 04*");
  });

  it("classifies a PFOS-contaminated soil query and flags POP", () => {
    const result = classifyByQuery("PFOS contaminated soil from remediation");
    expect(result?.ealCode).toBe("17 05 03*");
    expect(result?.complianceFlags.some(f => f.code === "POP")).toBe(true);
  });

  it("returns null for an unmatched, unrelated query", () => {
    const result = classifyByQuery("blue office chair");
    expect(result).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(classifyByQuery("")).toBeNull();
    expect(classifyByQuery("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/search-classify.test.ts
```

Expected: FAIL — `Cannot find module '../lib/search-classify'`.

- [ ] **Step 3: Implement `lib/search-classify.ts`**

```typescript
import ealCodes from "./data/eal-codes.json";
import pops from "./data/pops.json";
import avfallsstoffnummerList from "./data/avfallsstoffnummer.json";
import type { ClassificationResult, ComplianceFlag } from "./types";

interface KeywordRule {
  keywords: string[];
  code: string;
}

// Ordered — first matching rule wins. Keep more specific rules before
// broader ones (e.g. "contaminated soil" before plain "soil").
const KEYWORD_RULES: KeywordRule[] = [
  { keywords: ["asbestos", "asbest"], code: "17 06 05*" },
  { keywords: ["halogenated solvent", "chlorinated solvent"], code: "07 01 03*" },
  { keywords: ["solvent", "løsemiddel", "thinner"], code: "07 01 04*" },
  { keywords: ["drilling", "boreslam", "borekaks"], code: "01 05 05*" },
  { keywords: ["used oil", "spent oil", "motor oil", "lubricating oil"], code: "13 02 05*" },
  { keywords: ["oily sludge", "tank bottom", "oil sludge"], code: "05 01 06*" },
  { keywords: ["contaminated soil", "hazardous soil", "pfas", "pfos"], code: "17 05 03*" },
  { keywords: ["soil", "jord"], code: "17 05 04" },
];

export function classifyByQuery(query: string): ClassificationResult | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const rule = KEYWORD_RULES.find(r => r.keywords.some(k => q.includes(k)));
  if (!rule) return null;

  const eal = ealCodes.find(c => c.code === rule.code);
  if (!eal) return null;

  const hazardous = eal.code.endsWith("*");

  const avfallsstoffnummer = hazardous
    ? avfallsstoffnummerList.find(a => a.relatedEalPrefixes.some(p => eal.code.startsWith(p)))
    : undefined;

  const complianceFlags: ComplianceFlag[] = [];
  if (hazardous) {
    complianceFlags.push({
      code: "HAZARDOUS",
      label: "Hazardous waste (farlig avfall)",
      detail: `EAL code ${eal.code} is classified as hazardous under the European Waste List.`,
    });
  }

  const popMatch = pops.find(p => (p.aliases ?? []).some(alias => q.includes(alias.toLowerCase())));
  if (popMatch) {
    complianceFlags.push({
      code: "POP",
      label: "POP-listed substance",
      detail: `Contains ${popMatch.substance}, listed as a Persistent Organic Pollutant.`,
    });
  }

  if (hazardous) {
    complianceFlags.push({
      code: "CROSS_BORDER_SHIPMENT",
      label: "Cross-border shipment rules apply",
      detail: "Hazardous waste crossing an EU/EEA border is subject to the EU Waste Shipment Regulation and Basel Convention notification/consent procedures.",
    });
  }

  return {
    ealCode: eal.code,
    ealDescription: eal.description,
    avfallsstoffnummer: avfallsstoffnummer?.number ?? null,
    avfallsstoffnummerDescription: avfallsstoffnummer?.description ?? null,
    complianceFlags,
    quantityKg: null,
    sourceDescription: query,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/search-classify.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/search-classify.ts tests/search-classify.test.ts
git commit -m "feat: add deterministic chemical/waste-description search classifier

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Search API route + switch classify route to WMR partner data

**Files:**
- Create: `app/api/search-classify/route.ts`
- Modify: `app/api/classify/route.ts`

**Interfaces:**
- Consumes: `classifyByQuery` (Task 3), `findMatches` (unchanged), `wmr-partners.json` (Task 1).
- Produces: `POST /api/search-classify` accepting `{ query: string }`, returning `{ classification, matches }` or `{ error }` (400/404) — consumed by Task 7 (`SearchStep.tsx`).

- [ ] **Step 1: Implement `app/api/search-classify/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { classifyByQuery } from "@/lib/search-classify";
import { findMatches } from "@/lib/matching";
import wmrPartners from "@/lib/data/wmr-partners.json";
import type { Facility } from "@/lib/types";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const query = (body as { query?: unknown } | null)?.query;
  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "Missing search query" }, { status: 400 });
  }

  const classification = classifyByQuery(query);
  if (!classification) {
    return NextResponse.json(
      { error: "No matching waste code found for that description" },
      { status: 404 }
    );
  }

  const matches = findMatches(classification, wmrPartners as Facility[]);
  return NextResponse.json({ classification, matches });
}
```

- [ ] **Step 2: Update `app/api/classify/route.ts` to use `wmr-partners.json`**

Change the import from `facilities.json` to `wmr-partners.json`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { classifyWaste } from "@/lib/classification";
import { findMatches } from "@/lib/matching";
import { validateExtractedWasteData } from "@/lib/extraction";
import wmrPartners from "@/lib/data/wmr-partners.json";

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const data = body.data;

  if (!data) {
    return NextResponse.json({ error: "Missing extracted waste data" }, { status: 400 });
  }

  if (!validateExtractedWasteData(data)) {
    return NextResponse.json({ error: "Malformed extracted waste data" }, { status: 400 });
  }

  const classification = classifyWaste(data);
  const matches = findMatches(classification, wmrPartners as never);

  return NextResponse.json({ classification, matches });
}
```

- [ ] **Step 3: Run the build**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds, both `/api/classify` and `/api/search-classify` listed as dynamic routes.

- [ ] **Step 4: Manually verify both routes**

```bash
npm run dev -- --port 3100 &
sleep 3

echo "--- search-classify: asbestos ---"
curl -s -X POST http://localhost:3100/api/search-classify \
  -H "Content-Type: application/json" \
  -d '{"query":"asbestos insulation panels"}' | python3 -m json.tool

echo "--- search-classify: unmatched ---"
curl -s -X POST http://localhost:3100/api/search-classify \
  -H "Content-Type: application/json" \
  -d '{"query":"office furniture"}' -w "\n%{http_code}\n"

echo "--- search-classify: organic solvent (should have NO partner match — coverage gap) ---"
curl -s -X POST http://localhost:3100/api/search-classify \
  -H "Content-Type: application/json" \
  -d '{"query":"spent organic solvent"}' | python3 -m json.tool

kill %1 2>/dev/null
```

Expected: asbestos query returns `classification.ealCode: "17 06 05*"` and a non-empty `matches` array (Miljøteknikk/Svåheia both accept `17 05`-prefixed codes — note asbestos is `17 06`, not `17 05`, so confirm whether matches is empty here; if empty, that's the correct honest-gap case, not a bug — the partner data only documents soil-category (`17 05`) coverage, not asbestos (`17 06`) specifically). Unmatched query returns 404. Solvent query classifies successfully but returns an empty `matches` array (no documented partner for chapter 07) — this is the expected coverage-gap case Task 9 will render an honest message for.

- [ ] **Step 5: Commit**

```bash
git add app/api/search-classify/route.ts app/api/classify/route.ts
git commit -m "feat: add search-classify route, switch classify route to WMR partner data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Update `matching.ts` tests for the new confidence tier and coverage-gap scenario

**Files:**
- Modify: `tests/matching.test.ts`

**Interfaces:**
- Consumes: `findMatches` (unchanged signature/logic), `Facility` (Task 1's extended type).

`findMatches()` itself needs no code changes — this task only strengthens its test coverage to reflect the new `"verified-partner"` tier and to explicitly assert the coverage-gap (empty-result) case using WMR-shaped data, since that's now a real, expected demo scenario rather than an edge case.

- [ ] **Step 1: Add a coverage-gap test case to `tests/matching.test.ts`**

Add this test inside the existing `describe("findMatches", ...)` block (after the existing three tests):

```typescript
  it("returns no matches for a waste category with no documented WMR partner (coverage gap)", () => {
    const wmrShapedPartners: Facility[] = [
      {
        id: "miljoteknikk-rana",
        name: "Miljøteknikk",
        orgNumber: "",
        address: "Rana, Norway",
        municipality: "Rana",
        acceptedEalCodes: ["17 05 03*"],
        acceptedEalPrefixes: ["17 05"],
        dataConfidence: "verified-partner",
        caseReferences: ["odda-boliden"],
      },
    ];
    const solventClassification: ClassificationResult = {
      ...classification,
      ealCode: "07 01 04*",
    };
    const results = findMatches(solventClassification, wmrShapedPartners);
    expect(results).toEqual([]);
  });
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npx vitest run
```

Expected: all tests pass (existing 3 `findMatches` tests + new 1 + Task 2's 3 + Task 3's 5 = 12 total across `matching.test.ts`, `wmr-cases.test.ts`, `search-classify.test.ts`, `classification.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add tests/matching.test.ts
git commit -m "test: add coverage-gap scenario to matching tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Visual foundation — theme tokens + shared dashboard cards

**Files:**
- Modify: `app/globals.css`
- Create: `components/dashboard/DashboardCards.tsx`

**Interfaces:**
- Produces: `StatCard`, `HeroCard`, `ProgressCard` components exported from `components/dashboard/DashboardCards.tsx`, consumed by Tasks 7-9.

- [ ] **Step 1: Replace the theme tokens in `app/globals.css`**

Replace the full file content with:

```css
@import "tailwindcss";
@import "@heroui/styles";

:root {
  --background: #f5f1e8;
  --foreground: #0d2b1f;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-forest: #0d2b1f;
  --color-forest-light: #163a29;
  --color-cream: #f5f1e8;
  --color-lime: #a8e05f;
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}
```

This drops the `prefers-color-scheme: dark` media-query override that was in the file — the branded cream/forest look is deliberate and applies regardless of system theme, consistent with the reference dashboard images (a considered design choice, not an oversight).

- [ ] **Step 2: Write `components/dashboard/DashboardCards.tsx`**

```tsx
export function StatCard({ label, value, sublabel }: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur border border-black/5 px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-black/50">{label}</p>
      <p className="text-2xl font-semibold text-forest">{value}</p>
      {sublabel && <p className="text-xs text-black/40 mt-1">{sublabel}</p>}
    </div>
  );
}

export function HeroCard({ label, value, sublabel, children }: {
  label: string;
  value: string;
  sublabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-forest text-cream px-6 py-5">
      <p className="text-xs uppercase tracking-wide text-lime/80">{label}</p>
      <p className="text-3xl font-semibold text-lime mt-1">{value}</p>
      {sublabel && <p className="text-sm text-cream/70 mt-1">{sublabel}</p>}
      {children}
    </div>
  );
}

export function ProgressCard({ stageLabel, stageIndex, totalStages, stageNames }: {
  stageLabel: string;
  stageIndex: number; // 0-based
  totalStages: number;
  stageNames: string[];
}) {
  const percent = Math.round(((stageIndex + 1) / totalStages) * 100);
  return (
    <div className="rounded-2xl bg-forest text-cream px-6 py-5">
      <p className="text-xs uppercase tracking-wide text-cream/60">
        Stage {stageIndex + 1} of {totalStages}
      </p>
      <p className="text-lg font-medium mt-1">{stageLabel}</p>
      <div className="mt-3 h-2 rounded-full bg-forest-light overflow-hidden">
        <div
          className="h-full bg-lime rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-cream/50">
        {stageNames.map((name, i) => (
          <span key={name} className={i <= stageIndex ? "text-lime" : ""}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the build**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds (these components aren't wired up yet, but must compile cleanly on their own — verify no TypeScript errors by also running a type-only import check):

```bash
node -e "console.log('checking file exists:'); require('fs').accessSync('components/dashboard/DashboardCards.tsx'); console.log('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/dashboard/DashboardCards.tsx
git commit -m "feat: add forest/cream/lime theme tokens and shared dashboard card components

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wizard shell — Upload/Search toggle + project progress card

**Files:**
- Modify: `components/wizard/Wizard.tsx`
- Modify: `components/wizard/UploadStep.tsx`
- Create: `components/wizard/SearchStep.tsx`

**Interfaces:**
- Consumes: `POST /api/search-classify` (Task 4), `ProgressCard` (Task 6), `ExtractedWasteData`/`ClassificationResult`/`FacilityMatch` (existing types).
- Produces: `Wizard` now holds `extracted: ExtractedWasteData | null` state (re-added — this was removed as "dead state" in v1's final review but is needed again for Task 8's extracted-composition card) and passes it to `ReviewStep`. `SearchStep(props: { onClassified: (classification: ClassificationResult, matches: FacilityMatch[]) => void; onError: (message: string) => void })` — this exact prop shape is fixed here and consumed by Task 9's `ReviewStep` changes are NOT needed (only `Wizard.tsx` calls `SearchStep`).

- [ ] **Step 1: Write `components/wizard/SearchStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import type { ClassificationResult, FacilityMatch } from "@/lib/types";

export function SearchStep({ onClassified, onError }: {
  onClassified: (classification: ClassificationResult, matches: FacilityMatch[]) => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/search-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Search failed");
        return;
      }
      onClassified(body.classification, body.matches);
    } catch {
      onError("Could not reach the search service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col items-center gap-4 py-12">
        <p className="text-lg font-medium text-forest">Describe the waste or chemical</p>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="e.g. PFOS-contaminated soil, spent solvent, asbestos insulation"
          disabled={loading}
          className="w-full max-w-md rounded-xl border border-black/10 px-4 py-2 text-sm"
        />
        <Button variant="primary" onPress={handleSearch} isDisabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Find matching waste code"}
        </Button>
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 2: Update `components/wizard/Wizard.tsx`**

Replace the full file content with:

```tsx
"use client";
import { useState } from "react";
import { Tabs } from "@heroui/react";
import { UploadStep } from "./UploadStep";
import { SearchStep } from "./SearchStep";
import { ReviewStep } from "./ReviewStep";
import { MatchesStep } from "./MatchesStep";
import { ProgressCard } from "@/components/dashboard/DashboardCards";
import type { ExtractedWasteData, ClassificationResult, FacilityMatch } from "@/lib/types";

type Step = "upload" | "review" | "matches";
type EntryMode = "upload" | "search";

const STAGE_NAMES = ["Submitted", "Classified", "Matched", "In progress"];

export function Wizard() {
  const [step, setStep] = useState<Step>("upload");
  const [entryMode, setEntryMode] = useState<EntryMode>("upload");
  const [extracted, setExtracted] = useState<ExtractedWasteData | null>(null);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [matches, setMatches] = useState<FacilityMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleExtracted(data: ExtractedWasteData) {
    setError(null);
    setExtracted(data);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Classification failed");
        return;
      }
      setClassification(body.classification);
      setMatches(body.matches);
      setStep("review");
    } catch {
      setError("Could not reach the classification service.");
    }
  }

  function handleClassifiedFromSearch(result: ClassificationResult, foundMatches: FacilityMatch[]) {
    setError(null);
    setExtracted(null);
    setClassification(result);
    setMatches(foundMatches);
    setStep("review");
  }

  const stageIndex = step === "upload" ? 0 : step === "review" ? 1 : 2;

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 flex flex-col gap-6">
      <ProgressCard
        stageLabel={STAGE_NAMES[stageIndex]}
        stageIndex={stageIndex}
        totalStages={4}
        stageNames={STAGE_NAMES}
      />
      <Tabs
        selectedKey={step}
        onSelectionChange={key => setStep(key as Step)}
        aria-label="Wizard steps"
      >
        <Tabs.List>
          <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
          <Tabs.Tab id="review" isDisabled={!classification}>
            2. Review classification
          </Tabs.Tab>
          <Tabs.Tab id="matches" isDisabled={matches.length === 0 && step !== "matches"}>
            3. Matches
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="upload">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => setEntryMode("upload")}
                className={`px-4 py-2 rounded-full text-sm ${entryMode === "upload" ? "bg-forest text-cream" : "bg-black/5 text-forest"}`}
              >
                Upload PDF
              </button>
              <button
                onClick={() => setEntryMode("search")}
                className={`px-4 py-2 rounded-full text-sm ${entryMode === "search" ? "bg-forest text-cream" : "bg-black/5 text-forest"}`}
              >
                Search by chemical
              </button>
            </div>
            {entryMode === "upload" ? (
              <UploadStep onExtracted={handleExtracted} onError={setError} />
            ) : (
              <SearchStep onClassified={handleClassifiedFromSearch} onError={setError} />
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="review">
          {classification && (
            <ReviewStep
              classification={classification}
              extracted={extracted}
              onConfirm={() => setStep("matches")}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="matches">
          {classification && <MatchesStep classification={classification} matches={matches} />}
        </Tabs.Panel>
      </Tabs>
      {error && <p className="text-danger mt-4">{error}</p>}
    </div>
  );
}
```

Note: `ReviewStep`'s prop signature changes here to add `extracted: ExtractedWasteData | null` — Task 8 implements the component side of this change. `stageIndex` for the progress card intentionally maps `"upload"` → 0, `"review"` → 1, `"matches"` → 2; stage 3 ("In progress") is never reached by `stageIndex` from wizard state — it's rendered as a static trailing, dimmed label by `ProgressCard`'s `stageNames` list, matching the spec's "illustrative only" requirement for that stage.

- [ ] **Step 3: Restyle `components/wizard/UploadStep.tsx`'s dropzone**

Replace the bare `<input type="file">` block (currently lines 38-46) with a styled dropzone. Full updated file:

```tsx
"use client";
import { useState } from "react";
import { Card } from "@heroui/react";
import type { ExtractedWasteData } from "@/lib/types";

export function UploadStep({ onExtracted, onError }: {
  onExtracted: (data: ExtractedWasteData) => void;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      onExtracted(body.data);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col items-center gap-4 py-12">
        <label
          htmlFor="pdf-upload"
          className="w-full max-w-md rounded-2xl border-2 border-dashed border-forest/30 bg-cream/50 flex flex-col items-center gap-2 py-10 cursor-pointer hover:border-forest/60 transition-colors"
        >
          <p className="text-lg font-medium text-forest">Upload a waste characterization report</p>
          <p className="text-sm text-forest/60">Click to choose a PDF, or drag one here</p>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf"
            disabled={loading}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </label>
        {fileName && <p className="text-sm text-default-500">{fileName}</p>}
        {loading && <p className="text-sm">Extracting data…</p>}
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 4: Run the build**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: this build will FAIL at this point — `ReviewStep`'s current signature doesn't accept `extracted`, causing a type error. This is expected; Task 8 fixes it. Confirm the error is specifically about the `extracted` prop on `ReviewStep`, not something else.

- [ ] **Step 5: Commit**

```bash
git add components/wizard/Wizard.tsx components/wizard/UploadStep.tsx components/wizard/SearchStep.tsx
git commit -m "feat: add Upload/Search mode toggle and project progress card to wizard shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Review step — hero card + extracted composition card

**Files:**
- Modify: `components/wizard/ReviewStep.tsx`

**Interfaces:**
- Consumes: fixed prop signature from Task 7: `ReviewStep(props: { classification: ClassificationResult; extracted: ExtractedWasteData | null; onConfirm: () => void })`. `HeroCard`, `StatCard` from `components/dashboard/DashboardCards.tsx` (Task 6).

- [ ] **Step 1: Replace `components/wizard/ReviewStep.tsx`**

```tsx
"use client";
import { Card, Chip, Button } from "@heroui/react";
import { HeroCard, StatCard } from "@/components/dashboard/DashboardCards";
import type { ClassificationResult, ExtractedWasteData } from "@/lib/types";

export function ReviewStep({ classification, extracted, onConfirm }: {
  classification: ClassificationResult;
  extracted: ExtractedWasteData | null;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <HeroCard label="EAL Code" value={classification.ealCode} sublabel={classification.ealDescription} />

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Compliance flags"
          value={String(classification.complianceFlags.length)}
        />
        <StatCard
          label="Source"
          value={classification.sourceDescription}
        />
      </div>

      {classification.avfallsstoffnummer && (
        <StatCard
          label="Avfallsstoffnummer"
          value={classification.avfallsstoffnummer}
          sublabel={classification.avfallsstoffnummerDescription ?? undefined}
        />
      )}

      {classification.quantityKg !== null && (
        <StatCard label="Quantity" value={`${classification.quantityKg} kg`} />
      )}

      <div className="flex flex-wrap gap-2">
        {classification.complianceFlags.map(flag => (
          <Chip key={flag.code} color="warning" variant="soft" title={flag.detail}>
            {flag.label}
          </Chip>
        ))}
      </div>

      {extracted && (
        <Card>
          <Card.Content className="flex flex-col gap-3 py-6">
            <p className="text-sm font-medium text-forest">Extracted from your report</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <p className="text-black/50">Matrix</p>
              <p>{extracted.matrix}</p>
              {extracted.physicalCharacteristics.tphMgKg !== null && (
                <>
                  <p className="text-black/50">TPH</p>
                  <p>{extracted.physicalCharacteristics.tphMgKg} mg/kg</p>
                </>
              )}
              {extracted.physicalCharacteristics.phSU !== null && (
                <>
                  <p className="text-black/50">pH</p>
                  <p>{extracted.physicalCharacteristics.phSU} SU</p>
                </>
              )}
            </div>
            {Object.keys(extracted.tclpMetalsMgL).length > 0 && (
              <div>
                <p className="text-xs text-black/50 mb-1">TCLP Metals (mg/L)</p>
                <p className="text-sm">
                  {Object.entries(extracted.tclpMetalsMgL)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              </div>
            )}
            {Object.keys(extracted.volatileOrganicsMgKg).length > 0 && (
              <div>
                <p className="text-xs text-black/50 mb-1">Volatile Organics (mg/kg)</p>
                <p className="text-sm">
                  {Object.entries(extracted.volatileOrganicsMgKg)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              </div>
            )}
          </Card.Content>
        </Card>
      )}

      <Button variant="primary" onPress={onConfirm} className="self-start">
        Looks right → Find matches
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Run the build to confirm Task 7's expected error is now resolved**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/wizard/ReviewStep.tsx
git commit -m "feat: restyle review step as hero card, surface extracted composition

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Matches step — partner cards, honest coverage-gap message, similar-project card

**Files:**
- Modify: `components/wizard/MatchesStep.tsx`

**Interfaces:**
- Consumes: `findSimilarCase`, `WmrCase` from `lib/wmr-cases.ts` (Task 2); `wmr-cases.json` (Task 2); `StatCard` from `components/dashboard/DashboardCards.tsx` (Task 6). `MatchesStep`'s own prop signature (`classification`, `matches`) is unchanged from before.

- [ ] **Step 1: Replace `components/wizard/MatchesStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { StatCard } from "@/components/dashboard/DashboardCards";
import { findSimilarCase } from "@/lib/wmr-cases";
import wmrCases from "@/lib/data/wmr-cases.json";
import type { ClassificationResult, FacilityMatch } from "@/lib/types";

export function MatchesStep({ classification, matches }: {
  classification: ClassificationResult;
  matches: FacilityMatch[];
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const similarCase = findSimilarCase(classification, wmrCases);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification, matches }),
      });
      if (!res.ok) {
        setDownloadError("Could not generate the PDF report.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waste-report-${classification.ealCode.replace(/\s/g, "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
    } catch {
      setDownloadError("Could not reach the report service.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <StatCard label="Partner matches" value={String(matches.length)} />

      {matches.length === 0 && (
        <Card>
          <Card.Content className="py-6">
            <p className="font-medium text-forest">
              This falls within WM Recovery&rsquo;s stated business areas.
            </p>
            <p className="text-sm text-black/60 mt-1">
              No specific partner facility is documented in this prototype for EAL code{" "}
              {classification.ealCode}. In production this would route to WMR&rsquo;s live
              partner network across Switzerland, the Netherlands, Belgium, Denmark, Sweden,
              Norway, Ireland, the UK, Italy, and Germany.
            </p>
          </Card.Content>
        </Card>
      )}

      {matches.map(match => (
        <Card key={match.facility.id}>
          <Card.Content>
            <p className="font-medium text-forest">{match.facility.name}</p>
            <p className="text-sm text-default-500">
              {match.facility.address}
              {match.facility.municipality ? `, ${match.facility.municipality}` : ""}
            </p>
            <p className="text-sm">
              Matched on permitted code: {match.matchedOn} ({match.matchType} match)
            </p>
            <p className="text-xs text-black/40 mt-1 uppercase tracking-wide">
              {match.facility.dataConfidence === "verified-partner"
                ? "Documented WMR partner"
                : match.facility.dataConfidence}
            </p>
          </Card.Content>
        </Card>
      ))}

      {similarCase && (
        <Card>
          <Card.Content className="py-6 flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wide text-black/40">Similar project</p>
            <p className="font-medium text-forest">
              {similarCase.projectName} — {similarCase.location}
            </p>
            <p className="text-sm text-black/60">
              {similarCase.quantity} of {similarCase.material.toLowerCase()}
            </p>
            <p className="text-sm">{similarCase.whatWmrDid}</p>
          </Card.Content>
        </Card>
      )}

      <Button variant="primary" onPress={handleDownload} isDisabled={downloading} className="self-start">
        {downloading ? "Generating…" : "Download PDF report"}
      </Button>
      {downloadError && <p className="text-danger">{downloadError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Run the build**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests still pass (this task made no changes to `lib/` logic, only UI).

- [ ] **Step 4: Commit**

```bash
git add components/wizard/MatchesStep.tsx
git commit -m "feat: restyle matches step, add honest coverage-gap message and similar-project card

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: WMR branding — header, metadata, end-to-end verification

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/BrandHeader.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing new — static content only.
- Produces: `BrandHeader` rendered above `<Wizard />` in `app/page.tsx`.

- [ ] **Step 1: Write `components/BrandHeader.tsx`**

```tsx
export function BrandHeader() {
  return (
    <header className="bg-forest text-cream py-8 px-4">
      <div className="max-w-3xl mx-auto flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-lime">Waste & Mineral Recovery AS</p>
        <h1 className="text-2xl font-semibold">Can we place your waste stream?</h1>
        <p className="text-sm text-cream/70 max-w-xl">
          WM Recovery supplies sustainable and circular solutions for industrial wastes,
          contaminated soils, and off-grade minerals and metals — through our network of
          recycling and disposal partners across Europe. Upload a lab report or describe
          your waste stream to see how we can help.
        </p>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Update `app/page.tsx`**

```tsx
import { Wizard } from "@/components/wizard/Wizard";
import { BrandHeader } from "@/components/BrandHeader";

export default function Home() {
  return (
    <>
      <BrandHeader />
      <Wizard />
    </>
  );
}
```

- [ ] **Step 3: Update metadata in `app/layout.tsx`**

Change the `metadata` export (currently lines 16-19):

```typescript
export const metadata: Metadata = {
  title: "WM Recovery — Waste Screening Portal",
  description: "Find out whether WM Recovery's partner network can process and match your industrial waste, contaminated soil, or off-grade minerals.",
};
```

- [ ] **Step 4: Run the build**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Full manual end-to-end verification**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Open `http://localhost:3100` in the browser preview and confirm:
1. Branded header renders with WMR's name and description.
2. Progress card shows "Stage 1 of 4 — Submitted" initially.
3. Step 1 shows the Upload/Search toggle; switching between them swaps the visible input.
4. Search mode: enter "asbestos insulation", confirm it advances to Review with a dark hero card showing `17 06 05*`.
5. Review step: confirm no extracted-composition card renders for a search-mode result (since `extracted` is `null` in that path) — this is correct, not a bug.
6. Click "Looks right → Find matches" — confirm Matches step shows either a partner card or the honest coverage-gap message, and (if applicable) a "Similar project" card.
7. Re-run one of the six reference sample PDFs (`docs/superpowers/specs/samples/00_TankBottomSludge_MOCKUP.pdf`, requires `ANTHROPIC_API_KEY` in `.env.local`) through the Upload path end to end — confirm the extracted-composition card DOES render on Review (since `extracted` is populated in this path), and the progress card advances through all three real stages.

```bash
kill %1 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/page.tsx components/BrandHeader.tsx
git commit -m "feat: add WMR branding header and update site metadata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §1 visual redesign (Tasks 6, 8, 9) ✓, §2 project progress framing (Task 7's `ProgressCard`) ✓, §3 real partner network + coverage-gap honesty (Tasks 1, 4, 9) ✓, §4 case studies as social proof (Tasks 2, 9) ✓, §5 branding (Task 10) ✓, §6 unified upload/search entry (Tasks 3, 4, 7) ✓, extracted-composition visibility gap closed (Task 8) ✓, styled dropzone (Task 7) ✓.
- **Placeholder scan:** none found — every data file has real, sourced content; every code step has complete code.
- **Type consistency:** `ReviewStep`'s new `extracted` prop is introduced in Task 7 (the `Wizard.tsx` call site) and its component-side implementation lands in Task 8 — the intentional one-task gap where `npm run build` fails is called out explicitly in Task 7 Step 4 so the implementer isn't alarmed by it. `findSimilarCase`'s signature (`(classification, cases) => WmrCase | null`) is fixed once in Task 2 and reused unchanged in Task 9. `Facility.caseReferences` is optional everywhere so `facilities.json`'s existing literals (untouched by this plan) keep compiling.
