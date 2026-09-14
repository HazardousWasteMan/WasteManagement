import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Shared by the existing proxy and production server entry point. Fail closed. */
export function hasPortalAccess(header: string | null, user?: string, password?: string): boolean {
  const [scheme, encoded] = (header ?? "").split(" ");
  if (!user || !password || scheme !== "Basic" || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString();
  const sep = decoded.indexOf(":");
  const userOk = safeEqual(decoded.slice(0, sep === -1 ? undefined : sep), user);
  const passOk = safeEqual(sep === -1 ? "" : decoded.slice(sep + 1), password);
  return userOk && passOk;
}
