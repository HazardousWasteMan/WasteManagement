# Stage 4 Facility Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the last stage of the original project brief — matching a classified waste against the two real, permitted facilities (Støleheia deponi, Returkraft forbrenningsanlegg) — as a port of already-correct, already-sourced prototype logic (`facility_match.py`) into the TypeScript app, with a narrow real avfallsstoffnummer↔EAL crosswalk and honest gap reporting where real data (eluat/leachate tiers) doesn't exist.

**Architecture:** Two real facility datasets and a narrow crosswalk in `lib/data/`, a pure matching module in `lib/hp-classification/facility-match.ts` (direct port of the Python prototype's logic), a new `POST /api/facility-match` route, and a fourth wizard step.

**Tech Stack:** TypeScript, Next.js API routes, React, Vitest — no new dependencies.

## Global Constraints

- The Støleheia hazardous-path fixed EAL lines (12 01 16*, 13 05 03*, 16 02 12*, 17 06 01*) and generic hazardous bucket (20,000 t/yr, caveated) come verbatim from the real, already-researched permit data in `/Users/evenmyrennybo/Downloads/facility_permits.md` and `/Users/evenmyrennybo/Downloads/waste-classifier/data/facility_stoleheia.json` — no invented tonnage or codes.
- Støleheia's non-hazardous path always reports `"insufficient data"` — this is an honest, permanent gap in this slice (no eluat/leachate capture exists), never a guessed leachate tier.
- The avfallsstoffnummer↔EAL crosswalk contains ONLY the ~4 real, permit-cited pairs already transcribed in `facility_permits.md` (1603, 1604, 1606, 1614) — never expanded with invented pairs; any EAL code without a crosswalk entry reports `"requires crosswalk (not available for this code)"`, never a guess.
- Every crosswalk entry's `isApproximate: true` flag (the source permit's own "~" notation) must be surfaced in the match result, not silently dropped.
- Both facilities are always evaluated together — never short-circuited if one is clearly ineligible.
- No change to `classifySample`, `normalizeSample`, `classifyHazard`, or `assignEalCode` — this slice only consumes their output.

---

### Task 1: Real facility and crosswalk data

**Files:**
- Create: `lib/data/facility-stoleheia.json`
- Create: `lib/data/facility-returkraft.json`
- Create: `lib/data/avfallsstoffnummer-eal-crosswalk.json`
- Test: `tests/hp-classification/facility-match.test.ts` (create — data-shape tests only in this task; matching-logic tests come in Task 2)

**Interfaces:**
- Produces: the three JSON data files, consumed by Task 2's `facility-match.ts`.

- [ ] **Step 1: Create `lib/data/facility-stoleheia.json`**

