import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { hasPortalAccess } from "@/lib/basic-auth";
import { OrganisationContextError, readApplicationConfig, resolveProductionApplication } from "./application";
import type { OrganisationState } from "./types";

/** Feature entry point: no tenant argument. React cache deduplicates within one request,
 * not across customers/requests. Every production operation starts here, including future
 * project creation: (await getProductionApplication()).store.createProject(input). */
export const getProductionApplication = cache(async () => {
  const requestHeaders = await headers();
  if (!hasPortalAccess(requestHeaders.get("authorization"), process.env.BASIC_AUTH_USER, process.env.BASIC_AUTH_PASSWORD)) {
    throw new Error("Portal authentication required");
  }
  return resolveProductionApplication(readApplicationConfig(process.env));
});

/** Existing legacy pages stay runnable during setup/outages. This state exposes no database
 * credentials and provides no fallback writable store. Production operations fail closed. */
export async function getApplicationOrganisationState(): Promise<OrganisationState> {
  try {
    const { organisation } = await getProductionApplication();
    return { status: "ready", organisation };
  } catch (error) {
    unstable_rethrow(error); // Preserve Next.js request-time rendering/navigation signals.
    if (error instanceof OrganisationContextError && error.status === "unconfigured") {
      return { status: "unconfigured", organisation: null };
    }
    // Do not log raw provider errors: they may include credentials or request headers.
    console.error("Application organisation could not be resolved; production operations are unavailable.");
    return { status: "unavailable", organisation: null };
  }
}
