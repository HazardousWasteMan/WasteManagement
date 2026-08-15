# Case Report Attachment — Design Spec

## Problem

A `Case` (per the just-merged Project/Case/WasteEntry hierarchy) represents one uploaded lab
report document, but nothing about that original document is retained once the wizard finishes —
only the extracted/classified data survives. There's no way to go back and view the actual report
a case's classification was derived from.

## Real gap found during design: the file is already being dropped today

`UploadStep.tsx`'s `onExtracted` callback (used for the more common single-sample document path)
never passes the uploaded `File` object up to `Wizard.tsx` — only `onSamplesFound` (the
multi-sample path) does. This spec's implementation needs to fix that gap as a prerequisite,
since without it there's no file to attach for the majority of real uploads.

## Storage approach

No backend exists (this is frontend-only, localStorage-based, matching the rest of the app).
`localStorage` has a real, low quota (~5-10MB total) and everything under one key (`cases-v1`) is
parsed/stringified on every read/write — storing base64-encoded PDF bytes there would risk hitting
that quota with just a few real reports, and would bloat every case-list read.

Instead: a new module, `lib/wizard/report-storage.ts`, wraps IndexedDB (a much higher, per-origin
quota, purpose-built for blob storage) to store the file's raw bytes, keyed by the case's id —
entirely separate from `cases-v1`. The `Case` record itself only stores the filename
(`reportFileName: string | null`), so the case list/detail pages never need to touch IndexedDB
just to know whether a report is attached.

```ts
export function saveReportFile(caseId: string, file: File): Promise<void>;
export function getReportFile(caseId: string): Promise<File | null>;
```

Mirrors `lib/projects.ts`'s established `hasStorage()`-gated pattern: an in-memory `Map<string,
File>` fallback when `indexedDB` isn't available (SSR, tests), so this stays genuinely unit
testable without a real browser IndexedDB implementation.

## Data model change

`lib/projects.ts`'s `Case` interface gains one field:

```ts
export interface Case {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  reportFileName: string | null;
  wasteEntries: WasteEntry[];
}
```

`createCase`'s input gains `reportFileName: string | null` alongside its existing fields. Seed
cases (`seedCases` in `lib/projects.ts`) get `reportFileName: null` — an honest state, since no
real file backs synthetic demo data (there is nothing to attach for them, and this spec does not
invent placeholder files).

## Wizard wiring

1. `UploadStep.tsx`'s `onExtracted` prop signature gains a second parameter: `(data, file: File)
   => void`. Its `handleFile` function's existing `onExtracted(body.data)` call becomes
   `onExtracted(body.data, file)` — the `File` object is already in scope there, just not
   currently forwarded.
2. `Wizard.tsx`'s `handleExtracted` gains a matching new parameter for this. In its
   "genuinely new document" branch (`shouldStartNewCase(sampleIdentifier)` true), instead of the
   current `setPendingFile(null)`, it sets `setPendingFile(file)` — reusing the existing
   `pendingFile` state (already used by the multi-sample path to hold the current document's
   `File`) rather than introducing a new state variable. This is safe: `pendingFile` being
   truthy for a single-sample document does not change the "Add another sample" button's
   visibility, since that also requires `remainingSamples.length > 0`, which stays `0` when
   `detectedSamples` is `null` (the single-sample case).
3. In `handleAssignProject` — the one place `createCase` is ever called — after a new case is
   successfully created, if `pendingFile` is set, call `saveReportFile(newCase.id, pendingFile)`
   (fire-and-forget from the UI's perspective; a save failure should not block the classification
   flow the user is already mid-way through — log/ignore rather than surface a blocking error,
   consistent with this being a nice-to-have attachment, not the core classification result).
4. `createCase`'s call site passes `reportFileName: pendingFile?.name ?? null`.

## Case detail UI

`app/cases/[id]/page.tsx`: if `caseData.reportFileName` is set, show a small block near the top of
the page (e.g. under the status chip) reading "Original report: `<filename>`" with a "View"
button. On click, the button calls `getReportFile(caseData.id)`; if a file comes back, create an
object URL (`URL.createObjectURL`) and open it in a new tab (`window.open(url, "_blank")`) — native
PDF viewer, no new UI dependency. If no file comes back (e.g. IndexedDB was cleared, or the case
predates this feature despite having a `reportFileName` somehow), show a brief inline "Report file
not available" message rather than a silent failure.

## Non-goals

- No re-upload/replace-report flow — the report is attached once, at case creation.
- No multi-file attachment — one file per case (matches "a Case is one document submission").
- No server-side storage or cross-device sync — this stays local to the browser that created the
  case, same limitation the rest of this app already has.
- No change to seed data narrative beyond adding the new `reportFileName: null` field.

## Testing

- `lib/wizard/report-storage.ts`: unit tests for `saveReportFile`/`getReportFile` using the
  in-memory fallback (save then retrieve returns the same file; retrieving an unknown case id
  returns `null`).
- `lib/projects.ts`: extend existing `createCase` tests to cover the new `reportFileName` field
  round-tripping correctly.
- Existing seed-data tests updated to tolerate/assert the new field (`reportFileName: null` on
  every seed case).
