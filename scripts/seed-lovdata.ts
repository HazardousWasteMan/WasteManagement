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
  ];
}

async function main() {
  const source = new LovdataSource();
  const store = createSupabaseParagraphStore();

  for (const location of buildSeedLocations("avfallsforskriften")) {
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
