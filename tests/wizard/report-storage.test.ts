import { describe, it, expect, beforeEach } from "vitest";
import { saveReportFile, getReportFile } from "@/lib/wizard/report-storage";

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: "application/pdf" });
}

describe("report-storage", () => {
  it("saves and retrieves a file by case id", async () => {
    const file = makeFile("report.pdf", "fake pdf bytes");
    await saveReportFile("case-a", file);
    const retrieved = await getReportFile("case-a");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("report.pdf");
  });

  it("returns null for a case id with no saved file", async () => {
    const retrieved = await getReportFile("no-such-case");
    expect(retrieved).toBeNull();
  });

  it("keeps files for different case ids independent", async () => {
    await saveReportFile("case-b", makeFile("b.pdf", "b content"));
    await saveReportFile("case-c", makeFile("c.pdf", "c content"));
    const b = await getReportFile("case-b");
    const c = await getReportFile("case-c");
    expect(b!.name).toBe("b.pdf");
    expect(c!.name).toBe("c.pdf");
  });

  it("overwriting a case id's file replaces the previous one", async () => {
    await saveReportFile("case-d", makeFile("first.pdf", "first"));
    await saveReportFile("case-d", makeFile("second.pdf", "second"));
    const retrieved = await getReportFile("case-d");
    expect(retrieved!.name).toBe("second.pdf");
  });
});
