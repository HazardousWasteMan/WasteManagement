import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCleanLocalDatabase, seedLocalOrganisation } from "./local-database";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "waste-production-local-"));
  const { db, migrations } = await createCleanLocalDatabase(join(directory, "pgdata"));
  try {
    const { organisationId, userId } = await seedLocalOrganisation(db, "Local development customer");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
    const result = await db.query("select id,name from public.organisations where id=$1", [organisationId]);
    if (result.rows.length !== 1) throw new Error("Local membership resolution failed");
    console.log(`Applied all ${migrations.length} migrations to a clean local PostgreSQL database: ${directory}`);
    console.log("Local organisation seed and membership-scoped read passed. No remote database contacted.");
    console.log("This harness simulates Supabase Auth; it does not replace a running local Supabase/PostgREST stack.");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
