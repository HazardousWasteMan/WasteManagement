import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createProductionStore } from "@/lib/production/store";
import type { CreateAssessment, CreateProject, ProductionDatabase } from "@/lib/production/types";

// Exercise the real Supabase query builder with an intercepted HTTP boundary. SQL behaviour
// is tested separately by executing the real migration in schema.test.ts.
function setup(body: unknown = [], status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  }));
  const client = createClient<ProductionDatabase>("https://example.supabase.co", "test-publishable-key", {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { store: createProductionStore(client, "organisation-a"), fetch, client };
}

describe("production Supabase adapter", () => {
  it("requires an explicit selected organisation, without a default customer", () => {
    const { client } = setup();
    expect(() => createProductionStore(client, " ")).toThrow(/Organisation ID/);
  });

  it("scopes every collection and assessment lookup to the selected organisation", async () => {
    const { store, fetch } = setup();
    await store.listProjects();
    await store.listWasteStreams("project-a");
    await store.listSourceDocuments("project-a");
    await store.listAssessments("stream-a");
    await store.listAssessmentDocuments("project-a", "assessment-a");
    await store.getAssessment("project-a", "assessment-a");
    for (const [url] of fetch.mock.calls as unknown as [string][]) {
      expect(new URL(url).searchParams.get("organisation_id")).toBe("eq.organisation-a");
    }
    const urls = (fetch.mock.calls as unknown as [string][]).map(([url]) => new URL(url));
    expect(urls[1].searchParams.get("project_id")).toBe("eq.project-a");
    expect(urls[3].searchParams.get("waste_stream_id")).toBe("eq.stream-a");
    expect(urls[5].searchParams.get("id")).toBe("eq.assessment-a");
  });

  it("does not allow extra runtime input to override the write organisation", async () => {
    const { store, fetch } = setup({ id: "project-a" });
    await store.createProject({ name: "Site", location: "Oslo", organisation_id: "organisation-b" } as CreateProject);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      organisation_id: "organisation-a", name: "Site", location: "Oslo",
    });
  });

  it("creates assessment and evidence together via one RPC, preserving null decisions", async () => {
    const { store, fetch } = setup({ id: "assessment-a", is_hazardous: null });
    const input: CreateAssessment = {
      id: "assessment-a", project_id: "project-a", waste_stream_id: "stream-a",
      assessed_at: "2026-09-08T12:00:00Z", eal_code: null, is_hazardous: null,
      decision_snapshot: { reason: "insufficient evidence" }, bk_output: null,
      compliance_evidence: [], documents: [{ source_document_id: "document-a",
        segment_key: "sample-a", first_page: 0, last_page: 1 }],
    };
    const result = await store.createAssessment(input);
    expect(result.is_hazardous).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/rest/v1/rpc/production_create_assessment");
    expect(JSON.parse(init.body as string)).toMatchObject({
      p_organisation_id: "organisation-a", p_id: input.id,
      p_is_hazardous: null, p_eal_code: null, p_documents: input.documents,
    });
  });

  it("surfaces persistence errors instead of silently using demo storage", async () => {
    const { store } = setup({ message: "permission denied", code: "42501" }, 403);
    await expect(store.listProjects()).rejects.toThrow(/permission denied/);
  });
});
