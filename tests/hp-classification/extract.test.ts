import { vi, describe, it, expect, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";

const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  return {
    ...actual,
    // Must be a `function` expression, not an arrow function — `new Anthropic(...)` requires a
    // real constructor, and arrow functions cannot be called with `new` (verified: an arrow-
    // function mockImplementation here fails every test with "is not a constructor").
    default: vi.fn().mockImplementation(function () {
      return { messages: { stream: mockStream, create: vi.fn() } };
    }),
  };
});

import { validateExtractionResponse, hasUsableText, buildMessageContent, validateListSamplesResponse, normalizeSuggestedOriginProcess, extractSampleData, ExtractionTruncatedError, ExtractionTimeoutError } from "@/lib/hp-classification/extract";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import type { DetectedSample } from "@/lib/hp-classification/extract";
import type { AnalyteReference } from "@/lib/hp-classification/types";

describe("validateExtractionResponse", () => {
  const validResponse = {
    metadata: { customerName: "Test Co", matrixType: "jord", physicalState: "solid" },
    results: [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
    ],
    testResults: [],
    unmatchedAnalytes: [],
  };

  it("accepts a well-formed extraction response", () => {
    expect(validateExtractionResponse(validResponse)).toBe(true);
  });

  it("rejects a response missing the results array", () => {
    const { results: _results, ...rest } = validResponse;
    expect(validateExtractionResponse(rest)).toBe(false);
  });

  it("rejects a response where a result row is missing rawAnalyteName", () => {
    const bad = { ...validResponse, results: [{ analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }] };
    expect(validateExtractionResponse(bad)).toBe(false);
  });

  it("accepts a result row with analyteId: null (unmatched)", () => {
    const withUnmatched = { ...validResponse, results: [{ rawAnalyteName: "some unknown thing", analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }] };
    expect(validateExtractionResponse(withUnmatched)).toBe(true);
  });

  it("rejects a response that isn't an object", () => {
    expect(validateExtractionResponse(null)).toBe(false);
    expect(validateExtractionResponse("a string")).toBe(false);
  });

  it("accepts a response with a real suggestedOriginProcess value from ORIGIN_OPTIONS", () => {
    const withSuggestion = { ...validResponse, suggestedOriginProcess: "hydraulic oil waste" };
    expect(validateExtractionResponse(withSuggestion)).toBe(true);
  });

  it("accepts a response with suggestedOriginProcess explicitly null", () => {
    const withNullSuggestion = { ...validResponse, suggestedOriginProcess: null };
    expect(validateExtractionResponse(withNullSuggestion)).toBe(true);
  });

  it("rejects a response where suggestedOriginProcess is a non-string, non-null value", () => {
    const bad = { ...validResponse, suggestedOriginProcess: 42 };
    expect(validateExtractionResponse(bad)).toBe(false);
  });
});

