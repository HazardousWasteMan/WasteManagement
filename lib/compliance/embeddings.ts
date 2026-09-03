// lib/compliance/embeddings.ts
//
// Confirm https://docs.voyageai.com/docs/embeddings before relying on this in production: model
// name and default output dimension (1024) must match the legal_paragraphs.embedding column
// dimension set in Task 1. We pass `output_dimension: 1024` explicitly below so a future change
// to the model's own default can't silently produce a dimension-mismatched vector.

const VOYAGE_MODEL = "voyage-4";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_OUTPUT_DIMENSION = 1024;

function assertKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not configured");
  return key;
}

export async function embedText(text: string): Promise<number[]> {
  const key = assertKey();
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      output_dimension: VOYAGE_OUTPUT_DIMENSION,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings request failed: HTTP ${res.status} — ${body}`);
  }
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Voyage embeddings response missing embedding data");
  }
  return embedding;
}
