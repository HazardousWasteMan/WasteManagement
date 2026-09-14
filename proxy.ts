import type { NextRequest } from "next/server";
import { hasPortalAccess } from "@/lib/basic-auth";

export function proxy(request: NextRequest) {
  if (hasPortalAccess(request.headers.get("authorization"), process.env.BASIC_AUTH_USER, process.env.BASIC_AUTH_PASSWORD)) return;

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
