"use client";
import { createContext, useContext } from "react";
import type { OrganisationState } from "@/lib/production/types";

const OrganisationContext = createContext<OrganisationState | undefined>(undefined);

/** Read-only display context. Mutations resolve their own server context; this is not an
 * authorisation token and there is intentionally no setter or organisation switcher. */
export function OrganisationProvider({ value, children }: {
  value: OrganisationState;
  children: React.ReactNode;
}) {
  return <OrganisationContext.Provider value={value}>{children}</OrganisationContext.Provider>;
}

export function useOrganisation() {
  const context = useContext(OrganisationContext);
  if (!context) throw new Error("useOrganisation requires the application OrganisationProvider");
  return context;
}
