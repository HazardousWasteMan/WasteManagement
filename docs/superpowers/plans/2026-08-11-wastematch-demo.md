# WasteMatch Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pitch demo where a user uploads a waste characterization PDF, the app extracts composition data via Claude, classifies it against real Norwegian/EU waste codes with compliance flags, matches it to real permitted Norwegian facilities, and produces a downloadable PDF report.

**Architecture:** Single Next.js (App Router) app. Three server-side pieces: an `/api/extract` route (PDF → Claude → structured JSON), a pure-TypeScript classification/matching engine (JSON data in, ranked matches out, no LLM), and an `/api/report` route that renders the final result as a PDF. UI is a three-step HeroUI wizard (Upload → Review classification → Matches). No database — code lists and facility data ship as static JSON.

**Tech Stack:** Next.js 14+ (App Router, TypeScript), HeroUI + Tailwind CSS, `@anthropic-ai/sdk` for extraction, `pdf-parse` for PDF text extraction, `@react-pdf/renderer` for report generation, Vitest for unit tests.

## Global Constraints

- All UI text is in English (the customer conversation and pitch are in English; codebase is not the Norwegian-market fysioterapi project's convention — this is a separate, unrelated repo).
- No inline editing of extracted fields in v1 (spec: read-only review step).
- No database, no persistence between sessions (spec: static JSON only).
- No live scraping of Miljødirektoratet at runtime — all code lists and facility data are static JSON committed to the repo (spec: Data section).
- v1 facility scope is Norwegian facilities only (spec: Data section).
- Extraction/report generation failures must show explicit error states — never a silent fallback to fake data (spec: Error Handling).
- No match found must show an honest empty state, never a false positive (spec: Error Handling).
- Classification/matching engine is pure functions and gets real unit test coverage; the rest of the demo is manually verified (spec: Testing).

---

## File Structure

```
WastemanagementPortal/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # renders <Wizard />
│   ├── api/
│   │   ├── extract/route.ts        # Task 5
│   │   └── report/route.ts         # Task 7
├── components/
│   ├── wizard/
│   │   ├── Wizard.tsx              # Task 8 — top-level state machine
│   │   ├── UploadStep.tsx          # Task 8
│   │   ├── ReviewStep.tsx          # Task 9
│   │   └── MatchesStep.tsx         # Task 10
├── lib/
│   ├── data/
│   │   ├── eal-codes.json          # Task 2
│   │   ├── avfallsstoffnummer.json # Task 2
│   │   ├── pops.json               # Task 2
│   │   ├── nuklider.json           # Task 2
│   │   └── facilities.json         # Task 3
│   ├── types.ts                    # Task 1
│   ├── classification.ts           # Task 4
│   ├── matching.ts                 # Task 4
│   ├── extraction.ts               # Task 5 (Claude call, isolated from route handler)
│   └── report-pdf.tsx              # Task 7
├── tests/
│   ├── classification.test.ts      # Task 4
│   └── matching.test.ts            # Task 4
└── docs/superpowers/specs/2026-08-11-wastematch-demo-design.md   # existing, reference only
```

---

### Task 1: Project scaffold + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`
- Create: `lib/types.ts`

**Interfaces:**
- Produces (used by every later task): the types below, exported from `lib/types.ts`.

```typescript
// lib/types.ts

export interface ExtractedWasteData {
  sampleId: string;
  matrix: string;              // e.g. "Tank Bottom Sludge (Solid/Semi-Solid)"
  sourceDescription: string;   // e.g. "Blackrun Federal 14-2H Pad, Reeves County, TX"
  quantityKg: number | null;   // null if not determinable from the report
  physicalCharacteristics: {
    phSU: number | null;
    flashPointF: number | null;
    tphMgKg: number | null;
    ignitable: boolean | null;
  };
  tclpMetalsMgL: Record<string, number>;   // e.g. { arsenic: 0.041, lead: 0.612, ... }
  volatileOrganicsMgKg: Record<string, number>; // e.g. { benzene: 3.9, toluene: 22.6, ... }
  hazardIndicatorsNoted: string[];  // free-text flags the lab report itself calls out
}

export interface ComplianceFlag {
  code: "HAZARDOUS" | "POP" | "NUKLIDE" | "CROSS_BORDER_SHIPMENT";
  label: string;
  detail: string;
}

export interface ClassificationResult {
  ealCode: string;              // e.g. "05 01 06*"
  ealDescription: string;
  avfallsstoffnummer: string | null;
  avfallsstoffnummerDescription: string | null;
  complianceFlags: ComplianceFlag[];
  quantityKg: number | null;
  sourceDescription: string;
}

export interface Facility {
  id: string;
  name: string;
  orgNumber: string;
  address: string;
  municipality: string;
  acceptedEalCodes: string[];   // exact EAL codes from the facility's permit
  acceptedEalPrefixes: string[]; // broader categories, e.g. "05" accepts all of chapter 05
  dataConfidence: "verified-permit" | "best-effort";
}

export interface FacilityMatch {
  facility: Facility;
  matchType: "exact" | "prefix";
  matchedOn: string;   // the EAL code or prefix that matched
}
```

- [ ] **Step 1: Initialize the Next.js project**

```bash
cd /Users/evenmyrennybo/WastemanagementPortal
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --no-git
```

When prompted, accept defaults (Turbopack: yes).

- [ ] **Step 2: Install HeroUI, Anthropic SDK, PDF libs, Vitest**

```bash
npm install @heroui/react framer-motion @anthropic-ai/sdk pdf-parse @react-pdf/renderer
npm install -D vitest
```

- [ ] **Step 3: Configure Tailwind for HeroUI**

Edit `tailwind.config.ts` to match HeroUI's required setup:

```typescript
import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: { extend: {} },
  plugins: [heroui()],
};
export default config;
```

- [ ] **Step 4: Wrap the app in HeroUIProvider**

`app/layout.tsx`:

```tsx
import "./globals.css";
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Create `app/providers.tsx`:

```tsx
"use client";
import { HeroUIProvider } from "@heroui/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <HeroUIProvider>{children}</HeroUIProvider>;
}
```

- [ ] **Step 5: Add `lib/types.ts`**

Create the file with the full content shown in the Interfaces block above.

- [ ] **Step 6: Configure Vitest**

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 7: Verify the scaffold builds**

```bash
npm run build
```

Expected: build succeeds with the default Next.js starter page.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with HeroUI, Tailwind, Vitest, shared types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Regulatory code list data (EAL, avfallsstoffnummer, POPs, nuklider)

**Files:**
- Create: `lib/data/eal-codes.json`, `lib/data/avfallsstoffnummer.json`, `lib/data/pops.json`, `lib/data/nuklider.json`

**Interfaces:**
- Consumes: nothing.
- Produces: JSON files matching the shapes below, consumed by `lib/classification.ts` in Task 4.

```typescript
// eal-codes.json shape
type EalCode = {
  code: string;          // "05 01 06*"
  description: string;   // "oily sludge from maintenance operations of the plant or equipment"
  chapter: string;       // "05" — "Wastes from petroleum refining, natural gas purification..."
  hazardous: boolean;    // true if code ends in *
};

