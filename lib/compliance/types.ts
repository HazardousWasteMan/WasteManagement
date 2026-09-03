export type Jurisdiction = "no" | "eu";

export type GroundingTier = "grounded_high" | "grounded_stale" | "derived" | "no_match";

export type VerificationStatus = "current" | "updated" | "needs_reverification";

// One cached legal paragraph. Mirrors the legal_paragraphs table (Task 1) minus EU-only
// fields (base_celex, consolidated_celex, eos_incorporation_status, etc.), which this
// NO-only slice does not populate.
export interface LegalParagraph {
  id: string;
  source: Jurisdiction;
  jurisdictionApplies: string[];
  documentId: string;
  article: string;
  paragraph: string;
  text: string;
  inForce: boolean;
  lastVerifiedAt: string; // ISO 8601
  lastChangedAt: string; // ISO 8601
  verificationStatus: VerificationStatus;
  amendedBy: string[];
  previousVersionId: string | null;
  humanSignedOff: boolean;
  sourceLink: string;
}

// The result of a grounded lookup: which confidence tier applied, and the paragraph backing
// it (null only for no_match — grounded_high/grounded_stale/derived always carry a paragraph).
export interface GroundedResult {
  tier: GroundingTier;
  paragraph: LegalParagraph | null;
}

// An immutable freeze record, written once when a grounded form field is confirmed. Mirrors
// compliance_form_freezes (Task 1).
export interface FormFreeze {
  id: string;
  caseId: string;
  fieldName: string;
  citedParagraphId: string;
  paragraphTextAtFreeze: string;
  lastVerifiedAtAtFreeze: string;
  sourceLinkAtFreeze: string;
  frozenAt: string;
}
