import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (user && pass && scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString();
    const sep = decoded.indexOf(":");
    const userOk = safeEqual(decoded.slice(0, sep === -1 ? undefined : sep), user);
    const passOk = safeEqual(sep === -1 ? "" : decoded.slice(sep + 1), pass);
    if (userOk && passOk) return;
  }

  // Fails closed: missing BASIC_AUTH_* env vars lock everything out rather
  // than silently disabling auth.
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="WasteManagementPortal"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
