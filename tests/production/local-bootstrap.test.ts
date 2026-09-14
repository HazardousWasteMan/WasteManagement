import { describe, expect, it, vi } from "vitest";
import { assertLocalSupabaseUrl, bootstrapLocalOrganisation } from "@/scripts/production/local-bootstrap";

describe("local bootstrap safety", () => {
  it.each(["https://project.supabase.co", "http://127.0.0.1.attacker.example", "https://localhost", "http://user:pass@localhost", "http://localhost/path"])("rejects nonlocal/unsafe target %s before network access", async url => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(bootstrapLocalOrganisation({ url, publishableKey: "public", serviceKey: "secret", name: "Customer" }, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts only explicit loopback local API roots", () => {
    expect(assertLocalSupabaseUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
  });
  it("creates a member identity and writes no service key to app configuration", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(String(input).includes("/auth/") ? { id: "local-user" } : null), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    const result = await bootstrapLocalOrganisation({ url: "http://127.0.0.1:54321", publishableKey: "sb_publishable_local", serviceKey: "secret-admin-key", name: "Local customer" }, fetcher);
    expect(JSON.stringify(result)).not.toContain("secret-admin-key");
    expect(result.PRODUCTION_ORGANISATION_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(calls[2].init!.body as string)).toEqual({ organisation_id: result.PRODUCTION_ORGANISATION_ID, user_id: "local-user" });
    expect(calls.every(call => call.init?.redirect === "error")).toBe(true);
  });
});