// avfallsstoffnummer.json shape
type Avfallsstoffnummer = {
  number: string;        // "7011"
  description: string;   // "Oljeholdig avfall" (Norwegian, kept as-is — it's the real registry term)
  relatedEalPrefixes: string[]; // EAL chapter/code prefixes this typically maps to, e.g. ["13", "05 01"]
};

// pops.json shape
type PopEntry = { substance: string; casNumber: string | null; note: string };

// nuklider.json shape
type NuklideEntry = { nuclide: string; note: string };
```

- [ ] **Step 1: Write `lib/data/eal-codes.json`**

Transcribe the real EAL/EAK chapters and specific codes needed to cover all six reference samples (Task 5's sample set — oily tank bottom sludge, petroleum-contaminated excavated soil, asbestos-containing demolition material, spent halogenated solvent, used oil sludge), from `https://avfallsdeklarering.miljodirektoratet.no/no/kodeverk/ealkoder`. At minimum, chapters 01 (mining/drilling), 05 (petroleum refining), 07 (organic chemical processes/solvents), 13 (oil wastes), 16 (wastes not otherwise specified), 17 (construction/demolition incl. asbestos). Include at minimum:

```json
[
  { "code": "05 01 06*", "description": "oily sludge from maintenance operations of the plant or equipment", "chapter": "05", "hazardous": true },
  { "code": "05 01 03*", "description": "tank bottom sludges", "chapter": "05", "hazardous": true },
  { "code": "05 01 99", "description": "wastes not otherwise specified", "chapter": "05", "hazardous": false },
  { "code": "13 05 06*", "description": "oil from oil/water separators", "chapter": "13", "hazardous": true },
  { "code": "13 05 08*", "description": "mixtures of wastes from grit chambers and oil/water separators", "chapter": "13", "hazardous": true },
  { "code": "13 02 05*", "description": "mineral-based non-chlorinated engine, gear and lubricating oils (used oil sludge)", "chapter": "13", "hazardous": true },
  { "code": "01 05 05*", "description": "oil-containing drilling muds and wastes", "chapter": "01", "hazardous": true },
  { "code": "01 05 06*", "description": "drilling muds and other drilling wastes containing dangerous substances", "chapter": "01", "hazardous": true },
  { "code": "16 07 08*", "description": "wastes containing oil", "chapter": "16", "hazardous": true },
  { "code": "17 05 03*", "description": "soil and stones containing dangerous substances", "chapter": "17", "hazardous": true },
  { "code": "17 05 04", "description": "soil and stones other than those mentioned in 17 05 03", "chapter": "17", "hazardous": false },
  { "code": "17 06 01*", "description": "insulation materials containing asbestos", "chapter": "17", "hazardous": true },
  { "code": "17 06 05*", "description": "construction materials containing asbestos", "chapter": "17", "hazardous": true },
  { "code": "07 01 03*", "description": "other organic solvents, washing liquids and mother liquors", "chapter": "07", "hazardous": true },
  { "code": "14 06 03*", "description": "other solvents and solvent mixtures", "chapter": "14", "hazardous": true }
]
```

Note: verify each code/description pair against the live page before committing — do not invent codes not present in the registry.

- [ ] **Step 2: Write `lib/data/avfallsstoffnummer.json`**

Transcribe the real avfallsstoffnummer entries relevant to oily/hydrocarbon waste from `https://avfallsdeklarering.miljodirektoratet.no/no/kodeverk/avfallsstoffnummer`:

```json
[
  { "number": "7011", "description": "Oljeholdig avfall", "relatedEalPrefixes": ["13", "05 01", "16 07"] },
  { "number": "7013", "description": "Oljeforurenset masse", "relatedEalPrefixes": ["17 05"] },
  { "number": "7015", "description": "Boreslam og borekaks", "relatedEalPrefixes": ["01 05"] }
]
```

