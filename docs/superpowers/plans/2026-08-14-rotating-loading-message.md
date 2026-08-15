# Rotating Loading Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "Extracting data…"/"Extracting…" loading text in the wizard's upload and sample-selection steps with a component that cycles through honest, real-pipeline-stage messages every ~2.5s, so a multi-minute extraction wait doesn't read as a frozen app.

**Architecture:** One new component, `RotatingLoadingMessage`, exports its fixed message list as a named constant (independently testable without any DOM/rendering infrastructure) and internally cycles through it via `useState` + `useEffect` + `setInterval`. Wired into the two existing loading states in `UploadStep.tsx` and `SampleSelectionStep.tsx` as a drop-in replacement for their current static text.

**Tech Stack:** TypeScript, React, Vitest.

## Global Constraints

- The message list is exactly the 6 messages from the spec, in this exact order — they describe real steps the Stage B extraction call performs (per `lib/hp-classification/extract.ts`'s `buildSchemaInstructions`), not fabricated flavor text: `"Reading the document…"`, `"Extracting analyte results…"`, `"Matching known substances…"`, `"Checking for hazard-relevant data…"`, `"Finalizing extracted data…"`, `"Large reports can take a few minutes…"`.
- This is not a real, server-synced progress indicator — no backend changes, no new API fields, no streaming instrumentation. Purely a client-side "the app hasn't frozen" signal.
- No change to the extraction pipeline itself (`extractSampleData`, either API route) — this plan only touches loading-state UI in two wizard components.
- This codebase has no existing React component-render tests and no DOM test environment configured (`vitest.config.ts` uses `environment: "node"`, no `@testing-library/react` installed). Do not add either — test the message list as a plain exported constant instead, matching this project's established pattern of testing pure logic/data thoroughly rather than component rendering (no route handlers, no other components are unit-tested in this codebase either).

---

### Task 1: `RotatingLoadingMessage` component + wiring into both loading states

**Files:**
- Create: `components/wizard/RotatingLoadingMessage.tsx`
- Modify: `components/wizard/UploadStep.tsx`
- Modify: `components/wizard/SampleSelectionStep.tsx`
- Test: `tests/wizard/rotating-loading-message.test.ts` (new directory, mirrors the existing `tests/hp-classification/` convention for `lib/hp-classification/`)

**Interfaces:**
- Produces: `export const LOADING_MESSAGES: readonly string[]` and `export function RotatingLoadingMessage(): JSX.Element` — consumed by `UploadStep.tsx` and `SampleSelectionStep.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/wizard/rotating-loading-message.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { LOADING_MESSAGES } from "@/components/wizard/RotatingLoadingMessage";

describe("LOADING_MESSAGES", () => {
  it("has exactly the 6 real, honest pipeline-stage messages in order", () => {
    expect(LOADING_MESSAGES).toEqual([
      "Reading the document…",
      "Extracting analyte results…",
      "Matching known substances…",
      "Checking for hazard-relevant data…",
      "Finalizing extracted data…",
      "Large reports can take a few minutes…",
    ]);
  });

  it("has no empty or duplicate messages", () => {
    for (const msg of LOADING_MESSAGES) {
      expect(msg.length).toBeGreaterThan(0);
    }
    expect(new Set(LOADING_MESSAGES).size).toBe(LOADING_MESSAGES.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wizard/rotating-loading-message.test.ts`
Expected: FAIL with "Cannot find module '@/components/wizard/RotatingLoadingMessage'".

- [ ] **Step 3: Write the component**

Create `components/wizard/RotatingLoadingMessage.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

// Real steps the Stage B extraction call performs (see lib/hp-classification/extract.ts's
// buildSchemaInstructions) — not fabricated flavor text. This is not a real, server-synced
// progress indicator: Stage B is one opaque streaming call from the client's point of view, so
// there's no real per-step signal to sync to. Cycling through these honest descriptions is
// purely a "the app hasn't frozen" reassurance during what can now be a multi-minute wait.
export const LOADING_MESSAGES: readonly string[] = [
  "Reading the document…",
  "Extracting analyte results…",
  "Matching known substances…",
  "Checking for hazard-relevant data…",
  "Finalizing extracted data…",
  "Large reports can take a few minutes…",
];

const ROTATION_INTERVAL_MS = 2500;

export function RotatingLoadingMessage() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  return <p className="text-sm">{LOADING_MESSAGES[index]}</p>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wizard/rotating-loading-message.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Wire into `UploadStep.tsx`**

Add the import, alongside the existing `Card` import:

```typescript
import { Card } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";
```

Replace the existing loading line:

```tsx
        {loading && <p className="text-sm">Extracting data…</p>}
```

with:

```tsx
        {loading && <RotatingLoadingMessage />}
```

- [ ] **Step 6: Wire into `SampleSelectionStep.tsx`**

Add the import, alongside the existing `Card, Button` import:

```typescript
import { Card, Button } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";
```

Add a rotating message below the button list — change:

```tsx
        <div className="flex flex-col gap-2">
          {samples.map(sample => (
            <Button
              key={sample.sampleIdentifier}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier)}
              isDisabled={loadingId !== null}
              className="justify-start"
            >
              {loadingId === sample.sampleIdentifier
                ? "Extracting…"
                : `${sample.sampleIdentifier}${sample.matrixType ? ` — ${sample.matrixType}` : ""}`}
            </Button>
          ))}
        </div>
      </Card.Content>
    </Card>