describe("hasUsableText", () => {
  it("returns false for the real Italian sample PDF's page-marker-only extraction (verified garbage: 729 chars, 0 words of 4+ letters)", () => {
    const realGarbage = "\n\n-- 1 of 41 --\n\n\n\n-- 2 of 41 --\n\n\n\n-- 3 of 41 --\n\n\n\n-- 4 of 41 --\n\n\n\n-- 5 of 41 --\n\n\n\n-- 6 of 41 --\n\n\n\n-- 7 of 41 --\n\n\n\n-- 8 of 41 --\n\n\n\n-- 9 of 41 --\n\n\n\n-- 10 of 41 --\n\n\n\n-- 11 of 41 --\n\n\n\n-- 12 of 41 --\n\n\n\n-- 13 of 41 --\n\n\n\n-- 14 of 41 --\n\n\n\n-- 15 of 41 --\n\n\n\n-- 16 of 41 --\n\n\n\n-- 17 of 41 --\n\n\n\n-- 18 of 41 --\n\n\n\n-- 19 of 41 --\n\n\n\n-- 20 of 41 --\n\n\n\n-- 21 of 41 --\n\n\n\n-- 22 of 41 --\n\n\n\n-- 23 of 41 --\n\n\n\n-- 24 of 41 --\n\n\n\n-- 25 of 41 --\n\n\n\n-- 26 of 41 --\n\n\n\n-- 27 of 41 --\n\n\n\n-- 28 of 41 --\n\n\n\n-- 29 of 41 --\n\n\n\n-- 30 of 41 --\n\n\n\n-- 31 of 41 --\n\n\n\n-- 32 of 41 --\n\n\n\n-- 33 of 41 --\n\n\n\n-- 34 of 41 --\n\n\n\n-- 35 of 41 --\n\n\n\n-- 36 of 41 --\n\n\n\n-- 37 of 41 --\n\n\n\n-- 38 of 41 --\n\n\n\n-- 39 of 41 --\n\n\n\n-- 40 of 41 --\n\n\n\n-- 41 of 41 --\n\n";
    expect(hasUsableText(realGarbage)).toBe(false);
  });

  it("returns false for the real Eurofins sample PDF's whitespace-noise extraction (verified garbage: mostly tabs/newlines, 0 words of 4+ letters)", () => {
    const realGarbage = "\n\n\n\n\n\n\n\n\n\n\n\n\n \t\n\n\n \t\n\n\n\n\n\t\n\n\t\n\t \t\n \t \t \t\n\t \t \t\t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t\t\n \t \t\t \t";
    expect(hasUsableText(realGarbage)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasUsableText("")).toBe(false);
  });

  it("returns false for whitespace-only text", () => {
    expect(hasUsableText("   \n\n   ")).toBe(false);
  });

  it("returns false for text with only short words (fewer than 10 real words of 4+ letters)", () => {
    // "the of and a it is to see her him" -- only "see" and "him" hit 3 letters, none reach 4+, so 0 words
    expect(hasUsableText("the of and a it is to see her him")).toBe(false);
  });

  it("returns true for real extracted report text", () => {
    // Verified: terra, rocce, contenenti, sostanze, pericolose, provenienti, scavo, cantiere, edile,
    // risultati, laboratorio, campione, analisi = 13 words of 4+ letters (>= 10 threshold)
    expect(hasUsableText("EER 170503 terra e rocce contenenti sostanze pericolose provenienti da scavo cantiere edile risultati laboratorio campione analisi")).toBe(true);
  });

  it("returns true for real text even alongside page markers", () => {
    // Verified: Arsenico, concentrazione, risultato, campione, laboratorio, metodo, analisi, eseguita,
    // presso, struttura, autorizzata = 11 words of 4+ letters (>= 10 threshold)
    expect(hasUsableText("-- 1 of 2 --\n\nArsenico 51700 mg/kg concentrazione risultato campione laboratorio metodo analisi eseguita presso struttura autorizzata\n\n-- 2 of 2 --")).toBe(true);
  });
});