Note: verify against the live page; adjust numbers/descriptions to match exactly what's published.

- [ ] **Step 3: Write `lib/data/pops.json` and `lib/data/nuklider.json`**

Transcribe from `https://avfallsdeklarering.miljodirektoratet.no/no/kodeverk/pops` and `.../nuklider`. Minimal viable set — enough entries that the compliance-flag matcher in Task 4 has real substances to check against (e.g. PFAS/PFOS entries for pops.json; the demo's sample PDF has no radioactive component, so nuklider.json can be a smaller reference list, still real data, not fabricated).

- [ ] **Step 4: Validate JSON syntax**

```bash
node -e "JSON.parse(require('fs').readFileSync('lib/data/eal-codes.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('lib/data/avfallsstoffnummer.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('lib/data/pops.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('lib/data/nuklider.json'))" && \
echo "all valid"
```

Expected: `all valid`

- [ ] **Step 5: Commit**

```bash
git add lib/data/eal-codes.json lib/data/avfallsstoffnummer.json lib/data/pops.json lib/data/nuklider.json
git commit -m "data: add real EAL, avfallsstoffnummer, POPs, nuklider code lists

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Facility dataset

**Files:**
- Create: `lib/data/facilities.json`

**Interfaces:**
- Consumes: `Facility` type from `lib/types.ts` (Task 1).
- Produces: `lib/data/facilities.json`, consumed by `lib/matching.ts` in Task 4.

- [ ] **Step 1: Research and write 15-20 real facility records**

Source real facility names/addresses/org numbers from `https://avfallsdeklarering.miljodirektoratet.no/no/avfallsmottak`. For each, research its publicly available tillatelse (permit) to find real accepted EAL codes where findable; mark `dataConfidence: "best-effort"` for any facility where a specific permit document wasn't found and the accepted codes are a reasonable inference from the facility's known waste specialty (e.g. a known oily-waste/drilling-waste handler). Cover facilities whose specialty spans all six reference samples' waste types: oily/drilling waste (chapters 01/05/13), used oil (13 02 05*), spent halogenated solvents (07 01 03*), asbestos-containing construction/demolition waste (17 06 05*), and petroleum-contaminated soil (17 05 03*/17 05 04) — ensure at least one facility's permit covers each of these five categories so every reference sample produces at least one match.

```json
[
  {
    "id": "noah-langoya",
    "name": "NOAH Langøya",
    "orgNumber": "947036234",
    "address": "Langøya, 3175 Langesund",
    "municipality": "Holmestrand",
    "acceptedEalCodes": ["05 01 03*", "05 01 06*", "13 05 06*", "13 05 08*"],
    "acceptedEalPrefixes": ["05", "13"],
    "dataConfidence": "best-effort"
  }
]
```

(Full 15-20 entries follow this shape — the implementer should replace this single example with the full researched list before moving on.)

- [ ] **Step 2: Validate JSON syntax and required fields**

```bash
node -e "
const data = JSON.parse(require('fs').readFileSync('lib/data/facilities.json'));
if (!Array.isArray(data) || data.length < 15) throw new Error('expected at least 15 facilities');
for (const f of data) {
  for (const key of ['id','name','orgNumber','address','municipality','acceptedEalCodes','acceptedEalPrefixes','dataConfidence']) {
    if (!(key in f)) throw new Error('missing ' + key + ' on ' + f.id);
  }
}
console.log('valid:', data.length, 'facilities');
"
```

Expected: `valid: <N> facilities` where N >= 15.

- [ ] **Step 3: Commit**

```bash
git add lib/data/facilities.json
git commit -m "data: add curated real Norwegian waste facility dataset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Classification & matching engine (pure functions, unit tested)

**Files:**
- Create: `lib/classification.ts`, `lib/matching.ts`
- Test: `tests/classification.test.ts`, `tests/matching.test.ts`

**Interfaces:**
- Consumes: `ExtractedWasteData`, `ClassificationResult`, `ComplianceFlag`, `Facility`, `FacilityMatch` from `lib/types.ts`; JSON data from Task 2 and Task 3.
- Produces:
  - `classifyWaste(data: ExtractedWasteData): ClassificationResult` — exported from `lib/classification.ts`.
  - `findMatches(classification: ClassificationResult, facilities: Facility[]): FacilityMatch[]` — exported from `lib/matching.ts`.

- [ ] **Step 1: Write failing tests for `classifyWaste`**

`tests/classification.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyWaste } from "../lib/classification";
import type { ExtractedWasteData } from "../lib/types";

const tankBottomSludge: ExtractedWasteData = {
  sampleId: "PH-BR14-TB01",
  matrix: "Tank Bottom Sludge (Solid/Semi-Solid)",
  sourceDescription: "Blackrun Federal 14-2H Pad, Reeves County, TX",
  quantityKg: null,
  physicalCharacteristics: {
    phSU: 6.4,
    flashPointF: 200,
    tphMgKg: 18400,
    ignitable: false,
  },
  tclpMetalsMgL: { arsenic: 0.041, barium: 3.82, lead: 0.612 },
  volatileOrganicsMgKg: { benzene: 3.9, toluene: 22.6, ethylbenzene: 8.1, totalXylenes: 41.3 },
  hazardIndicatorsNoted: [],
};

