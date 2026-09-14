import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Assessment } from "@/lib/production/types";

const ids = {
  org: "10000000-0000-0000-0000-000000000001",
  otherOrg: "10000000-0000-0000-0000-000000000002",
  user: "20000000-0000-0000-0000-000000000001",
  otherUser: "20000000-0000-0000-0000-000000000002",
  project: "30000000-0000-0000-0000-000000000001",
  otherProject: "30000000-0000-0000-0000-000000000002",
  sameOrgProject: "30000000-0000-0000-0000-000000000003",
  stream: "40000000-0000-0000-0000-000000000001",
  otherStream: "40000000-0000-0000-0000-000000000002",
  document: "50000000-0000-0000-0000-000000000001",
  otherDocument: "50000000-0000-0000-0000-000000000002",
  sameOrgDocument: "50000000-0000-0000-0000-000000000003",
};
let db: PGlite;

async function asUser(user = ids.user) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("set role authenticated");
}
async function assess(options: {
  id?: string; organisation?: string; project?: string; stream?: string;
  eal?: string | null; hazard?: boolean | null; documents?: unknown;
} = {}) {
  const { rows } = await db.query<Assessment>(`select * from public.production_create_assessment(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, '2026-09-08T12:00:00Z', $5::text, $6::boolean,
    $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)`, [
    options.organisation ?? ids.org, options.project ?? ids.project,
    options.stream ?? ids.stream, options.id ?? crypto.randomUUID(),
    options.eal === undefined ? "17 01 01" : options.eal,
    options.hazard === undefined ? false : options.hazard,
    JSON.stringify({ engineVersion: "fixture-v1", rawValue: "<0.1", loq: 0.1 }),
    JSON.stringify(options.documents === undefined ? [{ source_document_id: ids.document,
      segment_key: "sample-a", first_page: 0, last_page: 2 }] : options.documents),
    JSON.stringify({ templateVersion: "fixture-v1" }),
    JSON.stringify([{ fieldKey: "fixture", sourceText: "historical evidence" }]),
  ]);
  return rows[0];
}