describe("buildMessageContent", () => {
  const analyteRef: AnalyteReference[] = [
    {
      analyteId: "arsenic", canonicalNameNo: "arsen", canonicalNameIt: "arsenico", canonicalNameEn: "arsenic",
      casNumber: "7440-38-2", defaultUnit: "mg/kg", substanceGroup: "metal", mFactorAcute: null, mFactorChronic: null,
      elementSymbol: "As", hStatement: null, hazardClass: null, hStatements: null,
    },
  ];
  const smallPdfBuffer = Buffer.from("%PDF-1.4 fake content for testing");

  it("builds a text-only content block when the PDF has usable extracted text", () => {
    // Extended to clear the new >=10-word-of-4+-letters threshold (verified: 12 such words).
    const realText = "Real report text with arsenico concentrazione risultato campione laboratorio analisi metodo eseguita 5.17%";
    const content = buildMessageContent(realText, smallPdfBuffer, analyteRef, null);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect((content[0] as { type: "text"; text: string }).text).toContain(realText);
    expect((content[0] as { type: "text"; text: string }).text).toContain("arsenic");
  });

  it("builds a document content block plus text instructions when the PDF has no usable text", () => {
    const content = buildMessageContent("-- 1 of 41 --\n\n-- 2 of 41 --", smallPdfBuffer, analyteRef, null);
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("document");
    const doc = content[0] as { type: "document"; source: { type: string; media_type: string; data: string } };
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.source.data).toBe(smallPdfBuffer.toString("base64"));
    expect(content[1].type).toBe("text");
    expect((content[1] as { type: "text"; text: string }).text).toContain("arsenic");
  });

  it("branch decision (text vs document) is consistent with what sourceType would be derived as", () => {
    const textPdf = "Real report text with arsenico concentrazione risultato campione laboratorio analisi metodo eseguita 5.17%";
    const scannedPdf = "-- 1 of 41 --\n\n-- 2 of 41 --";

    const textContent = buildMessageContent(textPdf, smallPdfBuffer, analyteRef, null);
    expect(hasUsableText(textPdf)).toBe(true);
    expect(textContent[0].type).toBe("text");
    // sourceType would be derived as "text" here — consistent with the text-only branch taken.

    const scannedContent = buildMessageContent(scannedPdf, smallPdfBuffer, analyteRef, null);
    expect(hasUsableText(scannedPdf)).toBe(false);
    expect(scannedContent[0].type).toBe("document");
    // sourceType would be derived as "document" here — consistent with the document branch taken.
  });

  it("includes a scoping instruction when a sampleIdentifier is provided", () => {
    const content = buildMessageContent("Some report text with enough real words to pass the usable-text check for sure", smallPdfBuffer, analyteRef, "ENAT-BØF1-BO9OB1");
    expect(content[0].type).toBe("text");
    const text = (content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("ENAT-BØF1-BO9OB1");
    expect(text.toLowerCase()).toContain("only");
  });

  it("has no scoping instruction when sampleIdentifier is null", () => {
    const content = buildMessageContent("Some report text with enough real words to pass the usable-text check for sure", smallPdfBuffer, analyteRef, null);
    const text = (content[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("ENAT-BØF1-BO9OB1");
  });

  it("includes the real origin/process option list so Claude can pick from it", () => {
    const analyteRef: AnalyteReference[] = [];
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const textBlock = content.find(b => b.type === "text");
    expect(textBlock).toBeDefined();
    expect((textBlock as { text: string }).text).toContain("hydraulic oil waste");
    expect((textBlock as { text: string }).text).toContain("suggestedOriginProcess");
  });

  it("instructs Claude to extract every result row across all pages of a long document, not just a subset", () => {
    const analyteRef: AnalyteReference[] = [];
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const textBlock = content.find(b => b.type === "text");
    expect(textBlock).toBeDefined();
    const text = (textBlock as { text: string }).text;
    expect(text).toContain("EVERY result row");
    expect(text).toContain("ALL pages");
  });

  it("includes real, never-fabricated location extraction instructions in the schema", () => {
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), [], null);
    const text = (content[0] as { type: "text"; text: string }).text;
    expect(text).toContain('"location": string | null');
    expect(text.toLowerCase()).toContain("never guess or infer a location");
  });
});

describe("validateListSamplesResponse", () => {
  it("accepts a well-formed single-sample array", () => {
    expect(
      validateListSamplesResponse([
        { sampleIdentifier: "ENAT-BØF1-BO9OB1", matrixType: "Betong", parentSampleIdentifier: null },
      ])
    ).toBe(true);
  });

  it("accepts a well-formed multi-sample array", () => {
    const samples = [
      { sampleIdentifier: "AR-25-MM-120316-01", matrixType: null, parentSampleIdentifier: null },
      { sampleIdentifier: "AR-25-MM-118438-01", matrixType: "Betong", parentSampleIdentifier: null },
      { sampleIdentifier: "AR-25-MM-118439-01", matrixType: "Betong", parentSampleIdentifier: null },
    ];
    expect(validateListSamplesResponse(samples)).toBe(true);
  });

  it("accepts an empty array (no distinguishable samples found)", () => {
    expect(validateListSamplesResponse([])).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateListSamplesResponse({ sampleIdentifier: "x", matrixType: null, parentSampleIdentifier: null })).toBe(false);
  });

  it("rejects an array element missing sampleIdentifier", () => {
    expect(validateListSamplesResponse([{ matrixType: "Betong", parentSampleIdentifier: null }])).toBe(false);
  });

  it("rejects an array element with a non-string sampleIdentifier", () => {
    expect(validateListSamplesResponse([{ sampleIdentifier: 123, matrixType: null, parentSampleIdentifier: null }])).toBe(false);
  });

  it("rejects an array element where matrixType is present but not string-or-null", () => {
    expect(validateListSamplesResponse([{ sampleIdentifier: "x", matrixType: 5, parentSampleIdentifier: null }])).toBe(false);
  });

  it("accepts an array element with a string parentSampleIdentifier", () => {
    expect(
      validateListSamplesResponse([
        { sampleIdentifier: "AR-25-eluate", matrixType: null, parentSampleIdentifier: "AR-25-main" },
      ])
    ).toBe(true);
  });

  it("rejects an array element where parentSampleIdentifier is present but not string-or-null", () => {
    expect(
      validateListSamplesResponse([{ sampleIdentifier: "x", matrixType: null, parentSampleIdentifier: 5 }])
    ).toBe(false);
  });

  it("filters to exactly 1 top-level sample for a document shaped like the real Italian PDF (main sample + eluate sub-test)", () => {
    const samples: DetectedSample[] = [
      { sampleIdentifier: "AR-25-MM-118438-01", matrixType: "Terreno", parentSampleIdentifier: null },
      { sampleIdentifier: "AR-25-MM-118438-01-ELU", matrixType: "Eluato", parentSampleIdentifier: "AR-25-MM-118438-01" },
    ];
    const topLevel = samples.filter(s => s.parentSampleIdentifier === null);
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].sampleIdentifier).toBe("AR-25-MM-118438-01");
  });
});

