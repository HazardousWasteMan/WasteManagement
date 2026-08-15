"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, Button } from "@heroui/react";
import { addProject, createCase, addWasteEntryToCase, type Case } from "@/lib/projects";
import { saveReportFile } from "@/lib/wizard/report-storage";
import { canCommitEntry, isClassificationTabEnabled, isFacilityMatchTabEnabled, isProjectTabEnabled, isResponseStillCurrent, isReviewTabEnabled, shouldStartNewCase } from "@/lib/wizard/case-flow";
import { UploadStep } from "./UploadStep";
import { SampleSelectionStep } from "./SampleSelectionStep";
import { ExtractionReviewStep } from "./ExtractionReviewStep";
import { ClassificationResultsStep } from "./ClassificationResultsStep";
import { ProjectAssignmentStep } from "./ProjectAssignmentStep";
import { FacilityMatchStep } from "./FacilityMatchStep";
import { ProgressCard } from "@/components/dashboard/DashboardCards";

type Step = "upload" | "select-sample" | "review" | "results" | "assign-project" | "facility-match";

const STAGE_NAMES = ["Submitted", "Reviewed", "Classified", "Project", "Facility match"];

interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
  location: string | null;
  physicalState: "solid" | "liquid" | "powder" | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}

interface ExtractedResultRow {
  rawAnalyteName: string;
  analyteId: string | null;
  resultValue: number | null;
  unitRaw: string;
}