Direct port of the real prototype data at `/Users/evenmyrennybo/Downloads/waste-classifier/data/facility_stoleheia.json` (already read and verified during brainstorming — this is the exact real content, camelCased to match this repo's JSON field-naming convention used elsewhere, e.g. `lib/data/analyte-reference.json`):

```json
{
  "facilityId": "stoleheia",
  "facilityName": "Støleheia avfallsanlegg (Avfall Sør AS)",
  "facilityType": "deponi",
  "permitNo": "2016/915",
  "permitLastChanged": "2024-11-15",
  "sourceUrl": "https://www.norskeutslipp.no/WebHandlers/PDFDocumentHandler.ashx?documentID=837731&documentType=T&companyID=12913&aar=0&epslanguage=no",
  "fixedHazardousEalLines": [
    { "ealCode": "12 01 16*", "description": "Avfall fra sandblåsing som inneholder farlige stoffer", "annualMaxTonnes": 1000 },
    { "ealCode": "13 05 03*", "description": "Slam fra oljeutskillere", "annualMaxTonnes": 1000 },
    { "ealCode": "16 02 12*", "description": "Kassert utstyr som inneholder fri asbest", "annualMaxTonnes": 100 },
    { "ealCode": "17 06 01*", "description": "Asbestholdig isolasjonsmateriale", "annualMaxTonnes": 10000 }
  ],
  "genericHazardousBucket": {
    "description": "Annet stabilt, ikke-reaktivt farlig avfall (avfallsforskriften vedlegg II pkt 2.3)",
    "annualMaxTonnes": 20000
  },
  "ordinaryContaminatedMassPath": {
    "description": "Forurensede masser (incl. 17 05 03*/04) route here, NOT via the fixed hazardous list. Requires leachate/eluat test against avfallsforskriften vedlegg II tiers (A1/B1/C1) plus basiskarakterisering before acceptance.",
    "annualCap": null,
    "requiresEluatData": true
  },
  "excluded": ["biologisk nedbrytbart avfall", "flytende avfall"]
}
```

- [ ] **Step 2: Create `lib/data/facility-returkraft.json`**

Direct port of `/Users/evenmyrennybo/Downloads/waste-classifier/data/facility_returkraft.json`:

```json
{
  "facilityId": "returkraft",
  "facilityName": "Returkraft AS",
  "facilityType": "forbrenning",
  "permitNo": "2007.0312.T",
  "permitLastChanged": "2020-12-28",
  "sourceUrl": "https://www.statsforvalteren.no/siteassets/fm-agder/dokument-agder/miljo-og-klima/forurensning/tillatelser/2020-returkraft/endret-tillatelse-for-returkraft-as.pdf",
  "annualCapacityTonnes": 160000,
  "brennverdiRangeMjKg": [9, 13],
  "acceptanceCriteria": {
    "maxHalogenatedPctInRestavfall": 1.0,
    "maxHazardousFractionOfFeedPct": 15.0,
    "purePcbFractionsPermitted": false
  },
  "acceptedAvfallsstoffnummer": {
    "1141": "Rent trevirke",
    "1142": "Behandlet trevirke",
    "1603": "Lett forurensede masser",
    "1604": "Forurensede masser",
    "1606": "Forurensede masser fra mudring",
    "1614": "Forurenset betong og tegl",
    "9911": "Blandet husholdningsavfall",
    "9912": "Blandet næringsavfall",
    "9913": "Utsortert brennbart avfall",
    "9914": "Sorteringsrester",
    "9915": "Sikterester",
    "9917": "Shredderavfall",
    "9918": "Ristgods, silgods, sandfang"
  },
  "specialCaps": {
    "slamForurensedeJordmasserTonnesPerYear": 2000
  },
  "mineralMatrixExclusion": ["jord", "betong", "stein", "tegl", "aske asfalt", "asfalt"],
  "note": "Contaminated mineral soil/rock (17 05 03*, high metals) does not fit here on composition grounds — inorganic content doesn't combust. This facility is for the organic/combustible waste stream."
}
```

- [ ] **Step 3: Create `lib/data/avfallsstoffnummer-eal-crosswalk.json`**

The narrow, real, permit-cited crosswalk approved during brainstorming — exactly these 4 entries, no more:

```json
[
  { "avfallsstoffnummer": "1603", "ealCode": "17 05 04", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" },
  { "avfallsstoffnummer": "1604", "ealCode": "17 05 03*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" },
  { "avfallsstoffnummer": "1606", "ealCode": "17 05 05*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~), alternate code 17 05 06 also noted" },
  { "avfallsstoffnummer": "1614", "ealCode": "17 01 06*", "isApproximate": true, "sourceNote": "Returkraft permit, Vedlegg 1 — cross-reference cited as approximate (~) in the source permit itself" }
]
```

- [ ] **Step 4: Write data-shape tests**

Create `tests/hp-classification/facility-match.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import facilityStoleheia from "@/lib/data/facility-stoleheia.json";
import facilityReturkraft from "@/lib/data/facility-returkraft.json";
import crosswalk from "@/lib/data/avfallsstoffnummer-eal-crosswalk.json";

describe("facility data shape", () => {
  it("Støleheia has exactly 4 fixed hazardous EAL lines with real codes", () => {
    expect(facilityStoleheia.fixedHazardousEalLines).toHaveLength(4);
    const codes = facilityStoleheia.fixedHazardousEalLines.map(l => l.ealCode);
    expect(codes).toEqual(["12 01 16*", "13 05 03*", "16 02 12*", "17 06 01*"]);
  });

  it("Returkraft excludes mineral matrices including jord and betong", () => {
    expect(facilityReturkraft.mineralMatrixExclusion).toContain("jord");
    expect(facilityReturkraft.mineralMatrixExclusion).toContain("betong");
  });

  it("the crosswalk has exactly 4 real, permit-cited entries, all marked approximate", () => {
    expect(crosswalk).toHaveLength(4);
    for (const entry of crosswalk) {
      expect(entry.isApproximate).toBe(true);
      expect(entry.sourceNote.length).toBeGreaterThan(0);
    }
  });

  it("the crosswalk includes the 1614 -> 17 01 06* entry needed for the Returkraft positive-match test case", () => {
    const entry = crosswalk.find(e => e.avfallsstoffnummer === "1614");
    expect(entry?.ealCode).toBe("17 01 06*");
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/facility-match.test.ts`
Expected: PASS (4/4)

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — this task only adds new, unreferenced data files and one new test file.

- [ ] **Step 7: Commit**

```bash
git add lib/data/facility-stoleheia.json lib/data/facility-returkraft.json lib/data/avfallsstoffnummer-eal-crosswalk.json tests/hp-classification/facility-match.test.ts
git commit -m "feat: add real Støleheia/Returkraft facility data and narrow avfallsstoffnummer-EAL crosswalk"
```

---

### Task 2: `facility-match.ts` matching logic

**Files:**
- Create: `lib/hp-classification/facility-match.ts`
- Test: `tests/hp-classification/facility-match.test.ts` (extend Task 1's file)

**Interfaces:**
- Consumes: `lib/data/facility-stoleheia.json`, `lib/data/facility-returkraft.json`, `lib/data/avfallsstoffnummer-eal-crosswalk.json` (Task 1).
- Produces: `interface FacilityMatchInput { isHazardous: boolean; ealCode: string; matrixType: string | null }`, `interface FacilityMatchResult { facilityId: "stoleheia" | "returkraft"; eligible: boolean | "likely" | "insufficient data" | "requires crosswalk (not available for this code)"; route: string; detail?: unknown; caveat?: string; reason?: string }`, `matchFacilities(input: FacilityMatchInput): { stoleheia: FacilityMatchResult; returkraft: FacilityMatchResult }` — consumed by Task 3's API route.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/facility-match.test.ts` (append a new `describe` block):

```typescript
import { matchFacilities } from "@/lib/hp-classification/facility-match";

describe("matchFacilities", () => {
  it("Italian sample (hazardous, 17 05 03*, Terra e rocce): Støleheia falls to the generic bucket, Returkraft excluded on mineral matrix", () => {
    const result = matchFacilities({ isHazardous: true, ealCode: "17 05 03*", matrixType: "Terra e rocce" });

    expect(result.stoleheia.eligible).toBe("likely");
    expect(result.stoleheia.route).toBe("generic hazardous bucket (avfallsforskriften vedlegg II pkt 2.3)");
    expect(result.stoleheia.caveat).toBeDefined();

    expect(result.returkraft.eligible).toBe(false);
    expect(result.returkraft.reason).toContain("mineral");
  });

  it("a fixed-hazardous-line EAL code (17 06 01*, asbestos) matches Støleheia's fixed line directly", () => {
    const result = matchFacilities({ isHazardous: true, ealCode: "17 06 01*", matrixType: "Isolasjonsmateriale" });
    expect(result.stoleheia.eligible).toBe(true);
    expect(result.stoleheia.route).toBe("fixed hazardous EAL line");
  });

  it("Eurofins concrete sample (non-hazardous, 17 01 01, Betong): Støleheia reports insufficient data, Returkraft excluded on mineral matrix", () => {
    const result = matchFacilities({ isHazardous: false, ealCode: "17 01 01", matrixType: "Betong" });

    expect(result.stoleheia.eligible).toBe("insufficient data");
    expect(result.stoleheia.reason).toContain("eluat");

    expect(result.returkraft.eligible).toBe(false);
  });

  it("a non-mineral matrix with a crosswalk-covered EAL code (17 01 06*) matches Returkraft via the crosswalk, with the approximate caveat surfaced", () => {
    // Synthetic case (no real fixture uses this exact combination) — proves the positive-match
    // path through the narrow crosswalk works, using the real 1614 -> 17 01 06* entry.
    const result = matchFacilities({ isHazardous: true, ealCode: "17 01 06*", matrixType: "Forurenset betong og tegl (sortert, ikke mineralsk avfallsstrøm)" });
    expect(result.returkraft.eligible).toBe(true);
    expect(result.returkraft.caveat).toContain("approximate");
  });

  it("a non-mineral matrix with an EAL code not in the crosswalk reports the honest gap for Returkraft", () => {
    const result = matchFacilities({ isHazardous: false, ealCode: "20 01 99", matrixType: "Blandet avfall" });
    expect(result.returkraft.eligible).toBe("requires crosswalk (not available for this code)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/facility-match.test.ts`
Expected: FAIL with "Cannot find module '@/lib/hp-classification/facility-match'"

- [ ] **Step 3: Write the implementation**

Create `lib/hp-classification/facility-match.ts`:

```typescript
import facilityStoleheia from "../data/facility-stoleheia.json";
import facilityReturkraft from "../data/facility-returkraft.json";
import crosswalk from "../data/avfallsstoffnummer-eal-crosswalk.json";

export interface FacilityMatchInput {
  isHazardous: boolean;
  ealCode: string;
  matrixType: string | null;
}

export interface FacilityMatchResult {
  facilityId: "stoleheia" | "returkraft";
  eligible: boolean | "likely" | "insufficient data" | "requires crosswalk (not available for this code)";
  route: string;
  detail?: unknown;
  caveat?: string;
  reason?: string;
}

function checkStoleheia(input: FacilityMatchInput): FacilityMatchResult {
  if (input.isHazardous) {
    const fixedMatch = facilityStoleheia.fixedHazardousEalLines.find(line => line.ealCode === input.ealCode);
    if (fixedMatch) {
      return {
        facilityId: "stoleheia",
        eligible: true,
        route: "fixed hazardous EAL line",
        detail: fixedMatch,
      };
    }
    return {
      facilityId: "stoleheia",
      eligible: "likely",
      route: "generic hazardous bucket (avfallsforskriften vedlegg II pkt 2.3)",
      detail: facilityStoleheia.genericHazardousBucket,
      caveat:
        "Eligibility depends on the waste meeting the 'stable, non-reactive' criteria of vedlegg II pkt 2.3 — not verifiable from composition data alone.",
    };
  }

  return {
    facilityId: "stoleheia",
    eligible: "insufficient data",
    route: "ordinary/contaminated mass path (leachate-tier dependent)",
    reason:
      "No leaching/eluat test on this sample — deponi acceptance tier (A1/B1/C1) cannot be determined from composition data alone.",
  };
}

function checkReturkraft(input: FacilityMatchInput): FacilityMatchResult {
  const matrixLower = (input.matrixType ?? "").toLowerCase();
  const isMineral = facilityReturkraft.mineralMatrixExclusion.some(m => matrixLower.includes(m));

  if (isMineral) {
    return {
      facilityId: "returkraft",
      eligible: false,
      route: "composition exclusion",
      reason: `Matrix '${input.matrixType}' is mineral/inorganic — doesn't combust, doesn't fit Returkraft's accepted-fraction profile regardless of hazard status.`,
    };
  }

  const crosswalkMatch = crosswalk.find(entry => entry.ealCode === input.ealCode);
  if (crosswalkMatch) {
    return {
      facilityId: "returkraft",
      eligible: true,
      route: "avfallsstoffnummer crosswalk",
      detail: crosswalkMatch,
      caveat: crosswalkMatch.isApproximate
        ? `This EAL-to-avfallsstoffnummer mapping (${crosswalkMatch.avfallsstoffnummer}) is cited as approximate in the source permit — ${crosswalkMatch.sourceNote}`
        : undefined,
    };
  }

  return {
    facilityId: "returkraft",
    eligible: "requires crosswalk (not available for this code)",
    route: "avfallsstoffnummer crosswalk",
    reason: `No avfallsstoffnummer crosswalk entry found for EAL code '${input.ealCode}' — matching against Returkraft's accepted-fraction list requires this mapping, which is only available for a small set of permit-cited codes.`,
  };
}

