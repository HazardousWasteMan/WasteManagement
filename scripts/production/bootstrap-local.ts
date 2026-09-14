import { execFileSync } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrapLocalOrganisation, assertLocalSupabaseUrl } from "./local-bootstrap";

async function main() {
  const name = process.argv.slice(2).filter(arg => arg !== "--").join(" ").trim();
  if (!name) throw new Error('Usage: pnpm production:bootstrap-local "Customer name"');
  // status is LOCAL only; no --linked, db push, project link or remote env fallback.
  const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], { stdio: ["ignore", "pipe", "pipe"] }).toString());
  const url = assertLocalSupabaseUrl(status.API_URL);
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY;
  if (!publishableKey || !serviceKey) throw new Error("Local Supabase status did not provide the required keys");

  // Reserve before provisioning. Never overwrite an existing local environment file.
  const filename = resolve(".env.development.local");
  const file = await open(filename, "wx", 0o600);
  try {
    const config = await bootstrapLocalOrganisation({ url, publishableKey, serviceKey, name });
    await file.writeFile(Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
    console.log("Created the local organisation and app identity; configuration saved to .env.development.local (mode 0600). Restart pnpm dev.");
  } catch (error) {
    await unlink(filename); // only the empty file reserved by this invocation
    throw error;
  } finally {
    await file.close();
  }
}
main().catch(error => {
  // execFile errors can contain CLI output with keys; never print that output.
  const message = error instanceof Error && !Object.hasOwn(error, "stderr") ? error.message : "Local Supabase is not available. Start Docker and run supabase start first.";
  console.error(message);
  process.exitCode = 1;
});
