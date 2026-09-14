import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Clean, offline PostgreSQL harness. It has no network client or remote database option.
 * Supabase Auth roles/uid are simulated; all application migrations are executed unchanged. */
export async function createCleanLocalDatabase(dataDir?: string) {
  const db = new PGlite({ dataDir, extensions: { vector } });
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
    `);
    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
    await db.transaction(async tx => {
      for (const migration of migrations) await tx.exec(await readFile(resolve(directory, migration), "utf8"));
    });
    return { db, migrations };
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function seedLocalOrganisation(db: PGlite, name: string) {
  if (!name.trim()) throw new Error("Organisation name is required");
  const organisationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.transaction(async tx => {
    await tx.query("insert into auth.users(id) values ($1)", [userId]);
    await tx.query("insert into public.organisations(id,name) values ($1,$2)", [organisationId, name]);
    await tx.query("insert into public.organisation_members(organisation_id,user_id) values ($1,$2)", [organisationId, userId]);
    await tx.query("insert into public.production_backend_identities(user_id) values ($1)", [userId]);
  });
  return { organisationId, userId };
}