export function matchFacilities(input: FacilityMatchInput): {
  stoleheia: FacilityMatchResult;
  returkraft: FacilityMatchResult;
} {
  return {
    stoleheia: checkStoleheia(input),
    returkraft: checkReturkraft(input),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/facility-match.test.ts`
Expected: PASS (9/9 — 4 from Task 1, 5 from this task)

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/facility-match.ts tests/hp-classification/facility-match.test.ts
git commit -m "feat: add matchFacilities() — TypeScript port of the real facility_match.py logic"
```

---

### Task 3: `POST /api/facility-match` route

**Files:**
- Create: `app/api/facility-match/route.ts`

**Interfaces:**
- Consumes: `matchFacilities`, `FacilityMatchInput` (Task 2).
- Produces: `POST /api/facility-match` accepting `{ isHazardous: boolean, ealCode: string, matrixType: string | null }`, returning `{ stoleheia: FacilityMatchResult, returkraft: FacilityMatchResult }` — consumed by Task 4's wizard step.

- [ ] **Step 1: Read `app/api/classify/route.ts` for this repo's existing route conventions**

Read the file in full — this task's new route follows the same structural pattern (JSON body parsing with a try/catch, explicit field validation before calling the pure logic function, a try/catch around the logic call itself returning a 500 on unexpected failure).

- [ ] **Step 2: Create `app/api/facility-match/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { matchFacilities } from "@/lib/hp-classification/facility-match";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { isHazardous, ealCode, matrixType } = body as {
    isHazardous?: boolean;
    ealCode?: string;
    matrixType?: string | null;
  };

  if (typeof isHazardous !== "boolean") {
    return NextResponse.json({ error: "isHazardous must be a boolean" }, { status: 400 });
  }
  if (typeof ealCode !== "string" || ealCode.trim() === "") {
    return NextResponse.json({ error: "ealCode is required" }, { status: 400 });
  }
  if (matrixType !== undefined && matrixType !== null && typeof matrixType !== "string") {
    return NextResponse.json({ error: "matrixType must be a string or null when provided" }, { status: 400 });
  }

  try {
    const result = matchFacilities({ isHazardous, ealCode, matrixType: matrixType ?? null });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Facility matching failed due to an internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — no test file directly tests this route (matching this repo's established no-route-level-tests pattern; the logic it calls is already tested at the `lib/hp-classification/facility-match.ts` level).

- [ ] **Step 4: Manual verification**

With the local dev server running (check `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000`; restart if needed: `cd /Users/evenmyrennybo/WastemanagementPortal && lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`):

```bash
curl -s -X POST http://localhost:3000/api/facility-match \
  -H "Content-Type: application/json" \
  -d '{"isHazardous": true, "ealCode": "17 05 03*", "matrixType": "Terra e rocce"}'
```

Expected: a JSON response with `stoleheia.eligible: "likely"` and `returkraft.eligible: false` — matching the Italian sample's real expected result from Task 2's tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/facility-match/route.ts
git commit -m "feat: add POST /api/facility-match route"
```

---

### Task 4: Wizard UI — Facility match step

**Files:**
- Create: `components/wizard/FacilityMatchStep.tsx`
- Modify: `components/wizard/ClassificationResultsStep.tsx`
- Modify: `components/wizard/Wizard.tsx`

**Interfaces:**
- Consumes: `POST /api/facility-match` (Task 3), `FacilityMatchResult` shape.
- Produces: a working 4-step wizard, manually verified against both real fixtures' scenarios via the live UI.

- [ ] **Step 1: Read the current files**

Read `components/wizard/ClassificationResultsStep.tsx` and `components/wizard/Wizard.tsx` in full (current state, post multi-sample-detection slice) — this task adds a "Continue to facility match" action to the former and a new step to the latter.

- [ ] **Step 2: Add a "Continue" action to `ClassificationResultsStep.tsx`**

Add an `onContinue: () => void` prop and a button. Replace the existing final paragraph (`"Facility matching against permitted handlers is a future stage — not part of this result."`) since that statement is no longer true — this slice is that stage:

```tsx
export function ClassificationResultsStep({ hazard, eal, noDataWarning, onContinue }: {
  hazard: HazardClassification;
  eal: EalAssignment;
  noDataWarning?: boolean;
  onContinue: () => void;
}) {
```

Replace the final `<p className="text-xs text-black/40">...</p>` line with:

```tsx
      <Button variant="primary" onPress={onContinue} className="self-start">
        Continue to facility match
      </Button>
```

Add `Button` to the existing `import { Card, Chip } from "@heroui/react";` line, making it `import { Card, Chip, Button } from "@heroui/react";`.

- [ ] **Step 3: Create `components/wizard/FacilityMatchStep.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card, Chip } from "@heroui/react";

interface FacilityMatchResult {
  facilityId: "stoleheia" | "returkraft";
  eligible: boolean | "likely" | "insufficient data" | "requires crosswalk (not available for this code)";
  route: string;
  detail?: unknown;
  caveat?: string;
  reason?: string;
}

const FACILITY_LABELS: Record<string, string> = {
  stoleheia: "Støleheia avfallsanlegg (deponi)",
  returkraft: "Returkraft AS (forbrenningsanlegg)",
};

function eligibilityChipColor(eligible: FacilityMatchResult["eligible"]): "success" | "warning" | "default" {
  if (eligible === true) return "success";
  if (eligible === "likely") return "warning";
  if (eligible === false) return "default";
  return "warning";
}

function eligibilityLabel(eligible: FacilityMatchResult["eligible"]): string {
  if (eligible === true) return "Eligible";
  if (eligible === false) return "Not eligible";
  return eligible;
}

function FacilityCard({ result }: { result: FacilityMatchResult }) {
  return (
    <Card>
      <Card.Content className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-forest">{FACILITY_LABELS[result.facilityId] ?? result.facilityId}</p>
          <Chip color={eligibilityChipColor(result.eligible)} variant="soft">
            {eligibilityLabel(result.eligible)}
          </Chip>
        </div>
        <p className="text-xs text-black/50">{result.route}</p>
        {result.reason && <p className="text-sm text-black/70">{result.reason}</p>}
        {result.caveat && <p className="text-xs text-amber-700">{result.caveat}</p>}
      </Card.Content>
    </Card>
  );
}

export function FacilityMatchStep({ isHazardous, ealCode, matrixType }: {
  isHazardous: boolean;
  ealCode: string;
  matrixType: string | null;
}) {
  const [result, setResult] = useState<{ stoleheia: FacilityMatchResult; returkraft: FacilityMatchResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/facility-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isHazardous, ealCode, matrixType }),
    })
      .then(res => res.json().then(body => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError(body.error ?? "Facility matching failed");
          return;
        }
        setResult(body);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the facility matching service.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isHazardous, ealCode, matrixType]);

  if (loading) return <p className="text-sm">Checking facility eligibility…</p>;
  if (error) return <p className="text-danger text-sm">{error}</p>;
  if (!result) return null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-black/60">
        Matched against the two currently supported real facility permits. Eligibility states other than a plain
        Eligible/Not eligible reflect genuine gaps in available data — not a system error.
      </p>
      <FacilityCard result={result.stoleheia} />
      <FacilityCard result={result.returkraft} />
    </div>
  );
}
```

- [ ] **Step 4: Update `Wizard.tsx`**

Read the current file (already re-read in Step 1). Add `"facility-match"` to the `Step` union, import `FacilityMatchStep`, add a handler wired to `ClassificationResultsStep`'s new `onContinue` prop, and add the new tab/panel:

```typescript
type Step = "upload" | "select-sample" | "review" | "results" | "facility-match";
```

```typescript
import { FacilityMatchStep } from "./FacilityMatchStep";
```

Add a handler (placed near the other handlers):

```typescript
function handleContinueToFacilityMatch() {
  setStep("facility-match");
}
```

Update `STAGE_NAMES` and `totalStages`:

```typescript
const STAGE_NAMES = ["Submitted", "Reviewed", "Classified", "Facility match"];
```

Update `stageIndex`:

```typescript
const stageIndex = step === "upload" || step === "select-sample" ? 0 : step === "review" ? 1 : step === "results" ? 2 : 3;
```

Update the `Tabs.List`/`totalStages` and add the new tab + panel:

```tsx
<Tabs.List>
  <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
  <Tabs.Tab id="review" isDisabled={!extraction}>2. Review extraction</Tabs.Tab>
  <Tabs.Tab id="results" isDisabled={!classificationResult}>3. Classification</Tabs.Tab>
  <Tabs.Tab id="facility-match" isDisabled={!classificationResult}>4. Facility match</Tabs.Tab>
</Tabs.List>
```

(`totalStages={3}` on `ProgressCard` becomes `totalStages={4}`.)

Update the `"results"` panel to pass `onContinue`, and add the new `"facility-match"` panel:

```tsx
<Tabs.Panel id="results">
  {classificationResult && (
    <ClassificationResultsStep
      hazard={classificationResult.hazard as never}
      eal={classificationResult.eal as never}
      noDataWarning={classificationResult.noDataWarning}
      onContinue={handleContinueToFacilityMatch}
    />
  )}
</Tabs.Panel>
<Tabs.Panel id="facility-match">
  {classificationResult && extraction && (
    <FacilityMatchStep
      isHazardous={(classificationResult.hazard as { isHazardous: boolean }).isHazardous}
      ealCode={(classificationResult.eal as { code: string | null }).code ?? ""}
      matrixType={extraction.metadata.matrixType}
    />
  )}
</Tabs.Panel>
```

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Manual verification**

With the local dev server running, walk through the wizard once with a real sample (upload the Italian sample PDF or the Eurofins concrete PDF, confirm extraction, fill origin process, confirm classification, click "Continue to facility match", and confirm the new step renders both facilities' real results matching what Task 2's tests already proved for that sample's shape — e.g. the Italian sample should show Støleheia "likely" (generic bucket, with caveat) and Returkraft "Not eligible" (mineral matrix reason)).

If live API testing is unavailable (e.g. API key credit issue), verify via curl directly against `/api/facility-match` as done in Task 3 Step 4, and note in your report that the full live UI walkthrough was substituted with the direct API check — consistent with this project's established fallback pattern for when live extraction/classification isn't testable end-to-end.

- [ ] **Step 7: Commit**

```bash
git add components/wizard/FacilityMatchStep.tsx components/wizard/ClassificationResultsStep.tsx components/wizard/Wizard.tsx
git commit -m "feat: add Facility match wizard step (Stage 4 complete)"
```

---

## Self-Review Notes

- **Spec coverage:** real facility data + narrow crosswalk → Task 1. Matching logic (direct port, both honest gaps preserved) → Task 2. API route → Task 3. Wizard UI (4th step) → Task 4.
- **Placeholder scan:** no TBD/TODO. Every code block is complete.
- **Type consistency:** `FacilityMatchInput`/`FacilityMatchResult` (Task 2) are used identically in Task 3's route body/response and Task 4's `FacilityMatchStep` component props/state. `matchFacilities`'s exact function name and signature are used identically across Tasks 2 and 3.
- **Real data traceability:** every number/code in Task 1's three JSON files is either a direct port of the already-verified prototype JSON (Støleheia, Returkraft) or the exact 4 permit-cited crosswalk pairs approved during brainstorming — no new numbers invented in the plan-writing step itself.
