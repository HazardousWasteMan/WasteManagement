// lib/compliance/sources/lovdata-source.ts
import type { LegalSource, LegalSourceQuery } from "@/lib/compliance/sources/legal-source";
import type { LegalParagraph } from "@/lib/compliance/types";
import { getParagraphFromArchive } from "@/lib/compliance/sources/lovdata-archive";

export class LovdataSource implements LegalSource {
  readonly source = "no" as const;

  async fetchParagraph(query: LegalSourceQuery): Promise<LegalParagraph | null> {
    const found = await getParagraphFromArchive(query);
    if (!found) return null;

    const now = new Date().toISOString();
    return {
      id: `no-${query.documentId}-${query.article}-${query.paragraph}`,
      source: "no",
      jurisdictionApplies: ["no"],
      documentId: query.documentId,
      article: query.article,
      paragraph: query.paragraph,
      text: found.text,
      inForce: true,
      lastVerifiedAt: now,
      lastChangedAt: found.lastChangedAt,
      verificationStatus: "current",
      amendedBy: [],
      previousVersionId: null,
      humanSignedOff: false,
      sourceLink: found.sourceLink,
    };
  }
}