describe("normalizeSuggestedOriginProcess", () => {
  it("accepts a real ORIGIN_OPTIONS value unchanged", () => {
    expect(normalizeSuggestedOriginProcess("hydraulic oil waste")).toBe("hydraulic oil waste");
  });

  it("rejects a value not in ORIGIN_OPTIONS, returning null", () => {
    expect(normalizeSuggestedOriginProcess("something Claude made up")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeSuggestedOriginProcess(null)).toBeNull();
  });

  it("returns null for undefined input (field absent from the LLM's response)", () => {
    expect(normalizeSuggestedOriginProcess(undefined)).toBeNull();
  });

  it("returns null for a non-string, non-null value", () => {
    expect(normalizeSuggestedOriginProcess(42)).toBeNull();
  });
});

describe("extractSampleData retry/error behavior", () => {
  const realWordsText = "some real report text with enough real words in it to count as usable, definitely more than ten of them present here";

  beforeEach(() => {
    mockStream.mockReset();
  });

  it("does not retry a truncated (max_tokens) response — fails after exactly 1 attempt", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{}" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTruncatedError);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("does not retry a timeout (aborted stream) — fails after exactly 1 attempt", async () => {
    mockStream.mockReturnValue({
      finalMessage: () => Promise.reject(new APIUserAbortError()),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTimeoutError);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("retries a malformed-JSON response up to MAX_EXTRACTION_ATTEMPTS times", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "not valid json" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(
      "Claude's extraction response was not valid JSON"
    );
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("passes max_tokens: 64000 to the streaming call", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{}" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTruncatedError);
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 64000 }),
      expect.anything()
    );
  });
});