describe("classifyWaste", () => {
  it("classifies high-TPH tank bottom sludge as oily sludge under EAL 05 01 06*", () => {
    const result = classifyWaste(tankBottomSludge);
    expect(result.ealCode).toBe("05 01 06*");
  });

  it("flags the result as hazardous when the matched EAL code is starred", () => {
    const result = classifyWaste(tankBottomSludge);
    expect(result.complianceFlags.some(f => f.code === "HAZARDOUS")).toBe(true);
  });

  it("does not flag POP when no POP-listed substance is present", () => {
    const result = classifyWaste(tankBottomSludge);
    expect(result.complianceFlags.some(f => f.code === "POP")).toBe(false);
  });

  it("carries through quantity and source description unchanged", () => {
    const withQty = { ...tankBottomSludge, quantityKg: 500 };
    const result = classifyWaste(withQty);
    expect(result.quantityKg).toBe(500);
    expect(result.sourceDescription).toBe("Blackrun Federal 14-2H Pad, Reeves County, TX");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/classification.test.ts
```

Expected: FAIL — `Cannot find module '../lib/classification'`.

- [ ] **Step 3: Implement `lib/classification.ts`**

```typescript
import ealCodes from "./data/eal-codes.json";
import avfallsstoffnummerList from "./data/avfallsstoffnummer.json";
import pops from "./data/pops.json";
import type { ExtractedWasteData, ClassificationResult, ComplianceFlag } from "./types";

const TPH_OILY_THRESHOLD_MG_KG = 1000;

function pickEalCode(data: ExtractedWasteData): { code: string; description: string } {
  const tph = data.physicalCharacteristics.tphMgKg ?? 0;
  const matrix = data.matrix.toLowerCase();
  const hazardNotes = data.hazardIndicatorsNoted.join(" ").toLowerCase();
  const hasSolventAnalyte = Object.keys(data.volatileOrganicsMgKg)
    .some(k => /trichloroethylene|tetrachloroethylene|trichloroethane/i.test(k));

  if (matrix.includes("asbestos") || hazardNotes.includes("asbestos") || matrix.includes("acm")) {
    const match = ealCodes.find(c => c.code === "17 06 05*");
    if (match) return match;
  }
  if (matrix.includes("solvent") || hasSolventAnalyte) {
    const match = ealCodes.find(c => c.code === "07 01 03*");
    if (match) return match;
  }
  if (matrix.includes("soil")) {
    const hazardousSoil = tph > TPH_OILY_THRESHOLD_MG_KG;
    const match = ealCodes.find(c => c.code === (hazardousSoil ? "17 05 03*" : "17 05 04"));
    if (match) return match;
  }
  if (matrix.includes("drilling")) {
    const match = ealCodes.find(c => c.code === "01 05 05*");
    if (match) return match;
  }
  if (matrix.includes("used oil") || (matrix.includes("oil") && matrix.includes("sludge"))) {
    const match = ealCodes.find(c => c.code === "13 02 05*");
    if (match) return match;
  }
  if (tph > TPH_OILY_THRESHOLD_MG_KG && (matrix.includes("sludge") || matrix.includes("tank"))) {
    const match = ealCodes.find(c => c.code === "05 01 06*");
    if (match) return match;
  }
  const fallback = ealCodes.find(c => c.code === "05 01 99");
  if (!fallback) throw new Error("no fallback EAL code configured");
  return fallback;
}

function pickAvfallsstoffnummer(ealCode: string): { number: string; description: string } | null {
  const match = avfallsstoffnummerList.find(a =>
    a.relatedEalPrefixes.some(prefix => ealCode.startsWith(prefix))
  );
  return match ? { number: match.number, description: match.description } : null;
}

function buildComplianceFlags(data: ExtractedWasteData, ealCode: string, hazardous: boolean): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];

  if (hazardous) {
    flags.push({
      code: "HAZARDOUS",
      label: "Hazardous waste (farlig avfall)",
      detail: `EAL code ${ealCode} is classified as hazardous under the European Waste List.`,
    });
  }

  const popMatch = pops.find(p =>
    data.hazardIndicatorsNoted.some(note => note.toLowerCase().includes(p.substance.toLowerCase()))
  );
  if (popMatch) {
    flags.push({
      code: "POP",
      label: "POP-listed substance",
      detail: `Contains ${popMatch.substance}, listed as a Persistent Organic Pollutant.`,
    });
  }

  if (hazardous) {
    flags.push({
      code: "CROSS_BORDER_SHIPMENT",
      label: "Cross-border shipment rules apply",
      detail: "Hazardous waste crossing an EU/EEA border is subject to the EU Waste Shipment Regulation and Basel Convention notification/consent procedures.",
    });
  }

  return flags;
}

export function classifyWaste(data: ExtractedWasteData): ClassificationResult {
  const eal = pickEalCode(data);
  const hazardous = eal.code.endsWith("*");
  const avfallsstoffnummer = pickAvfallsstoffnummer(eal.code);

  return {
    ealCode: eal.code,
    ealDescription: eal.description,
    avfallsstoffnummer: avfallsstoffnummer?.number ?? null,
    avfallsstoffnummerDescription: avfallsstoffnummer?.description ?? null,
    complianceFlags: buildComplianceFlags(data, eal.code, hazardous),
    quantityKg: data.quantityKg,
    sourceDescription: data.sourceDescription,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/classification.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Write failing tests for `findMatches`**

`tests/matching.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findMatches } from "../lib/matching";
import type { ClassificationResult, Facility } from "../lib/types";

const classification: ClassificationResult = {
  ealCode: "05 01 06*",
  ealDescription: "oily sludge from maintenance operations of the plant or equipment",
  avfallsstoffnummer: "7011",
  avfallsstoffnummerDescription: "Oljeholdig avfall",
  complianceFlags: [],
  quantityKg: 500,
  sourceDescription: "test",
};

const facilities: Facility[] = [
  {
    id: "exact-match-facility",
    name: "Exact Match Facility",
    orgNumber: "111",
    address: "Test 1",
    municipality: "Testby",
    acceptedEalCodes: ["05 01 06*"],
    acceptedEalPrefixes: [],
    dataConfidence: "verified-permit",
  },
  {
    id: "prefix-match-facility",
    name: "Prefix Match Facility",
    orgNumber: "222",
    address: "Test 2",
    municipality: "Testby",
    acceptedEalCodes: [],
    acceptedEalPrefixes: ["05"],
    dataConfidence: "best-effort",
  },
  {
    id: "no-match-facility",
    name: "No Match Facility",
    orgNumber: "333",
    address: "Test 3",
    municipality: "Testby",
    acceptedEalCodes: ["20 01 01"],
    acceptedEalPrefixes: ["20"],
    dataConfidence: "verified-permit",
  },
];

describe("findMatches", () => {
  it("ranks exact EAL code matches before prefix matches", () => {
    const results = findMatches(classification, facilities);
    expect(results[0].facility.id).toBe("exact-match-facility");
    expect(results[0].matchType).toBe("exact");
    expect(results[1].facility.id).toBe("prefix-match-facility");
    expect(results[1].matchType).toBe("prefix");
  });

  it("excludes facilities with no matching permit", () => {
    const results = findMatches(classification, facilities);
    expect(results.some(r => r.facility.id === "no-match-facility")).toBe(false);
  });

  it("returns an empty array when nothing matches", () => {
    const noMatchResult = findMatches(
      { ...classification, ealCode: "99 99 99" },
      facilities
    );
    expect(noMatchResult).toEqual([]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run tests/matching.test.ts
```

Expected: FAIL — `Cannot find module '../lib/matching'`.

- [ ] **Step 7: Implement `lib/matching.ts`**

```typescript
import type { ClassificationResult, Facility, FacilityMatch } from "./types";

export function findMatches(classification: ClassificationResult, facilities: Facility[]): FacilityMatch[] {
  const exact: FacilityMatch[] = [];
  const prefix: FacilityMatch[] = [];

  for (const facility of facilities) {
    if (facility.acceptedEalCodes.includes(classification.ealCode)) {
      exact.push({ facility, matchType: "exact", matchedOn: classification.ealCode });
      continue;
    }
    const matchedPrefix = facility.acceptedEalPrefixes.find(p => classification.ealCode.startsWith(p));
    if (matchedPrefix) {
      prefix.push({ facility, matchType: "prefix", matchedOn: matchedPrefix });
    }
  }

  return [...exact, ...prefix];
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/matching.test.ts tests/classification.test.ts
```

Expected: PASS (7 tests total).

- [ ] **Step 9: Commit**

```bash
git add lib/classification.ts lib/matching.ts tests/classification.test.ts tests/matching.test.ts
git commit -m "feat: add classification and matching engine with unit tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: PDF extraction API route

**Files:**
- Create: `lib/extraction.ts`, `app/api/extract/route.ts`

**Interfaces:**
- Consumes: `ExtractedWasteData` type from `lib/types.ts` (Task 1). Requires `ANTHROPIC_API_KEY` env var.
- Produces: `extractWasteData(pdfText: string): Promise<ExtractedWasteData>` from `lib/extraction.ts`; `POST /api/extract` accepting `multipart/form-data` with a `file` field, returning `{ data: ExtractedWasteData }` on success or `{ error: string }` with a non-200 status on failure — consumed by `UploadStep.tsx` in Task 8.

- [ ] **Step 1: Add `.env.local.example` documenting the required key**

Create `.env.local.example`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 2: Implement `lib/extraction.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedWasteData } from "./types";

const EXTRACTION_PROMPT = `You are extracting structured waste characterization data from a lab report.
Read the report text and return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:

{
  "sampleId": string,
  "matrix": string,
  "sourceDescription": string,
  "quantityKg": number | null,
  "physicalCharacteristics": {
    "phSU": number | null,
    "flashPointF": number | null,
    "tphMgKg": number | null,
    "ignitable": boolean | null
  },
  "tclpMetalsMgL": { [analyte: string]: number },
  "volatileOrganicsMgKg": { [analyte: string]: number },
  "hazardIndicatorsNoted": string[]
}

Use camelCase keys for analytes (e.g. "totalXylenes" not "Total Xylenes"). If a value is not present in the report, use null (or omit the analyte from the record objects). Do not invent data not present in the report.

Report text:
`;

export async function extractWasteData(pdfText: string): Promise<ExtractedWasteData> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: EXTRACTION_PROMPT + pdfText }],
  });

  const textBlock = message.content.find(block => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for extraction");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Claude's extraction response was not valid JSON");
  }

  return parsed as ExtractedWasteData;
}
```

- [ ] **Step 3: Implement `app/api/extract/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { extractWasteData } from "@/lib/extraction";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let pdfText: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buffer);
    pdfText = parsed.text;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded PDF" }, { status: 422 });
  }

  if (!pdfText.trim()) {
    return NextResponse.json({ error: "The PDF appears to contain no extractable text" }, { status: 422 });
  }

  try {
    const data = await extractWasteData(pdfText);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Manually verify against all six reference samples**

```bash
npm run dev
```

In a separate terminal, run against each sample in `docs/superpowers/specs/samples/`:

```bash
for f in docs/superpowers/specs/samples/*.pdf; do
  echo "=== $f ==="
  curl -s -X POST http://localhost:3000/api/extract -F "file=@$f" | node -e "
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => console.log(JSON.stringify(JSON.parse(input), null, 2)));
  "
done
```

Expected, per sample:
- `00_TankBottomSludge_MOCKUP.pdf` / `01_Oilfield_TankBottom_WasteCharacterization.pdf`: `data.matrix` mentions tank bottom sludge; `data.tclpMetalsMgL` has `arsenic`, `barium`, `lead`; `data.volatileOrganicsMgKg.benzene` present.
- `02_ConstructionSite_ExcavatedSoil_WasteProfile.pdf`: `data.matrix` mentions soil; `data.physicalCharacteristics.tphMgKg` around 1240 (DRO).
- `03_Demolition_SuspectACM_BulkSampleReport.pdf`: `data.matrix` mentions floor tile/mastic/pipe insulation/asbestos; `data.hazardIndicatorsNoted` mentions asbestos/chrysotile.
- `04_Manufacturing_SpentSolvent_WasteCharacterization.pdf`: `data.matrix` mentions spent/halogenated solvent; volatile organics or hazard notes mention trichloroethylene.
- `05_FleetMaintenanceYard_UsedOilSludge_WasteProfile.pdf`: `data.matrix` mentions used oil sludge.

Requires `ANTHROPIC_API_KEY` set in `.env.local`.

- [ ] **Step 5: Commit**

```bash
git add lib/extraction.ts app/api/extract/route.ts .env.local.example
git commit -m "feat: add PDF extraction API route using Claude

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Classification + matching API route

**Files:**
- Create: `app/api/classify/route.ts`

**Interfaces:**
- Consumes: `classifyWaste` (Task 4), `findMatches` (Task 4), `facilities.json` (Task 3), `ExtractedWasteData` (Task 1).
- Produces: `POST /api/classify` accepting `{ data: ExtractedWasteData }`, returning `{ classification: ClassificationResult, matches: FacilityMatch[] }` — consumed by `ReviewStep.tsx` (Task 9) and `MatchesStep.tsx` (Task 10).

- [ ] **Step 1: Implement the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { classifyWaste } from "@/lib/classification";
import { findMatches } from "@/lib/matching";
import facilities from "@/lib/data/facilities.json";
import type { ExtractedWasteData } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const data = body.data as ExtractedWasteData | undefined;

  if (!data) {
    return NextResponse.json({ error: "Missing extracted waste data" }, { status: 400 });
  }

  const classification = classifyWaste(data);
  const matches = findMatches(classification, facilities as never);

  return NextResponse.json({ classification, matches });
}
```

- [ ] **Step 2: Manually verify with the sample data**

```bash
npm run dev
```

```bash
curl -s -X POST http://localhost:3000/api/classify \
  -H "Content-Type: application/json" \
  -d '{"data":{"sampleId":"PH-BR14-TB01","matrix":"Tank Bottom Sludge (Solid/Semi-Solid)","sourceDescription":"Blackrun Federal 14-2H Pad, Reeves County, TX","quantityKg":500,"physicalCharacteristics":{"phSU":6.4,"flashPointF":200,"tphMgKg":18400,"ignitable":false},"tclpMetalsMgL":{"arsenic":0.041},"volatileOrganicsMgKg":{"benzene":3.9},"hazardIndicatorsNoted":[]}}'
```

Expected: JSON with `classification.ealCode` = `"05 01 06*"` and a non-empty `matches` array (assuming Task 3's facility dataset includes at least one chapter-05 permitted facility).

- [ ] **Step 3: Commit**

```bash
git add app/api/classify/route.ts
git commit -m "feat: add classification+matching API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: PDF report generation

**Files:**
- Create: `lib/report-pdf.tsx`, `app/api/report/route.ts`

**Interfaces:**
- Consumes: `ClassificationResult`, `FacilityMatch[]` from `lib/types.ts`.
- Produces: `POST /api/report` accepting `{ classification: ClassificationResult, matches: FacilityMatch[] }`, returning a `application/pdf` binary response — consumed by `MatchesStep.tsx` (Task 10).

- [ ] **Step 1: Implement `lib/report-pdf.tsx`**

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ClassificationResult, FacilityMatch } from "./types";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 18, marginBottom: 12 },
  section: { marginBottom: 16 },
  heading: { fontSize: 13, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  matchBlock: { marginBottom: 8, paddingBottom: 8, borderBottom: "1 solid #ccc" },
});

function ReportDocument({ classification, matches }: { classification: ClassificationResult; matches: FacilityMatch[] }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Waste Screening & Handler Match Report</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>Classification</Text>
          <View style={styles.row}><Text>EAL Code</Text><Text>{classification.ealCode}</Text></View>
          <Text style={{ marginBottom: 6 }}>{classification.ealDescription}</Text>
          {classification.avfallsstoffnummer && (
            <View style={styles.row}>
              <Text>Avfallsstoffnummer</Text>
              <Text>{classification.avfallsstoffnummer} — {classification.avfallsstoffnummerDescription}</Text>
            </View>
          )}
          <View style={styles.row}><Text>Source</Text><Text>{classification.sourceDescription}</Text></View>
          {classification.quantityKg !== null && (
            <View style={styles.row}><Text>Quantity</Text><Text>{classification.quantityKg} kg</Text></View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Compliance Flags</Text>
          {classification.complianceFlags.length === 0 && <Text>None identified.</Text>}
          {classification.complianceFlags.map(flag => (
            <View key={flag.code} style={{ marginBottom: 6 }}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{flag.label}</Text>
              <Text>{flag.detail}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Matched Facilities ({matches.length})</Text>
          {matches.length === 0 && <Text>No permitted facility found in the current dataset.</Text>}
          {matches.map(match => (
            <View key={match.facility.id} style={styles.matchBlock}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{match.facility.name}</Text>
              <Text>{match.facility.address}, {match.facility.municipality}</Text>
              <Text>Matched on permitted code: {match.matchedOn} ({match.matchType} match)</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(classification: ClassificationResult, matches: FacilityMatch[]): Promise<Buffer> {
  return renderToBuffer(<ReportDocument classification={classification} matches={matches} />);
}
```

- [ ] **Step 2: Implement `app/api/report/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { renderReportPdf } from "@/lib/report-pdf";
import type { ClassificationResult, FacilityMatch } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const classification = body.classification as ClassificationResult | undefined;
  const matches = body.matches as FacilityMatch[] | undefined;

  if (!classification || !matches) {
    return NextResponse.json({ error: "Missing classification or matches" }, { status: 400 });
  }

  try {
    const pdfBuffer = await renderReportPdf(classification, matches);
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waste-report-${classification.ealCode.replace(/\s/g, "")}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF report" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Manually verify PDF generation**

```bash
npm run dev
```

```bash
curl -s -X POST http://localhost:3000/api/report \
  -H "Content-Type: application/json" \
  -d '{"classification":{"ealCode":"05 01 06*","ealDescription":"oily sludge","avfallsstoffnummer":"7011","avfallsstoffnummerDescription":"Oljeholdig avfall","complianceFlags":[{"code":"HAZARDOUS","label":"Hazardous waste","detail":"test"}],"quantityKg":500,"sourceDescription":"test site"},"matches":[]}' \
  -o /tmp/test-report.pdf
file /tmp/test-report.pdf
```

Expected: `file` reports `PDF document, version 1.x`.

- [ ] **Step 4: Commit**

```bash
git add lib/report-pdf.tsx app/api/report/route.ts
git commit -m "feat: add PDF report generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wizard shell + Upload step

**Files:**
- Create: `components/wizard/Wizard.tsx`, `components/wizard/UploadStep.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `POST /api/extract` (Task 5), `POST /api/classify` (Task 6), `ExtractedWasteData` / `ClassificationResult` / `FacilityMatch` types (Task 1).
- Produces: `Wizard` component (default export) rendered from `app/page.tsx`; wizard-level state `{ step, extracted, classification, matches, error }` passed down to `ReviewStep` (Task 9) and `MatchesStep` (Task 10) via props — those tasks must accept exactly:
  - `ReviewStep(props: { classification: ClassificationResult; onConfirm: () => void })`
  - `MatchesStep(props: { classification: ClassificationResult; matches: FacilityMatch[] })`

- [ ] **Step 1: Implement `components/wizard/UploadStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";
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
      <CardBody className="flex flex-col items-center gap-4 py-12">
        <p className="text-lg font-medium">Upload a waste characterization report (PDF)</p>
        <input
          type="file"
          accept="application/pdf"
          disabled={loading}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {fileName && <p className="text-sm text-default-500">{fileName}</p>}
        {loading && <p className="text-sm">Extracting data…</p>}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Implement `components/wizard/Wizard.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Tabs, Tab } from "@heroui/react";
import { UploadStep } from "./UploadStep";
import { ReviewStep } from "./ReviewStep";
import { MatchesStep } from "./MatchesStep";
import type { ExtractedWasteData, ClassificationResult, FacilityMatch } from "@/lib/types";

type Step = "upload" | "review" | "matches";

export function Wizard() {
  const [step, setStep] = useState<Step>("upload");
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

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <Tabs selectedKey={step} aria-label="Wizard steps">
        <Tab key="upload" title="1. Upload report">
          <UploadStep onExtracted={handleExtracted} onError={setError} />
        </Tab>
        <Tab key="review" title="2. Review classification" isDisabled={!classification}>
          {classification && (
            <ReviewStep classification={classification} onConfirm={() => setStep("matches")} />
          )}
        </Tab>
        <Tab key="matches" title="3. Matches" isDisabled={matches.length === 0 && step !== "matches"}>
          {classification && <MatchesStep classification={classification} matches={matches} />}
        </Tab>
      </Tabs>
      {error && <p className="text-danger mt-4">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire up `app/page.tsx`**

```tsx
import { Wizard } from "@/components/wizard/Wizard";

export default function Home() {
  return <Wizard />;
}
```

- [ ] **Step 4: Verify build succeeds (ReviewStep/MatchesStep are stubbed by Tasks 9-10 — create minimal placeholders now so the build passes)**

Create temporary minimal stubs if Tasks 9-10 haven't run yet:

`components/wizard/ReviewStep.tsx`:
```tsx
import type { ClassificationResult } from "@/lib/types";
export function ReviewStep(_props: { classification: ClassificationResult; onConfirm: () => void }) {
  return null;
}
```

`components/wizard/MatchesStep.tsx`:
```tsx
import type { ClassificationResult, FacilityMatch } from "@/lib/types";
export function MatchesStep(_props: { classification: ClassificationResult; matches: FacilityMatch[] }) {
  return null;
}
```

(These get replaced with real implementations in Tasks 9 and 10 — do not commit the stub bodies as final.)

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/wizard/Wizard.tsx components/wizard/UploadStep.tsx components/wizard/ReviewStep.tsx components/wizard/MatchesStep.tsx app/page.tsx
git commit -m "feat: add wizard shell and upload step

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Review classification step

**Files:**
- Modify: `components/wizard/ReviewStep.tsx` (replacing the Task 8 stub)

**Interfaces:**
- Consumes: `ReviewStep(props: { classification: ClassificationResult; onConfirm: () => void })` signature fixed by Task 8.
- Produces: nothing consumed by later tasks beyond the fixed signature.

- [ ] **Step 1: Implement the real component**

```tsx
"use client";
import { Card, CardBody, Chip, Button } from "@heroui/react";
import type { ClassificationResult } from "@/lib/types";

export function ReviewStep({ classification, onConfirm }: {
  classification: ClassificationResult;
  onConfirm: () => void;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4 py-8">
        <div>
          <p className="text-sm text-default-500">EAL Code</p>
          <p className="text-lg font-medium">{classification.ealCode}</p>
          <p className="text-sm">{classification.ealDescription}</p>
        </div>

        {classification.avfallsstoffnummer && (
          <div>
            <p className="text-sm text-default-500">Avfallsstoffnummer</p>
            <p>{classification.avfallsstoffnummer} — {classification.avfallsstoffnummerDescription}</p>
          </div>
        )}

        <div>
          <p className="text-sm text-default-500">Source</p>
          <p>{classification.sourceDescription}</p>
        </div>

        {classification.quantityKg !== null && (
          <div>
            <p className="text-sm text-default-500">Quantity</p>
            <p>{classification.quantityKg} kg</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {classification.complianceFlags.map(flag => (
            <Chip key={flag.code} color="warning" variant="flat" title={flag.detail}>
              {flag.label}
            </Chip>
          ))}
        </div>

        <Button color="primary" onPress={onConfirm} className="self-start">
          Looks right → Find matches
        </Button>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/wizard/ReviewStep.tsx
git commit -m "feat: implement review classification step

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Matches step + PDF download

**Files:**
- Modify: `components/wizard/MatchesStep.tsx` (replacing the Task 8 stub)

**Interfaces:**
- Consumes: `MatchesStep(props: { classification: ClassificationResult; matches: FacilityMatch[] })` signature fixed by Task 8; `POST /api/report` (Task 7).

- [ ] **Step 1: Implement the real component**

```tsx
"use client";
import { useState } from "react";
import { Card, CardBody, Button } from "@heroui/react";
import type { ClassificationResult, FacilityMatch } from "@/lib/types";

export function MatchesStep({ classification, matches }: {
  classification: ClassificationResult;
  matches: FacilityMatch[];
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Could not reach the report service.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {matches.length === 0 && (
        <Card>
          <CardBody>
            <p>No permitted facility found in the current dataset for {classification.ealCode}.</p>
          </CardBody>
        </Card>
      )}

      {matches.map(match => (
        <Card key={match.facility.id}>
          <CardBody>
            <p className="font-medium">{match.facility.name}</p>
            <p className="text-sm text-default-500">{match.facility.address}, {match.facility.municipality}</p>
            <p className="text-sm">
              Matched on permitted code: {match.matchedOn} ({match.matchType} match)
            </p>
          </CardBody>
        </Card>
      ))}

      <Button color="primary" onPress={handleDownload} isLoading={downloading} className="self-start">
        Download PDF report
      </Button>
      {downloadError && <p className="text-danger">{downloadError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Full manual end-to-end verification against all six reference samples**

```bash
npm run dev
```

Open `http://localhost:3000` and, for each PDF in `docs/superpowers/specs/samples/`, confirm:
1. Step 1 shows a loading state then advances automatically.
2. Step 2 shows a plausible EAL code for that waste type (see the mapping in Task 5 Step 4) with correct hazardous/compliance chips and correct source description.
3. Clicking "Looks right → Find matches" advances to step 3 with at least one facility match (Task 3's dataset must cover all five waste categories per its Step 1 requirement).
4. "Download PDF report" downloads a valid PDF for each sample.

Pay particular attention to `00_TankBottomSludge_MOCKUP.pdf` — confirm EAL code `05 01 06*`, hazardous chip, source "Blackrun Federal 14-2H Pad, Reeves County, TX".

- [ ] **Step 4: Commit**

```bash
git add components/wizard/MatchesStep.tsx
git commit -m "feat: implement matches step with PDF report download

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Upload/extract (Task 5, 8) ✓, review/compliance flags (Task 4, 9) ✓, matching (Task 4, 6, 10) ✓, PDF report (Task 7, 10) ✓, static JSON data only / no live scraping (Task 2, 3) ✓, error handling for extraction failure and no-match (Tasks 5, 10) ✓, unit tests for classification/matching (Task 4) ✓, reference sample PDF used in manual verification (Tasks 5, 10) ✓.
- **Placeholder scan:** Task 3's facility list shows one worked example and explicitly instructs the implementer to research and write the full 15-20; this is a data-research step that cannot be pre-filled with fabricated data without violating the spec's "real data" requirement, so it's intentionally left as a guided research task rather than a code placeholder. Task 8's stub components are explicitly temporary and are replaced in Tasks 9-10, not left as-is.
- **Type consistency:** `ReviewStep` and `MatchesStep` prop signatures are fixed once in Task 8 and reused verbatim in Tasks 9 and 10. `ClassificationResult`, `Facility`, `FacilityMatch`, `ExtractedWasteData` are defined once in Task 1 and imported everywhere else without redefinition.
