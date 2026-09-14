import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrganisationProvider, useOrganisation } from "@/components/production/OrganisationProvider";

function Feature() {
  const state = useOrganisation();
  return <p>{state.status === "ready" ? state.organisation.name : "Organisation unavailable"}</p>;
}
describe("application UI context", () => {
  it("lets feature code display the resolved organisation without its own ID/configuration", () => {
    expect(renderToStaticMarkup(<OrganisationProvider value={{ status: "ready", organisation: { id: crypto.randomUUID(), name: "Our customer" } }}>
      <Feature />
    </OrganisationProvider>)).toContain("Our customer");
  });
  it("represents setup failure explicitly while retaining legacy children", () => {
    const html = renderToStaticMarkup(<OrganisationProvider value={{ status: "unconfigured", organisation: null }}>
      <Feature /><p>Legacy Data Lab</p>
    </OrganisationProvider>);
    expect(html).toContain("Organisation unavailable");
    expect(html).toContain("Legacy Data Lab");
  });
  it("has no global fallback outside the provider", () => {
    expect(() => renderToStaticMarkup(<Feature />)).toThrow(/requires the application/);
  });
});
