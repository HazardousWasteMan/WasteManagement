import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCleanLocalDatabase, seedLocalOrganisation } from "@/scripts/production/local-database";
import type { CreateProject } from "@/lib/production/types";
vi.mock("server-only", () => ({}));
import { resolveProductionApplication } from "@/lib/production/application";

let local: Awaited<ReturnType<typeof createCleanLocalDatabase>>;
let customer: Awaited<ReturnType<typeof seedLocalOrganisation>>;
let other: Awaited<ReturnType<typeof seedLocalOrganisation>>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Only the HTTP transport/Auth service is simulated. Reads/writes use the real Supabase
// query builder, application resolver, persistence adapter, migration schema and RLS.
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/auth/v1/token") return json({ access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600,
    token_type: "bearer", user: { id: customer.userId, email: "local@example.test" } });
  if (url.pathname === "/rest/v1/organisations") {
    return json((await local.db.query("select * from organisations where id=$1", [url.searchParams.get("id")!.slice(3)])).rows);
  }
  if (url.pathname === "/rest/v1/projects") {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      const { rows } = await local.db.query("insert into projects(organisation_id,name,location) values ($1,$2,$3) returning *", [body.organisation_id, body.name, body.location]);
      return json(rows[0], 201);
    }
    return json((await local.db.query("select * from projects where organisation_id=$1", [url.searchParams.get("organisation_id")!.slice(3)])).rows);
  }
  throw new Error(`Unexpected test transport path: ${url.pathname}`);
};

describe("clean local migration chain and organisation integration", () => {
  beforeAll(async () => {
    local = await createCleanLocalDatabase();
    customer = await seedLocalOrganisation(local.db, "Local customer");
    other = await seedLocalOrganisation(local.db, "Other customer");
    await local.db.query("insert into projects(organisation_id,name) values ($1,'Private other project')", [other.organisationId]);
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)", [customer.userId]);
    await local.db.exec("set role authenticated");
  }, 30000);
  afterAll(async () => { await local?.db.close(); });

  it("applies every migration, including the original compliance schema and pgvector", async () => {
    expect(local.migrations).toContain("20260908000000_production_domain.sql");
    expect(local.migrations).toContain("20260903000000_compliance_schema.sql");
    const { rows } = await local.db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public'");
    expect(rows.map(row => row.tablename)).toEqual(expect.arrayContaining(["legal_paragraphs", "compliance_form_freezes", "compliance_corrections", "organisations", "projects", "assessments"]));
  });
  it("resolves the seeded customer and creates scoped projects through application context", async () => {
    const app = await resolveProductionApplication({ organisationId: customer.organisationId, url: "http://127.0.0.1:54321", publishableKey: "sb_publishable_test", email: "local@example.test", password: "test" }, fetcher);
    expect(app.organisation).toEqual({ id: customer.organisationId, name: "Local customer" });
    const project = await app.store.createProject({ name: "Our site", location: "Oslo", organisation_id: other.organisationId } as CreateProject);
    expect(project.organisation_id).toBe(customer.organisationId);
    expect((await app.store.listProjects()).map(row => row.name)).toEqual(["Our site"]);
    expect((await local.db.query("select * from projects where organisation_id=$1", [other.organisationId])).rows).toEqual([]);
  });
  it("refuses to resolve a non-member customer even when configured with its real ID", async () => {
    await expect(resolveProductionApplication({ organisationId: other.organisationId, url: "http://127.0.0.1:54321", publishableKey: "sb_publishable_test", email: "local@example.test", password: "test" }, fetcher)).rejects.toThrow(/missing or inaccessible/);
  });
});
