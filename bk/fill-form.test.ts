import { test, expect } from "vitest";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillBkPdf, summarizeCoverage, BK_BLANK_FORM_PATH } from "@/lib/bk-skjema/fill-pdf";
import { syntheticSample } from "@/tests/production/synthetic-fixtures";

test("fill the BK form from an invented classification", async () => {
  const sample=syntheticSample("indeterminate");
  const {pdf,outcomes}=await fillBkPdf(fs.readFileSync(BK_BLANK_FORM_PATH),sample.fields);
  const directory=await mkdtemp(path.join(tmpdir(),"bk-fill-test-"));
  try {
    await writeFile(path.join(directory,"filled.pdf"),pdf);
    await writeFile(path.join(directory,"coverage.json"),JSON.stringify(summarizeCoverage(outcomes)));
    const summary=summarizeCoverage(outcomes);
    expect(summary.fieldsMapped).toBe(103);
    expect(outcomes.filter(outcome=>outcome.note?.startsWith("could not be set"))).toEqual([]);
    expect(outcomes.find(outcome=>outcome.field==="Checkbox4")?.value).toBe(false);
    expect(outcomes.find(outcome=>outcome.field==="Checkbox1")?.value).toBe(false);
    expect(outcomes.find(outcome=>outcome.field==="Checkbox3")?.value).toBe(false);
    expect(outcomes.filter(outcome=>outcome.label.startsWith("EAL-kode siffer")).map(outcome=>outcome.value).join("")).toBe("");
  } finally { await rm(directory,{recursive:true,force:true}); }
});
