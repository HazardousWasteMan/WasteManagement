export interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export interface DisambiguatedSample extends DetectedSample {
  displayLabel: string;
}

// Real documents occasionally produce two detected samples sharing one sampleIdentifier —
// extraction's multi-sample detection prompt asks the LLM for a unique identifier per sample,
// but cannot guarantee it against a messy or ambiguous real source document. Appends a "(N)"
// suffix to the DISPLAYED label only when an identifier repeats; sampleIdentifier itself is
// never touched, since /api/extract-sample still needs the real, unmodified value.
export function disambiguateSamples(samples: DetectedSample[]): DisambiguatedSample[] {
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.sampleIdentifier, (counts.get(s.sampleIdentifier) ?? 0) + 1);

  const seen = new Map<string, number>();
  return samples.map(s => {
    const total = counts.get(s.sampleIdentifier)!;
    if (total <= 1) {
      return { ...s, displayLabel: s.matrixType ? `${s.sampleIdentifier} — ${s.matrixType}` : s.sampleIdentifier };
    }
    const occurrence = (seen.get(s.sampleIdentifier) ?? 0) + 1;
    seen.set(s.sampleIdentifier, occurrence);
    const base = `${s.sampleIdentifier} (${occurrence})`;
    return { ...s, displayLabel: s.matrixType ? `${base} — ${s.matrixType}` : base };
  });
}
