"use client";
import { I18nProvider } from "@heroui/react";
import { OrganisationProvider } from "@/components/production/OrganisationProvider";
import type { OrganisationState } from "@/lib/production/types";

export function Providers({ children, organisation }: { children: React.ReactNode; organisation: OrganisationState }) {
  return (
    <I18nProvider locale="en-US">
      <OrganisationProvider value={organisation}>{children}</OrganisationProvider>
    </I18nProvider>
  );
}
