import { createFinalizationStore } from "./finalization-store";
import { createBkDraftStore } from "./bk-draft-store";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createProcessingStore } from "./processing-store";
import { createProductionStore } from "./store";
import type { ProductionDatabase } from "./types";

export class OrganisationContextError extends Error {
  constructor(readonly status: "unconfigured" | "unavailable", message: string) {
    super(message);
  }
}

export type ApplicationConfig = {
  organisationId: string;
  url: string;
  publishableKey: string;
  email: string;
  password: string;
};

/** The only configuration-to-organisation mapping. No fallback UUID, first-row selection,
 * request body, query parameter or browser storage participates in tenant resolution. */
export function readApplicationConfig(env: Record<string, string | undefined>): ApplicationConfig {
  const keys = ["PRODUCTION_ORGANISATION_ID", "PRODUCTION_SUPABASE_URL",
    "PRODUCTION_SUPABASE_PUBLISHABLE_KEY", "PRODUCTION_APP_EMAIL", "PRODUCTION_APP_PASSWORD"] as const;
  if (keys.every(key => !env[key])) {
    throw new OrganisationContextError("unconfigured", "Production organisation is not configured");
  }
  if (keys.some(key => !env[key]?.trim())) {
    throw new OrganisationContextError("unavailable", "Production organisation configuration is incomplete");
  }
  const organisationId = env.PRODUCTION_ORGANISATION_ID!.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organisationId)) {
    throw new OrganisationContextError("unavailable", "Production organisation ID must be a UUID");
  }
  let url: URL;
  try { url = new URL(env.PRODUCTION_SUPABASE_URL!); }
  catch { throw new OrganisationContextError("unavailable", "Invalid production database URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new OrganisationContextError("unavailable", "Production database URL must be HTTPS or local HTTP");
  }
  const publishableKey = env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY!.trim();
  // Accept a publishable key or the legacy anon JWT, never a service-role/secret key.
  if (!publishableKey.startsWith("sb_publishable_")) {
    let role: unknown;
    try { role = JSON.parse(Buffer.from(publishableKey.split(".")[1], "base64url").toString()).role; }
    catch { /* rejected below */ }
    if (role !== "anon") throw new OrganisationContextError("unavailable", "Use a publishable or anon key for production application access");
  }
  return { organisationId, url: url.origin, publishableKey,
    email: env.PRODUCTION_APP_EMAIL!.trim(), password: env.PRODUCTION_APP_PASSWORD! };
}

/** Infrastructure resolver, called only by server.ts after portal authentication. The
 * shared application identity is an ordinary Supabase auth user, constrained by RLS, not
 * a service role. It represents this portal installation, not an individually audited user. */
export async function resolveProductionApplication(config: ApplicationConfig, fetcher: typeof fetch = fetch) {
  const client = createClient<ProductionDatabase>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetcher(input, {
      ...init, cache: "no-store", redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    }) },
  });
  const { error } = await client.auth.signInWithPassword({ email: config.email, password: config.password });
  if (error) throw new OrganisationContextError("unavailable", "Production application sign-in failed");
  const store = createProductionStore(client, config.organisationId);
  const organisation = await store.getOrganisation();
  if (!organisation || organisation.id !== config.organisationId) {
    throw new OrganisationContextError("unavailable", "Configured organisation is missing or inaccessible");
  }
  return { organisation: { id: organisation.id, name: organisation.name }, store, finalizations: createFinalizationStore(client, organisation.id), drafts: createBkDraftStore(client, organisation.id), processing: createProcessingStore(client, organisation.id) };
}
