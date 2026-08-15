"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { ORIGIN_OPTIONS, suggestOriginProcess, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
import { groupAnalyteResults } from "@/lib/wizard/group-analyte-results";

interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
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

export function ExtractionReviewStep({ extraction, onConfirm, isClassifying = false }: {
  extraction: {
    metadata: ExtractedMetadata;
    results: ExtractedResultRow[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  };
  onConfirm: (originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) => void;
  isClassifying?: boolean;
}) {
  const [originProcess, setOriginProcess] = useState(
    () => suggestOriginProcess(extraction.metadata.labStatedEalCode, extraction.suggestedOriginProcess) ?? ""
  );
  const [isCustomOrigin, setIsCustomOrigin] = useState(false);
  const [customChapter, setCustomChapter] = useState("");
  const [editedMetadata, setEditedMetadata] = useState<Partial<ExtractedMetadata>>({
    externalReportNo: extraction.metadata.externalReportNo,
    labName: extraction.metadata.labName,
    customerName: extraction.metadata.customerName,
    matrixType: extraction.metadata.matrixType,
    physicalState: extraction.metadata.physicalState,
  });

  function updateField<K extends keyof ExtractedMetadata>(key: K, value: ExtractedMetadata[K]) {
    setEditedMetadata(prev => ({ ...prev, [key]: value }));
  }

  const matchedCount = extraction.results.filter(r => r.analyteId !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Card.Content className="flex flex-col gap-3 py-6">
          <p className="text-sm font-medium text-forest">Extracted sample details</p>
          <p className="text-xs text-black/60">
            OCR/LLM extraction can misread a field — review and correct these before classifying.
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm items-center">
            <label htmlFor="field-report-no" className="text-black/50">Report No.</label>
            <input
              id="field-report-no"
              type="text"
              value={editedMetadata.externalReportNo ?? ""}
              onChange={e => updateField("externalReportNo", e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="field-lab" className="text-black/50">Lab</label>
            <input
              id="field-lab"
              type="text"
              value={editedMetadata.labName ?? ""}
              onChange={e => updateField("labName", e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="field-customer" className="text-black/50">Customer</label>
            <input
              id="field-customer"
              type="text"
              value={editedMetadata.customerName ?? ""}
              onChange={e => updateField("customerName", e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="field-matrix" className="text-black/50">Matrix</label>
            <input
              id="field-matrix"
              type="text"
              value={editedMetadata.matrixType ?? ""}
              onChange={e => updateField("matrixType", e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="field-physical-state" className="text-black/50">Physical state</label>
            <select
              id="field-physical-state"
              value={editedMetadata.physicalState ?? ""}
              onChange={e => updateField("physicalState", (e.target.value || null) as "solid" | "liquid" | "powder" | null)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            >
              <option value="">—</option>
              <option value="solid">solid</option>
              <option value="liquid">liquid</option>
              <option value="powder">powder</option>
            </select>
          </div>
          <p className="text-sm text-black/60">{matchedCount} analyte result(s) matched.</p>
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="py-4">
          <p className="text-sm font-medium text-forest">Analyte results</p>
          <div className="flex flex-col gap-3 mt-2">
            {groupAnalyteResults(extraction.results).map(group => (
              <details key={group.groupName} open className="group">
                <summary className="text-xs font-medium text-forest/70 cursor-pointer select-none">
                  {group.groupName} ({group.rows.length})
                </summary>
                <div className="flex flex-col gap-1 mt-1 pl-2">
                  {group.rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm border-b border-black/5 py-1 last:border-0">
                      <span className="flex-1">{r.rawAnalyteName}</span>
                      <span className="flex items-center gap-1">
                        {r.analyteId === null && (
                          <span
                            className="text-amber-600 text-xs cursor-help"
                            title="Excluded from hazard classification rather than guessed — this substance isn't in the current reference table."
                          >
                            &#9888;
                          </span>
                        )}
                        <span className={r.analyteId === null ? "text-amber-700 text-xs" : "text-black/70 text-xs"}>
                          {r.analyteId ?? "— unmatched —"}
                        </span>
                      </span>
                      <span className="text-black/50 text-xs w-24 text-right">
                        {r.resultValue ?? "—"} {r.unitRaw}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="py-6 flex flex-col gap-2">
          <label htmlFor="origin-process" className="text-sm font-medium text-forest">
            Origin / process <span className="text-danger">*</span>
          </label>
          <p className="text-xs text-black/60">
            Never present in a lab report — a suggestion may be pre-filled based on the extracted data, but always
            confirm it's correct before classifying.
          </p>
          <input
            id="origin-process"
            list="origin-process-options"
            type="text"
            value={originProcess}
            onChange={e => {
              const value = e.target.value;
              setOriginProcess(value);
              const matched = ORIGIN_OPTIONS.find(o => o.value === value || o.label === value);
              if (matched) {
                setOriginProcess(matched.value);
                setIsCustomOrigin(false);
                setCustomChapter("");
              } else if (value.trim() !== "" && !ORIGIN_OPTIONS.some(o => o.label === value)) {
                setIsCustomOrigin(true);
                setCustomChapter("");
              } else {
                setIsCustomOrigin(false);
                setCustomChapter("");
              }
            }}
            placeholder="Type to search, or enter your own…"
            className="border border-black/10 rounded-lg px-3 py-2 text-sm"
          />
          <datalist id="origin-process-options">
            {ORIGIN_OPTIONS.map(option => (
              <option key={option.value} value={option.label}>
                {option.label} — {option.chapter.slice(0, 2)} {option.chapter.slice(2)}
              </option>
            ))}
          </datalist>

          {isCustomOrigin && (
            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-black/10">
              <label htmlFor="custom-chapter" className="text-xs font-medium text-forest">
                Which EAL chapter does this belong to? <span className="text-danger">*</span>
              </label>
              <p className="text-xs text-black/60">
                A custom description needs an explicit chapter — this is never guessed either.
              </p>
              <select
                id="custom-chapter"
                value={customChapter}
                onChange={e => setCustomChapter(e.target.value)}
                className="border border-black/10 rounded-lg px-2 py-1 text-sm"
              >
                <option value="">— select a chapter —</option>
                {EAL_CHAPTERS.map(chapter => (
                  <option key={chapter.chapter} value={chapter.chapter}>
                    {chapter.chapter} — {chapter.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card.Content>
      </Card>

      <Button
        variant="primary"
        onPress={() => onConfirm(originProcess.trim(), editedMetadata, isCustomOrigin ? customChapter : null)}
        isDisabled={originProcess.trim() === "" || (isCustomOrigin && customChapter === "") || isClassifying}
        className="self-start"
      >
        Classify
      </Button>
    </div>
  );
}
