import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

export function assertLocalSupabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Bootstrap accepts only a localhost HTTP Supabase URL");
  }
  return url.origin;
}

/** The service key is used ONLY to provision a local organisation and ordinary app user.
 * It is never written to application configuration. No migrations or remote endpoints. */
export async function bootstrapLocalOrganisation(input: {
  url: string; publishableKey: string; serviceKey: string; name: string;
}, fetcher: typeof fetch = fetch) {
  const url = assertLocalSupabaseUrl(input.url);
  if (!input.name.trim()) throw new Error("An organisation name is required");
  const admin = createClient(url, input.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (request, init) => fetcher(request, {
      ...init, redirect: "error", signal: AbortSignal.timeout(5000),
    }) },
  });
  const organisationId = randomUUID();
  const email = `portal-${organisationId}@example.test`;
  const password = randomBytes(32).toString("hex");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Local application user provisioning failed");
  const userId = created.data.user.id;
  let organisationCreated = false;
  try {
    const organisation = await admin.from("organisations").insert({ id: organisationId, name: input.name.trim() });
    if (organisation.error) throw new Error("Local organisation provisioning failed; apply local migrations first");
    organisationCreated = true;
    const membership = await admin.from("organisation_members").insert({ organisation_id: organisationId, user_id: userId });
    if (membership.error) throw new Error("Local organisation membership provisioning failed");
    const backendIdentity = await admin.from("production_backend_identities").insert({ user_id: userId });
    if (backendIdentity.error) throw new Error("Local backend identity provisioning failed");
  } catch (error) {
    // Only compensate records just created by this invocation, never existing customer data.
    const cleanupErrors = [];
    if (organisationCreated) {
      cleanupErrors.push((await admin.from("production_backend_identities").delete().eq("user_id", userId)).error);
      cleanupErrors.push((await admin.from("organisation_members").delete().eq("organisation_id", organisationId)).error);
      cleanupErrors.push((await admin.from("organisations").delete().eq("id", organisationId)).error);
    }
    cleanupErrors.push((await admin.auth.admin.deleteUser(userId)).error);
    if (cleanupErrors.some(Boolean)) throw new Error(`Local bootstrap failed; inspect newly created organisation ${organisationId} and user ${userId}`);
    throw error;
  }
  return {
    PRODUCTION_ORGANISATION_ID: organisationId,
    PRODUCTION_SUPABASE_URL: url,
    PRODUCTION_SUPABASE_PUBLISHABLE_KEY: input.publishableKey,
    PRODUCTION_APP_EMAIL: email,
    PRODUCTION_APP_PASSWORD: password,
  };
}