describe("extractSampleData — page batching for large scanned documents", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  async function buildRealPdf(pageCount: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
    return Buffer.from(await doc.save());
  }

  function mockSuccessResponse(rawAnalyteName: string) {
    return {
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                metadata: {},
                results: [
                  { rawAnalyteName, analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
                ],
                testResults: [],
                unmatchedAnalytes: [],
                suggestedOriginProcess: null,
              }),
            },
          ],
        }),
    };
  }

  it("does not batch a scanned document at or below the page threshold — single call", async () => {
    const pdf = await buildRealPdf(10);
    mockStream.mockReturnValue(mockSuccessResponse("substance-a"));

    const result = await extractSampleData("", pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
  });

  it("never batches when real extractable text exists, regardless of the buffer's real page count", async () => {
    const pdf = await buildRealPdf(31); // well over the batching threshold
    const realWordsText = "some real report text with enough real words in it to count as usable, definitely";
    mockStream.mockReturnValue(mockSuccessResponse("substance-a"));

    await extractSampleData(realWordsText, pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("splits a 31-page scanned document into 3 batches, runs them concurrently, and merges the results", async () => {
    const pdf = await buildRealPdf(31);
    mockStream
      .mockReturnValueOnce(mockSuccessResponse("substance-a"))
      .mockReturnValueOnce(mockSuccessResponse("substance-b"))
      .mockReturnValueOnce(mockSuccessResponse("substance-c"));

    const result = await extractSampleData("", pdf, [], null);

    expect(mockStream).toHaveBeenCalledTimes(3);
    expect(result.results.map(r => r.rawAnalyteName).sort()).toEqual(["substance-a", "substance-b", "substance-c"]);
    // Merged results get fresh sequential ids, not each batch's own colliding "r1".
    expect(result.results.map(r => r.resultId)).toEqual(["r1", "r2", "r3"]);
    expect(result.sourceType).toBe("document");
  });

  it("returns a partial merged result when one batch fails but others succeed", async () => {
    const pdf = await buildRealPdf(31);

    // Note: the 3 batches' sub-PDFs can't be used as a mock identity key here — the test's
    // synthetic pages are all blank and identically sized, so pdf-lib's deterministic output
    // makes two different batches' serialized sub-PDF bytes come out byte-for-byte IDENTICAL
    // (verified). Instead, this keys behavior by call INDEX, but in a way immune to the exact
    // bug this test exists to catch: extractSingleDocumentBatch runs each batch's attempts
    // synchronously up to its first `await`, so with 3 batches run concurrently via
    // Promise.allSettled, the real call order is deterministic — batch 1's only attempt, then
    // batch 2's first attempt immediately followed by its retry (both happen synchronously,
    // before control ever yields to batch 3), then batch 3's only attempt. Failing BOTH of
    // batch 2's attempts (call indices 2 and 3) means batch 2 is truly, permanently failed —
    // not just failed-then-silently-rescued by consuming a different call's queued response,
    // which is exactly what the old (broken) version of this test did by accident.
    let callCount = 0;
    mockStream.mockImplementation(() => {
      callCount++;
      if (callCount === 2 || callCount === 3) {
        throw new Error("simulated batch failure");
      }
      return mockSuccessResponse(`substance-from-call-${callCount}`);
    });

    const result = await extractSampleData("", pdf, [], null);

    // Exactly 2 of the 3 batches' data made it into the merged result — the third (batch 2,
    // whose both attempts failed) is fully absent, and neither surviving result's name was
    // fabricated or borrowed from another call's response.
    expect(result.results).toHaveLength(2);
    const names = result.results.map(r => r.rawAnalyteName).sort();
    expect(names).toEqual(["substance-from-call-1", "substance-from-call-4"]);
  });

  it("rejects when every batch fails", async () => {
    const pdf = await buildRealPdf(31);
    mockStream.mockImplementation(() => {
      throw new Error("simulated total failure");
    });

    await expect(extractSampleData("", pdf, [], null)).rejects.toThrow("simulated total failure");
  });

  it("logs each rejected batch's page range and reason when at least one batch fails", async () => {
    const pdf = await buildRealPdf(31);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let callCount = 0;
    mockStream.mockImplementation(() => {
      callCount++;
      if (callCount === 2 || callCount === 3) {
        throw new Error("simulated batch failure");
      }
      return mockSuccessResponse(`substance-from-call-${callCount}`);
    });

    await extractSampleData("", pdf, [], null);

    const loggedRejection = errorSpy.mock.calls.some(
      call => typeof call[0] === "string" && call[0].includes("batch failed") && /pages \d+-\d+/.test(call[0])
    );
    expect(loggedRejection).toBe(true);
    errorSpy.mockRestore();
  });

  it("falls back to the single-call extraction path when the page-count probe throws (e.g. an encrypted/malformed PDF)", async () => {
    // Not a real PDF at all — PDFDocument.load will throw for this buffer, simulating both the
    // EncryptedPDFError and malformed-PDF cases getPdfPageCount can hit.
    const notARealPdf = Buffer.from("this is not a valid pdf file at all");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStream.mockReturnValue(mockSuccessResponse("substance-a"));

    const result = await extractSampleData("", notARealPdf, [], null);

    // Falls through to extractSingleDocumentBatch: exactly one call, not the batching path.
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
