import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedText } from "@/lib/compliance/embeddings";

describe("embedText", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.VOYAGE_API_KEY;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VOYAGE_API_KEY = originalKey;
  });

  it("returns the embedding vector from Voyage's response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    }) as unknown as typeof fetch;

    const result = await embedText("Avfallsforskriften § 11-4");
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws with a clear message on a non-OK response, never returns a fabricated vector", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }) as unknown as typeof fetch;

    await expect(embedText("some text")).rejects.toThrow(/Voyage embeddings request failed/);
  });

  it("throws if VOYAGE_API_KEY is not configured", async () => {
    delete process.env.VOYAGE_API_KEY;
    await expect(embedText("some text")).rejects.toThrow(/VOYAGE_API_KEY is not configured/);
  });
});
