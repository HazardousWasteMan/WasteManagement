// Whether a new waste entry may be appended for the current classification result —
// false once this exact classification has already been committed to a case, preventing
// the duplicate-entry bug where re-navigating to the Classification tab and pressing
// Continue again would otherwise silently duplicate the entry.
export function canCommitEntry(entryCommitted: boolean): boolean {
  return !entryCommitted;
}

// Whether the "3. Classification" tab should be reachable — disabled once this entry's
// result has already been committed to a case, so the duplicate-append path in
// canCommitEntry is unreachable from the UI too, not just guarded in the handler.
export function isClassificationTabEnabled(hasClassificationResult: boolean, entryCommitted: boolean): boolean {
  return hasClassificationResult && !entryCommitted;
}

// Whether the "5. Facility match" tab should be reachable — requires BOTH an active case
// and a current (not-yet-superseded) classification result, so navigating there mid-loop
// (after "Add another sample" reset classificationResult but before the new sample is
// classified) shows a disabled tab instead of a blank dead-end pane.
export function isFacilityMatchTabEnabled(hasActiveCase: boolean, hasClassificationResult: boolean): boolean {
  return hasActiveCase && hasClassificationResult;
}

// Whether the "4. Project" tab should be reachable — only before a case exists for this
// document (project assignment happens once per case, on the first entry).
export function isProjectTabEnabled(hasClassificationResult: boolean, hasActiveCase: boolean): boolean {
  return hasClassificationResult && !hasActiveCase;
}

// Whether the "2. Review extraction" tab should be reachable — disabled once this entry's
// result has already been committed to a case, since re-editing and re-confirming from here
// would silently produce a fresh classification that the already-committed WasteEntry (and
// any facility-match view derived from the stale classificationResult) would then disagree
// with.
export function isReviewTabEnabled(hasExtraction: boolean, entryCommitted: boolean): boolean {
  return hasExtraction && !entryCommitted;
}

// Whether handleExtracted was invoked for a genuinely NEW document upload (sampleIdentifier
// is null: either UploadStep's single-sample onExtracted, or handleSamplesFound's multi-sample
// detection) versus continuing the "add another sample" loop on an already-in-progress
// document (a real sampleIdentifier string, picked from SampleSelectionStep). New-document
// entry points must reset activeCase/consumedSampleIdentifiers/detectedSamples/pendingFile so
// a fresh document never inherits a previous document's stale case or classification;
// continuing-the-loop entry points must NOT reset them, since the whole point of that loop is
// to keep building the SAME case.
export function shouldStartNewCase(sampleIdentifier: string | null): sampleIdentifier is null {
  return sampleIdentifier === null;
}

// Whether a classify response for `requestGeneration` should still be applied — false when a
// newer document has entered the wizard (incrementing the generation counter) since this
// request was launched, which would otherwise let a stale response overwrite state with a
// mismatched extraction/classification pairing.
export function isResponseStillCurrent(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}