```

to:

```tsx
        <div className="flex flex-col gap-2">
          {samples.map(sample => (
            <Button
              key={sample.sampleIdentifier}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier)}
              isDisabled={loadingId !== null}
              className="justify-start"
            >
              {loadingId === sample.sampleIdentifier
                ? "Extracting…"
                : `${sample.sampleIdentifier}${sample.matrixType ? ` — ${sample.matrixType}` : ""}`}
            </Button>
          ))}
        </div>
        {loadingId !== null && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
```

(The button's own label stays the static "Extracting…" — no room to rotate text inside a button — the rotating message appears as a separate line below the button list instead.)

- [ ] **Step 7: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 8: Manual verification**

With the local dev server running (`lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`), open the wizard in the browser pane, upload a real PDF (e.g. the Italian sample or Eurofins concrete report already used as this project's working test fixtures), and confirm the loading text under the upload box changes every ~2.5 seconds through the 6 messages in order, rather than staying static. If the upload finishes quickly (small/simple reports can complete in seconds), it's fine to only observe 1-2 message changes before the wizard advances to the review step — the goal is confirming the rotation mechanism works, not watching the full multi-minute cycle.

- [ ] **Step 9: Commit**

```bash
git add components/wizard/RotatingLoadingMessage.tsx components/wizard/UploadStep.tsx components/wizard/SampleSelectionStep.tsx tests/wizard/rotating-loading-message.test.ts
git commit -m "feat: rotating loading messages during extraction, replacing static 'Extracting…' text"
```

---

## Self-Review Notes

- **Spec coverage:** the component + exact message list + both wiring sites (`UploadStep.tsx`, `SampleSelectionStep.tsx`) are all covered in this single task, matching the spec's "In scope" section exactly. The spec's "Explicitly out of scope" items (real progress indication, extraction pipeline changes, `ExtractionReviewStep.tsx`/`FacilityMatchStep.tsx` loading states) are untouched.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command with expected output.
- **Type consistency:** `LOADING_MESSAGES`/`RotatingLoadingMessage` are defined once and imported with the exact same names into both consuming files — no signature drift.
- **Testing scope note:** per the plan's Global Constraints, this deliberately does not add a DOM-rendering test or a fake-timers test for the `setInterval` cycling mechanism itself — doing so would require introducing this codebase's first-ever component test infrastructure (`@testing-library/react`, a jsdom/happy-dom environment change in `vitest.config.ts`), which is disproportionate to a small loading-text fix and inconsistent with this project's existing testing conventions (no other component or route handler is unit-tested). The message list itself — the part the spec actually mandates exact content for — is fully tested as a plain data constant instead.
