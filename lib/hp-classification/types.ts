export interface SampleMetadata {
  sampleId: string;
  externalReportNo: string;
  labName: string;
  customerName: string;
  sampleMarking: string;
  matrixType: string;
  samplingDate: string | null;
  receiptDate: string | null;
  originProcess: string | null;
  producerName: string | null;
  physicalState: "solid" | "liquid" | "powder";
  viscosity40cMm2s: number | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}

export interface SampleResult {
  resultId: string;
  sampleId: string;
  analyteId: string | null;
  rawAnalyteName: string;
  resultValue: number | null;
  isBelowLoq: boolean;
  loqValue: number | null;
  unitRaw: string;
  expressedOnDryBasis: boolean;
  method: string | null;
}

export interface AnalyteReference {
  analyteId: string;
  canonicalNameNo: string;
  canonicalNameIt: string | null;
  canonicalNameEn: string;
  casNumber: string | null;
  defaultUnit: string;
  substanceGroup: string;
  mFactorAcute: number | null;
  mFactorChronic: number | null;
  elementSymbol: string | null;
  hStatement: string | null;
  hazardClass: string | null;
  hStatements: { hStatement: string; hazardClass: string }[] | null;
}

export interface NormalizedResult {
  analyteId: string;
  resultDryBasisPct: number;
  isBelowLoq: boolean;
  confidenceFlags: string[];
}
