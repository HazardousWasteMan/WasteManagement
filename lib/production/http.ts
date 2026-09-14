import { BkQuestionError } from "@/lib/bk-skjema/questions";
import { unstable_rethrow } from "next/navigation";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import { ProjectInputError } from "./process-document";
import { ProcessingPersistenceError } from "./processing-store";

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ProjectInputError("Invalid identifier");
  return value;
}
export function origin(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ORIGIN_OPTIONS.some(option => option.value === value)) throw new ProjectInputError("Invalid origin/process");
  return value;
}
export function sameOrigin(request: Request) {
  const source = request.headers.get("origin");
  const expected = new URL(request.url);
  // Next may reconstruct request.url with its internal hostname. The incoming Host is
  // the browser-facing authority; retain the protocol and reject foreign origins.
  expected.host = request.headers.get("host") ?? expected.host;
  if (source && source !== expected.origin) throw new ProjectInputError("Cross-origin request rejected");
}
export function productionError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof ProcessingPersistenceError && error.code === "40001") return Response.json({ error: "This draft changed in another request. Reload the workspace before saving." }, { status: 409 });
  if (error instanceof ProcessingPersistenceError && error.code === "22023") return Response.json({error:error.message},{status:400});
  if (error instanceof BkQuestionError || error instanceof ProjectInputError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof ProcessingPersistenceError && ["23505", "55P03"].includes(error.code ?? "")) return Response.json({ error: "This document is already processing or this attempt identifier has been used. Refresh to see its status." }, { status: 409 });
  if (error instanceof ProcessingPersistenceError && ["23503", "42501"].includes(error.code ?? "")) return Response.json({ error: "Record is unavailable in this project." }, { status: 404 });
  return Response.json({ error: "Production service unavailable. Refresh to check saved results before retrying." }, { status: 503 });
}
