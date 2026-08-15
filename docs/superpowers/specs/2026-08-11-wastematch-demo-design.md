# WasteMatch Demo — Design Spec

Date: 2026-08-11

## Purpose

A pitch demo for a specific customer conversation (the customer described this exact problem to the founder). The customer produces industrial waste (example scenario: an Equinor oil field) and needs to know which licensed waste-handling facility in Norway or the EU is legally permitted to recycle or process it. The demo takes a waste report PDF, extracts its chemical/waste composition, classifies it against real Norwegian and EU waste regulations, and matches it to real facilities whose permits cover that waste. Output is both an in-app result and a downloadable PDF report to leave behind.

This is a pitch demo, not a production system: correctness of the demonstrated flow and credibility of the underlying data matter more than handling every edge case.

## Non-goals

- No user accounts, no persistence between sessions, no multi-tenant concerns.
- No live scraping of Miljødirektoratet at runtime — all code lists and facility data are static, hand-compiled JSON shipped with the app.
- No EU-wide facility coverage — Norwegian facilities only for v1 (see Data section).
- No editing of extracted fields in the UI (v1) — extraction is shown read-only.

## Approach

Single Next.js (App Router) app, HeroUI + Tailwind for all UI, deployed as one deployable unit (e.g. Vercel). No separate backend service — API routes handle PDF extraction, classification/matching, and PDF report generation.

Alternatives considered:
- **Next.js frontend + separate backend service** — rejected for this demo: adds deployment/ops overhead with no benefit unless the matching logic needs to be reused outside this app.
- **Rule-based/regex PDF parsing instead of LLM extraction** — rejected: brittle against real, varied customer PDFs; an LLM-based extraction is far more likely to work on whatever the customer actually hands over.
- **Live registry scraping instead of a static curated dataset** — rejected: the Miljødirektoratet avfallsmottak directory has no export/API and no per-facility permit data in the listing itself; live scraping would be slow, fragile, and still wouldn't surface the permit data we actually need. A hand-curated static dataset, built from real facility names/addresses plus researched real permit data, is more reliable for a live pitch and still fully real.

## Architecture

Three server-side pieces, all within the Next.js app:

1. **Extraction API route** (`/api/extract`)
   - Accepts an uploaded PDF.
   - Extracts raw text from the PDF.
   - Sends the text to Claude (Messages API) with a structured-output prompt to extract: waste description, chemical composition, hazard indicators, quantity, and source/origin.
   - Returns structured JSON. On failure (unreadable PDF, extraction confidence too low), returns an explicit error — no silent fallback to placeholder data.

2. **Classification & matching engine** (pure TypeScript, no LLM)
   - Maps extracted composition/description to:
     - An EAL/EAK code (from the transcribed real EAL code dataset).
     - An avfallsstoffnummer where applicable.
     - Compliance flags: hazardous waste (farlig avfall), POP-listed substance, nuklide-relevant, and (for cross-border matches) EU Waste Shipment Regulation / Basel Convention applicability.
   - Filters the static facility dataset to facilities whose permitted EAL codes include the classified code, and ranks matches (exact permit match first; broader-category permit match second).

3. **PDF report generator**
   - Server-side rendering of the classification + compliance flags + ranked matches into a downloadable PDF, generated on demand from step 3 of the wizard.

No database. Code lists and facility data ship as static JSON files in the repo. Nothing persists between sessions — acceptable for a demo.

## UI Flow

Three-step wizard (HeroUI stepper/tabs), chosen over a single-page live-results view specifically because **data quality and the ability to visibly confirm correctness matter more than speed for this audience** — the customer needs to trust the classification before trusting the match. Simplicity is the explicit design priority throughout: minimal steps, minimal on-screen elements per step, no unnecessary interactivity.

**Step 1 — Upload**
- Drag-and-drop (or file picker) for a PDF waste report.
- Loading state while extraction runs.
- On extraction error: clear message, option to retry or re-upload. No silent failure.

