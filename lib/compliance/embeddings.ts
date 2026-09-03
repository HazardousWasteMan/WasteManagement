//
// Confirm https://docs.voyageai.com/docs/embeddings before relying on this in production: model
// name and default output dimension (1024 as of this plan being written) must match the
// legal_paragraphs.embedding column dimension set in Task 1.

const VOYAGE_MODEL = "voyage-4";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

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
    body: JSON.stringify({ input: [text], model: VOYAGE_MODEL }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings request failed: HTTP ${res.status} — ${body}`);
  }
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}
