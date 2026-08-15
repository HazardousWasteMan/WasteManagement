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
