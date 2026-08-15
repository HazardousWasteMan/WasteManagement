"use client";
import { useState } from "react";
import { Card } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";

interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export function UploadStep({ onExtracted, onSamplesFound, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }, file: File) => void;
  onSamplesFound: (samples: DetectedSample[], file: File) => void;
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
      if (body.samples) {
        onSamplesFound(body.samples, file);
        return;
      }
      onExtracted(body.data, file);
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
        {loading && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
  );
}
