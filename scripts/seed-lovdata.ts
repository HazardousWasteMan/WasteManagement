import { fileURLToPath } from "node:url";
import { LovdataSource } from "../lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "../lib/compliance/store";
import { embedText } from "../lib/compliance/embeddings";

// The paragraphs this codebase seeds. Extend this list once more of the seed corpus is added —
// see each plan's Known follow-ups for what still needs a real citation.
export function buildSeedLocations(documentId: string): { documentId: string; article: string; paragraph: string }[] {
  return [
    { documentId, article: "11", paragraph: "4" }, // hazardous-waste handling obligation (Checkbox10)
    { documentId, article: "9", paragraph: "5" },  // landfill categories (Checkbox1/2/3)
    { documentId, article: "9", paragraph: "6" },  // waste permitted per landfill category (Checkbox1/2/3)
    { documentId, article: "11", paragraph: "2" }, // HP1-15 methodology basis (TextField38, every sample)
    { documentId, article: "11", paragraph: "vedlegg-2" }, // HP1-15 criteria table (TextField38, every sample)
  ];
}

async function main() {
  const source = new LovdataSource();
  const store = createSupabaseParagraphStore();

  for (const location of buildSeedLocations("avfallsforskriften")) {
    // Idempotency: this script has hit a duplicate-key conflict on re-runs against an already
    // partially-seeded table twice now (once during the § 11-2 cycle, once during this Vedlegg 2
    // cycle) — both times worked around ad-hoc instead of fixed here. Skipping an already-cached
    // location makes the whole script safely re-runnable, so adding one new location no longer
    // requires re-seeding or ad-hoc-scripting around everything already present.
    const existing = await store.findByLocation(location.documentId, location.article, location.paragraph);
    if (existing) {
      console.log(`Already cached, skipping: ${existing.id}`);
      continue;
    }
    const paragraph = await source.fetchParagraph(location);
    if (!paragraph) {
      console.error(`No paragraph found for ${JSON.stringify(location)} — skipping, not fabricating.`);
      continue;
    }
    const embedding = await embedText(paragraph.text);
    await store.insert(paragraph, embedding);
    console.log(`Seeded ${paragraph.id}`);
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