// These tests execute the actual migration in PostgreSQL (PGlite), not a reimplementation
// of its constraints. Only Supabase's auth/roles are supplied by the local harness.
describe("production domain migration", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      -- Model Supabase's default grants; the migration must narrow them explicitly.
      alter default privileges in schema public grant all on tables to authenticated, anon;
    `);
    await db.exec(readFileSync(resolve("supabase/migrations/20260908000000_production_domain.sql"), "utf8"));
    await db.query("insert into auth.users values ($1), ($2)", [ids.user, ids.otherUser]);
    await db.query("insert into organisations(id,name) values ($1,'Customer A'), ($2,'Customer B')", [ids.org, ids.otherOrg]);
    await db.query("insert into organisation_members values ($1,$2), ($3,$4)", [ids.org, ids.user, ids.otherOrg, ids.otherUser]);
    await db.query(`insert into projects(id,organisation_id,name) values
      ($1,$2,'Site A'), ($3,$4,'Site B'), ($5,$2,'Another site A')`,
    [ids.project, ids.org, ids.otherProject, ids.otherOrg, ids.sameOrgProject]);
    await db.query(`insert into waste_streams(id,organisation_id,project_id,name) values
      ($1,$2,$3,'Concrete'), ($4,$5,$6,'Other customer soil')`,
    [ids.stream, ids.org, ids.project, ids.otherStream, ids.otherOrg, ids.otherProject]);
    for (const [id, organisation, project] of [
      [ids.document, ids.org, ids.project], [ids.otherDocument, ids.otherOrg, ids.otherProject],
      [ids.sameOrgDocument, ids.org, ids.sameOrgProject],
    ]) {
      await db.query(`insert into source_documents(id,organisation_id,project_id,filename,storage_key,sha256)
        values ($1,$2,$3,'report.pdf',$4,$5)`, [id, organisation, project, `${organisation}/${project}/${id}.pdf`, "a".repeat(64)]);
    }
  }, 30000);
  beforeEach(async () => { await db.exec("begin"); await asUser(); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });

  it("allows several waste streams and documents within a long-lived project", async () => {
    await db.query("insert into waste_streams(organisation_id,project_id,name) values ($1,$2,'Soil')", [ids.org, ids.project]);
    expect((await db.query("select * from waste_streams where project_id=$1", [ids.project])).rows).toHaveLength(2);
    await db.query(`insert into source_documents(organisation_id,project_id,filename,storage_key,sha256)
      values ($1,$2,'later.pdf',$3,$4)`, [ids.org, ids.project, `${ids.org}/${ids.project}/later.pdf`, "b".repeat(64)]);
    expect((await db.query("select * from source_documents where project_id=$1", [ids.project])).rows).toHaveLength(2);
  });

  it("appends different EAL decisions to one stream without mutating historical evidence", async () => {
    const first = await assess();
    const second = await assess({ eal: "17 01 06*", hazard: true });
    expect(second.version).toBe(2);
    expect(second.previous_assessment_id).toBe(first.id);
    expect(second.eal_code).not.toBe(first.eal_code);
    const { rows } = await db.query<Assessment>("select * from assessments order by version");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(first);
    expect(rows[0].compliance_evidence).toEqual([{ fieldKey: "fixture", sourceText: "historical evidence" }]);
  });

  it("preserves null hazard and EAL as real indeterminate values", async () => {
    const result = await assess({ eal: null, hazard: null, documents: [] });
    expect(result.is_hazardous).toBeNull();
    expect(result.eal_code).toBeNull();
    expect(result.version).toBe(1);
    expect(result.previous_assessment_id).toBeNull();
    expect(result.created_by).toBe(ids.user);
  });

  it("supports one PDF across multiple streams/assessments with independent segments", async () => {
    const stream = crypto.randomUUID();
    await db.query("insert into waste_streams(id,organisation_id,project_id,name) values ($1,$2,$3,'Soil')", [stream, ids.org, ids.project]);
    await assess();
    const second = await assess({ stream, documents: [{ source_document_id: ids.document, segment_key: "sample-b", first_page: 3, last_page: 4 }] });
    expect(second.version).toBe(1);
    expect((await db.query("select * from assessment_source_documents where source_document_id=$1", [ids.document])).rows).toHaveLength(2);
  });

  it("rolls back assessment creation if a document belongs to another customer", async () => {
    await db.exec("savepoint invalid_document");
    await expect(assess({ documents: [{ source_document_id: ids.otherDocument }] })).rejects.toThrow(/foreign key/);
    await db.exec("rollback to savepoint invalid_document");
    expect((await db.query("select * from assessments")).rows).toHaveLength(0);
    expect((await assess()).version).toBe(1);
  });

  it("rejects document links to another project even within the same organisation", async () => {
    await expect(assess({ documents: [{ source_document_id: ids.sameOrgDocument }] })).rejects.toThrow(/foreign key/);
  });

  it("rejects cross-organisation parents even when the user is a member of both", async () => {
    await db.exec("reset role");
    await db.query("insert into organisation_members values ($1,$2)", [ids.otherOrg, ids.user]);
    await asUser();
    await expect(db.query("insert into waste_streams(organisation_id,project_id,name) values ($1,$2,'Forged')",
      [ids.org, ids.otherProject])).rejects.toThrow(/foreign key/);
  });

  it("rejects a stream from another project/customer in assessment creation", async () => {
    await expect(assess({ stream: ids.otherStream })).rejects.toThrow(/Waste stream not found/);
  });

  it("scopes all reads to membership and rejects forged organisation RPC arguments", async () => {
    await assess();
    expect((await db.query("select * from organisations")).rows).toHaveLength(1);
    expect((await db.query("select * from projects")).rows).toHaveLength(2);
    await asUser(ids.otherUser);
    expect((await db.query("select * from assessments")).rows).toHaveLength(0);
    expect((await db.query("select * from assessment_source_documents")).rows).toHaveLength(0);
    expect((await db.query("select * from waste_streams")).rows).toHaveLength(1);
    expect((await db.query("select * from source_documents")).rows).toHaveLength(1);
    await expect(assess()).rejects.toThrow(/Organisation access denied/);
  });

  it("denies project creation under a non-member organisation", async () => {
    await expect(db.query("insert into projects(organisation_id,name) values ($1,'Forged')", [ids.otherOrg])).rejects.toThrow(/row-level security/);
  });

  it("prevents users from granting themselves membership", async () => {
    await expect(db.query("insert into organisation_members values ($1,$2)", [ids.otherOrg, ids.user])).rejects.toThrow(/permission denied/);
  });

  it.each(["assessments", "assessment_source_documents", "source_documents"])(
    "blocks updates and deletes of historical %s even for privileged table access", async table => {
      await assess();
      await db.exec("reset role; savepoint immutable");
      await expect(db.exec(`update ${table} set organisation_id = organisation_id`)).rejects.toThrow(/append-only/);
      await db.exec("rollback to savepoint immutable");
      await expect(db.exec(`delete from ${table}`)).rejects.toThrow(/append-only/);
    });

  it("prevents appending evidence to an existing assessment outside its creation transaction", async () => {
    const assessment = await assess();
    await expect(db.query(`insert into assessment_source_documents
      (organisation_id,project_id,assessment_id,source_document_id,segment_key) values ($1,$2,$3,$4,'later')`,
    [ids.org, ids.project, assessment.id, ids.document])).rejects.toThrow(/permission denied/);
  });

  it("rejects duplicate assessment IDs without creating another version", async () => {
    const first = await assess();
    await db.exec("savepoint duplicate");
    await expect(assess({ id: first.id })).rejects.toThrow(/duplicate key/);
    await db.exec("rollback to savepoint duplicate");
    expect((await db.query("select * from assessments")).rows).toHaveLength(1);
    expect((await assess()).version).toBe(2);
  });

  it.each([
    { first_page: -1, last_page: 2 },
    { first_page: 4, last_page: 2 },
    { first_page: 0, last_page: null },
  ])("rejects invalid page ranges %j", async range => {
    await expect(assess({ documents: [{ source_document_id: ids.document, ...range }] })).rejects.toThrow(/check constraint/);
  });

  it("denies anonymous reads and assessment RPC execution", async () => {
    await db.exec("reset role; set role anon; savepoint anonymous_read");
    await expect(db.exec("select * from projects")).rejects.toThrow(/permission denied/);
    await db.exec("rollback to savepoint anonymous_read");
    await expect(assess()).rejects.toThrow(/permission denied/);
  });
});
