import type { BkField } from "./form-map";
/** Shared unchanged coordinate selection for Data Lab and production. Coordinates remain
 * in the provider's page frame; DocumentPane normalizes them against the saved page size. */
export function sourceHighlights(field: BkField | null | undefined, documentRef?:string) {
  return (field?.citations ?? []).filter(c => c.bbox && c.page !== null && (!documentRef || !c.documentRef || c.documentRef===documentRef)).map(c => ({ page: c.page!, bbox: c.bbox!, blockId: c.blockId }));
}