**Step 2 — Review classification**
- Read-only cards showing: EAL code + description, avfallsstoffnummer, quantity, source, and compliance badges (hazardous / POP / nuklide / cross-border-shipment-rules-apply as relevant).
- No inline editing in v1 — if the extraction is wrong, the user re-uploads or the founder narrates the correction verbally during the pitch.
- Single "Looks right → Find matches" button advances to step 3.

**Step 3 — Matches**
- Ranked list of real Norwegian facilities permitted to accept the classified waste code.
- Each match shows: facility name, address, and why it matched (which permitted EAL code overlapped).
- If no facility in the dataset is permitted for the classified code, show the classification result anyway with an explicit "no permitted facility found in current dataset" message — never a false positive.
- "Download PDF report" button generates and downloads the report described above.

## Data

**Regulatory code lists** (static JSON, hand-transcribed from Miljødirektoratet's public pages since there's no export/API):
- EAL/EAK codes (`avfallsdeklarering.miljodirektoratet.no/no/kodeverk/ealkoder`) — the ~20-chapter European Waste List hierarchy.
- Avfallsstoffnummer (`.../kodeverk/avfallsstoffnummer`) — ~60 Norwegian waste material codes.
- POPs code list (`.../kodeverk/pops`).
- Nuklide code list (`.../kodeverk/nuklider`).

**Facility dataset** (static JSON):
- Real facility names, org numbers, and addresses sourced from the avfallsmottak directory (`.../avfallsmottak`).
- For a representative subset of ~15-20 facilities (covering oily/drilling waste, chemical waste, and general hazardous-waste handling — the categories relevant to an oil-field waste stream), real accepted-EAL-code permit data researched and compiled from each facility's public tillatelse (permit) documents where findable.
- Each facility record is tagged with a data-confidence marker (verified-permit vs. best-effort/illustrative) in the source data so it's clear during the pitch which matches are backed by a confirmed real permit versus a reasonable inference — this stays internal/dev-facing, not shown in the UI.

v1 scope is Norwegian facilities only. EU facility matching is a possible future extension, not built now.

## Error Handling

- PDF extraction failure or low-confidence parse → explicit error state in step 1, retry/re-upload option, no fallback to fake data.
- No permitted facility match → honest empty state in step 3, not a false positive.
- PDF report generation failure → error message, no partial/corrupt download.

## Testing

Given this is a demo:
- Manual verification against six sample waste report PDFs (`docs/superpowers/specs/samples/`), all US-format lab reports with no pre-assigned EU/Norwegian code — the right shape of input, since extraction pulls raw composition/characteristic data and the classification engine is responsible for deriving the EAL code and compliance flags from it, not reading one off the page:
  - `00_TankBottomSludge_MOCKUP.pdf` / `01_Oilfield_TankBottom_WasteCharacterization.pdf` — oily tank bottom sludge from an oil well pad (TCLP metals, BTEX, TPH).
  - `02_ConstructionSite_ExcavatedSoil_WasteProfile.pdf` — petroleum-contaminated excavated soil (DRO/GRO, RCRA metals).
  - `03_Demolition_SuspectACM_BulkSampleReport.pdf` — asbestos-containing demolition material (bulk PLM asbestos analysis).
  - `04_Manufacturing_SpentSolvent_WasteCharacterization.pdf` — spent halogenated degreasing solvent (RCRA F001-listed).
  - `05_FleetMaintenanceYard_UsedOilSludge_WasteProfile.pdf` — used oil sludge from a fleet maintenance yard.
  
  This spread exercises five distinct EAL code paths (oily sludge, drilling waste, used oil, spent solvents, asbestos C&D waste, contaminated soil) rather than just one, so both the classification engine and the facility dataset need coverage across all of them, not just the oil-and-gas case.
- Unit tests for the classification/matching engine (pure functions) — this is the part whose correctness most matters for the pitch's credibility, so it gets real test coverage even though the rest of the demo doesn't.
- No end-to-end/browser test suite for v1.
