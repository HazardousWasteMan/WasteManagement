import { fileURLToPath } from "node:url";
import { LovdataSource } from "../lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "../lib/compliance/store";
import { embedText } from "../lib/compliance/embeddings";

// The one real paragraph this proof slice seeds: Avfallsforskriften § 11-4, the hazardous-waste
// handling-obligation provision that grounds the BK-skjema legal-basis field wired in Step 6.
// Extend this list once more of the seed corpus is added (out of scope for this slice, spec §10).
export function buildSeedLocations(documentId: string): { documentId: string; article: string; paragraph: string }[] {
  return [{ documentId, article: "11", paragraph: "4" }];
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