interface ExtractionData {
  metadata: ExtractedMetadata;
  results: ExtractedResultRow[];
  testResults: Record<string, unknown>[];
  unmatchedAnalytes: string[];
  suggestedOriginProcess: string | null;
  sourceType: "text" | "document";
}

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [extraction, setExtraction] = useState<ExtractionData | null>(null);
  const [classificationResult, setClassificationResult] = useState<{ hazard: unknown; eal: unknown; noDataWarning: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [detectedSamples, setDetectedSamples] = useState<{ sampleIdentifier: string; matrixType: string | null }[] | null>(null);
  const [consumedSampleIdentifiers, setConsumedSampleIdentifiers] = useState<Set<string>>(new Set());
  const [activeCase, setActiveCase] = useState<Case | null>(null);
  const [entryCommitted, setEntryCommitted] = useState(false);
  const [currentSampleIdentifier, setCurrentSampleIdentifier] = useState<string | null>(null);
  // Bumped every time a genuinely new document enters the wizard (resetForNewDocument) and at
  // the start of every classify request. Lets an in-flight classify response detect that a
  // newer document has since taken over, so it can discard itself instead of overwriting state
  // with a mismatched extraction/classification pairing (see handleConfirmOrigin).
  const requestGenerationRef = useRef(0);

  const remainingSamples = (detectedSamples ?? []).filter(s => !consumedSampleIdentifiers.has(s.sampleIdentifier));

  // Single source of truth for "extraction/classification is about to be replaced or cleared
  // for a reason OTHER than a still-current in-flight request's own response arriving". Bumps
  // the generation and clears the entry-scoped fields. Used both when a genuinely new document
  // enters the wizard AND when the user moves on to another sample within the SAME in-progress
  // document — both paths invalidate any in-flight classify response for the previous entry.
  function resetForNewEntry() {
    requestGenerationRef.current += 1;
    setExtraction(null);
    setClassificationResult(null);
    setEntryCommitted(false);
    setCurrentSampleIdentifier(null);
    // Any classify request tied to the OLD generation is now moot — this is the exact point
    // the entry it belonged to gets invalidated, so clear the in-flight indicator here rather
    // than waiting on that request's own (now-guarded, and possibly never-firing-for-this-entry)
    // finally block. This does not race with a still-valid in-flight request: resetForNewEntry
    // is only ever called when the entry is genuinely changing.
    setClassifying(false);
  }

  // Single source of truth for "a genuinely new document just entered the wizard" — clears
  // every piece of state tied to whatever document/case was previously in progress, so a new
  // document can never inherit stale extraction, classification, or case data. Does NOT touch
  // detectedSamples/pendingFile: those have different reset semantics at each call site (see
  // callers below), so they stay outside this shared function. activeCase/consumedSampleIdentifiers
  // are document-scoped (not entry-scoped), so they're reset here rather than in resetForNewEntry.
  function resetForNewDocument() {
    resetForNewEntry();
    setActiveCase(null);
    setConsumedSampleIdentifiers(new Set());
  }

  function handleSamplesFound(samples: { sampleIdentifier: string; matrixType: string | null }[], file: File) {
    setError(null);
    // A multi-sample document was just detected — this is always a genuinely new document,
    // so start completely fresh: any previous document's case/classification/extraction must
    // not bleed into this one.
    resetForNewDocument();
    setDetectedSamples(samples);
    setPendingFile(file);
    setStep("select-sample");
  }

  function handleExtracted(
    data: {
      metadata: Record<string, unknown>;
      results: Record<string, unknown>[];
      testResults: Record<string, unknown>[];
      unmatchedAnalytes: string[];
      suggestedOriginProcess: string | null;
      sourceType: "text" | "document";
    },
    sampleIdentifier: string | null = null,
    file: File | null = null
  ) {
    setError(null);
    if (shouldStartNewCase(sampleIdentifier)) {
      // A genuinely fresh single-sample upload — reset everything tied to a previous
      // document/case so it cannot contaminate this new one. A direct single-document
      // upload has no multi-sample list, so detectedSamples is cleared here (unlike
      // handleSamplesFound, which sets it to the new document's real values) — but
      // pendingFile is now set to the uploaded file itself (not cleared), so it's
      // available later if this extraction becomes a case (see handleAssignProject),
      // the same way the multi-sample path already retains its file.
      resetForNewDocument();
      setDetectedSamples(null);
      setPendingFile(file);
    } else {
      // Continuing the "add another sample" loop on the SAME already-in-progress document —
      // keep activeCase/consumedSampleIdentifiers/detectedSamples/pendingFile intact; only
      // reset the entry-specific state (routed through resetForNewEntry so this also bumps the
      // generation, invalidating any in-flight classify response for the previous sample).
      resetForNewEntry();
      setConsumedSampleIdentifiers(prev => new Set(prev).add(sampleIdentifier));
    }
    setExtraction(data as unknown as ExtractionData);
    setCurrentSampleIdentifier(sampleIdentifier);
    setStep("review");
  }

  async function handleConfirmOrigin(originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) {
    if (!extraction) return;
    setError(null);
    setClassifying(true);
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...extraction.metadata, ...editedMetadata, originProcess },
          results: extraction.results,
          testResults: extraction.testResults,
          customChapter,
        }),
      });
      const body = await res.json();
      if (!isResponseStillCurrent(requestGeneration, requestGenerationRef.current)) {
        // A newer document/entry has since taken over the wizard — silently discard this stale
        // response (success or error) rather than overwrite state with a mismatched pairing.
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Classification failed");
        return;
      }
      setClassificationResult({ hazard: body.hazard, eal: body.eal, noDataWarning: Boolean(body.noDataWarning) });
      setStep("results");
    } catch {
      if (!isResponseStillCurrent(requestGeneration, requestGenerationRef.current)) return;
      setError("Could not reach the classification service.");
    } finally {
      if (isResponseStillCurrent(requestGeneration, requestGenerationRef.current)) {
        setClassifying(false);
      }
    }
  }

  function buildWasteEntry() {
    if (!extraction || !classificationResult) return null;
    const hazard = classificationResult.hazard as { isHazardous: boolean };
    const eal = classificationResult.eal as { code: string | null };
    return {
      sampleLabel: extraction.metadata.sampleMarking ?? currentSampleIdentifier ?? extraction.metadata.customerName ?? "Waste sample",
      isHazardous: hazard.isHazardous,
      ealCode: eal.code,
      // ponytail: classification outputs EAL only; map EAL -> avfallsstoffnr when that table exists
      avfallsstoffnr: null,
      summary: hazard.isHazardous
        ? "Classified as hazardous waste. See facility match for eligible treatment partners."
        : "Classified as non-hazardous waste. See facility match for eligible facilities.",
    };
  }

  function handleContinueFromResults() {
    if (!canCommitEntry(entryCommitted)) return;
    if (activeCase) {
      // Already have an in-progress case for this document — append this entry directly, no
      // need to re-ask which project it belongs to.
      const entry = buildWasteEntry();
      if (!entry) return;
      const updated = addWasteEntryToCase(activeCase.id, entry);
      setActiveCase(updated);
      setEntryCommitted(true);
      setStep("facility-match");
    } else {
      setStep("assign-project");
    }
  }

  function handleAssignProject(choice: { projectId: string } | { newProject: { name: string; location: string } }) {
    if (!extraction) return;
    if (!canCommitEntry(entryCommitted)) return;
    const entry = buildWasteEntry();
    if (!entry) return;
    const projectId = "projectId" in choice ? choice.projectId : addProject(choice.newProject).id;
    const caseName = extraction.metadata.customerName ?? extraction.metadata.externalReportNo ?? "New case";
    const newCase = createCase({ projectId, name: caseName, wasteEntry: entry, reportFileName: pendingFile?.name ?? null });
    if (pendingFile) {
      // Fire-and-forget: this is a nice-to-have attachment, not the core classification
      // result the user is mid-way through — a save failure here should never block or
      // error out the flow. Log for diagnostics only.
      saveReportFile(newCase.id, pendingFile).catch(err => {
        console.error("Failed to save report file for case", newCase.id, err);
      });
    }
    setActiveCase(newCase);
    setEntryCommitted(true);
    setStep("facility-match");
  }

  function handleAddAnotherSample() {
    setError(null);
    resetForNewEntry();
    setStep("select-sample");
  }

  function handleFinishCase() {
    if (!activeCase) return;
    router.push(`/cases/${activeCase.id}`);
  }

  const stageIndex = step === "upload" || step === "select-sample" ? 0 : step === "review" ? 1 : step === "results" ? 2 : step === "assign-project" ? 3 : 4;

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 flex flex-col gap-6">
      <ProgressCard
        stageLabel={STAGE_NAMES[stageIndex]}
        stageIndex={stageIndex}
        totalStages={5}
        stageNames={STAGE_NAMES}
      />
      <Tabs selectedKey={step} onSelectionChange={key => setStep(key as Step)} aria-label="Wizard steps">
        <Tabs.List>
          <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
          <Tabs.Tab id="review" isDisabled={!isReviewTabEnabled(Boolean(extraction), entryCommitted)}>2. Review extraction</Tabs.Tab>
          <Tabs.Tab id="results" isDisabled={!isClassificationTabEnabled(Boolean(classificationResult), entryCommitted)}>3. Classification</Tabs.Tab>
          <Tabs.Tab id="assign-project" isDisabled={!isProjectTabEnabled(Boolean(classificationResult), Boolean(activeCase))}>4. Project</Tabs.Tab>
          <Tabs.Tab id="facility-match" isDisabled={!isFacilityMatchTabEnabled(Boolean(activeCase), Boolean(classificationResult))}>5. Facility match</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="upload">
          <UploadStep
            onExtracted={(data, file) => handleExtracted(data, null, file)}
            onSamplesFound={handleSamplesFound}
            onError={setError}
          />
        </Tabs.Panel>
        <Tabs.Panel id="select-sample">
          {detectedSamples && pendingFile && (
            <SampleSelectionStep samples={remainingSamples} file={pendingFile} onSelected={handleExtracted} onError={setError} />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="review">
          {extraction && (
            <>
              <ExtractionReviewStep extraction={extraction} onConfirm={handleConfirmOrigin} isClassifying={classifying} />
              {classifying && <p className="text-sm mt-2">Classifying…</p>}
            </>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="results">
          {classificationResult && (
            <ClassificationResultsStep
              hazard={classificationResult.hazard as never}
              eal={classificationResult.eal as never}
              noDataWarning={classificationResult.noDataWarning}
              onContinue={handleContinueFromResults}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="assign-project">
          {extraction && !activeCase && (
            <ProjectAssignmentStep
              suggestedName={extraction.metadata.customerName ?? "New project"}
              suggestedLocation={extraction.metadata.location}
              onConfirm={handleAssignProject}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="facility-match">
          {classificationResult && extraction && activeCase && (
            <>
              <FacilityMatchStep
                isHazardous={(classificationResult.hazard as { isHazardous: boolean }).isHazardous}
                ealCode={(classificationResult.eal as { code: string | null }).code}
                matrixType={extraction.metadata.matrixType}
              />
              <div className="mt-6 flex justify-end gap-2">
                {remainingSamples.length > 0 && pendingFile && (
                  <Button variant="secondary" onPress={handleAddAnotherSample}>
                    Add another sample from this document
                  </Button>
                )}
                <Button variant="primary" onPress={handleFinishCase}>
                  Finish case
                </Button>
              </div>
            </>
          )}
        </Tabs.Panel>
      </Tabs>
      {error && <p className="text-danger mt-4">{error}</p>}
    </div>
  );
}
