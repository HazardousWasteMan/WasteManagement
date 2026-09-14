import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/production/application", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/production/application")>();
  return { ...original, resolveProductionApplication: vi.fn() };
});
import { headers } from "next/headers";
import { resolveProductionApplication } from "@/lib/production/application";
import { getProductionApplication, getApplicationOrganisationState } from "@/lib/production/server";

beforeEach(() => {
  vi.stubEnv("BASIC_AUTH_USER", "portal");
  vi.stubEnv("BASIC_AUTH_PASSWORD", "password");
  for (const key of ["PRODUCTION_ORGANISATION_ID", "PRODUCTION_SUPABASE_URL", "PRODUCTION_SUPABASE_PUBLISHABLE_KEY", "PRODUCTION_APP_EMAIL", "PRODUCTION_APP_PASSWORD"]) vi.stubEnv(key, "");
  vi.mocked(headers).mockResolvedValue(new Headers({ authorization: `Basic ${Buffer.from("portal:password").toString("base64")}` }) as Awaited<ReturnType<typeof headers>>);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("production feature entry point", () => {
  it("requires portal authentication independently of the UI provider/proxy", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers() as Awaited<ReturnType<typeof headers>>);
    await expect(getProductionApplication()).rejects.toThrow(/authentication required/);
    expect(resolveProductionApplication).not.toHaveBeenCalled();
  });
  it("keeps the legacy shell renderable when unconfigured but exposes no production store", async () => {
    expect(await getApplicationOrganisationState()).toEqual({ status: "unconfigured", organisation: null });
    await expect(getProductionApplication()).rejects.toThrow(/not configured/);
  });
  it("does not swallow Next.js request-time rendering signals", async () => {
    const signal = Object.assign(new Error("request-time rendering"), { digest: "DYNAMIC_SERVER_USAGE" });
    vi.mocked(headers).mockRejectedValue(signal);
    await expect(getApplicationOrganisationState()).rejects.toBe(signal);
  });
  it("takes no tenant argument and resolves the server-configured organisation", async () => {
    vi.stubEnv("PRODUCTION_ORGANISATION_ID", "10000000-0000-0000-0000-000000000001");
    vi.stubEnv("PRODUCTION_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("PRODUCTION_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("PRODUCTION_APP_EMAIL", "portal@example.test");
    vi.stubEnv("PRODUCTION_APP_PASSWORD", "test");
    vi.mocked(resolveProductionApplication).mockRejectedValue(new Error("Database unavailable"));
    await expect(getProductionApplication()).rejects.toThrow(/Database unavailable/);
    expect(resolveProductionApplication).toHaveBeenCalledWith(expect.objectContaining({ organisationId: process.env.PRODUCTION_ORGANISATION_ID }));
    expect(getProductionApplication.length).toBe(0);
  });
});
