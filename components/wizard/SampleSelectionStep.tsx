"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";
import { disambiguateSamples, type DetectedSample } from "@/lib/wizard/disambiguate-samples";

export function SampleSelectionStep({ samples, file, onSelected, onError }: {
  samples: DetectedSample[];
  file: File;
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }, sampleIdentifier: string) => void;
  onError: (message: string) => void;
}) {
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const displaySamples = disambiguateSamples(samples);

  async function handlePick(sampleIdentifier: string, index: number) {
    setLoadingIndex(index);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sampleIdentifier", sampleIdentifier);

    try {
      const res = await fetch("/api/extract-sample", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      onSelected(body.data, sampleIdentifier);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoadingIndex(null);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4 py-6">
        <p className="text-sm font-medium text-forest">This document contains multiple samples</p>
        <p className="text-xs text-black/60">Choose which one to classify:</p>
        <div className="flex flex-col gap-2">
          {displaySamples.map((sample, i) => (
            <Button
              key={i}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier, i)}
              isDisabled={loadingIndex !== null}
              className="justify-start"
            >
              {loadingIndex === i ? "Extracting…" : sample.displayLabel}
            </Button>
          ))}
        </div>
        {loadingIndex !== null && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
  );
}
