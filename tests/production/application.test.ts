import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readApplicationConfig, resolveProductionApplication } from "@/lib/production/application";
import type { CreateProject } from "@/lib/production/types";

const organisationId = "10000000-0000-0000-0000-000000000001";
const otherId = "10000000-0000-0000-0000-000000000002";
const env = {
  PRODUCTION_ORGANISATION_ID: organisationId,
  PRODUCTION_SUPABASE_URL: "http://127.0.0.1:54321",
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  PRODUCTION_APP_EMAIL: "portal@example.test",
  PRODUCTION_APP_PASSWORD: "local-test-password",
};
const config = readApplicationConfig(env);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function setup(allowed = true) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/auth/v1/token") return json({ access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600,
      token_type: "bearer", user: { id: "test-app-user", email: env.PRODUCTION_APP_EMAIL } });
    if (url.pathname === "/rest/v1/organisations") return json(allowed ? [{ id: organisationId, name: "Customer A", created_at: "2026-09-08" }] : []);
    if (url.pathname === "/rest/v1/projects") {
      if (init?.method === "POST") return json({ id: "new-project", ...JSON.parse(init.body as string) }, 201);
      return json([{ id: "project-a", organisation_id: organisationId }, { id: "project-b", organisation_id: otherId }]
        .filter(project => `eq.${project.organisation_id}` === url.searchParams.get("organisation_id")));
    }
    throw new Error(`Unexpected test request ${url.pathname}`);
  };
  return { fetcher, requests };
}

afterEach(() => vi.unstubAllEnvs());
describe("application organisation resolution", () => {
  it("resolves the configured customer and an organisation-scoped project abstraction", async () => {
    const { fetcher, requests } = setup();
    const app = await resolveProductionApplication(config, fetcher);
    expect(app.organisation).toEqual({ id: organisationId, name: "Customer A" });
    expect(await app.store.listProjects()).toEqual([{ id: "project-a", organisation_id: organisationId }]);
    const created = await app.store.createProject({ name: "Site", location: "Oslo", organisation_id: otherId } as CreateProject);
    expect(created.organisation_id).toBe(organisationId);
    expect(requests[1].url.searchParams.get("id")).toBe(`eq.${organisationId}`);
    expect(requests.every(request => request.init?.cache === "no-store")).toBe(true);
    expect(requests.every(request => request.init?.redirect === "error")).toBe(true);
  });

  it("fails closed when the configured organisation is absent or the identity lacks membership", async () => {
    await expect(resolveProductionApplication(config, setup(false).fetcher)).rejects.toThrow(/missing or inaccessible/);
  });

  it("never falls back to another organisation returned by the database", async () => {
    const { fetcher } = setup();
    const otherFetcher: typeof fetch = (input, init) => String(input).includes("/organisations")
      ? Promise.resolve(json([{ id: otherId, name: "Customer B" }])) : fetcher(input, init);
    await expect(resolveProductionApplication(config, otherFetcher)).rejects.toThrow(/missing or inaccessible/);
  });

  it("sign-in failures do not issue any production query or expose provider error text", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ msg: "sensitive-provider-detail", error_code: "invalid_credentials" }, 400));
    await expect(resolveProductionApplication(config, fetcher)).rejects.toThrow("Production application sign-in failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("has no implicit organisation or fallback to existing compliance credentials", () => {
    expect(() => readApplicationConfig({ SUPABASE_URL: "https://existing.example", SUPABASE_SERVICE_ROLE_KEY: "secret" })).toThrow(/not configured/);
    expect(() => readApplicationConfig({ PRODUCTION_ORGANISATION_ID: organisationId })).toThrow(/incomplete/);
  });

  it.each(["sb_secret_secret", "invalid", `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`])(
    "rejects non-public application key %s", key => {
      expect(() => readApplicationConfig({ ...env, PRODUCTION_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/publishable or anon/);
    });

  it("accepts the legacy local anon JWT without a hard-coded organisation", () => {
    const key = `x.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.x`;
    expect(readApplicationConfig({ ...env, PRODUCTION_ORGANISATION_ID: otherId, PRODUCTION_SUPABASE_PUBLISHABLE_KEY: key }).organisationId).toBe(otherId);
  });

  it.each(["http://remote.example", "https://user:password@remote.example", "https://remote.example/path"])("rejects unsafe URL %s", url => {
    expect(() => readApplicationConfig({ ...env, PRODUCTION_SUPABASE_URL: url })).toThrow();
  });
});
