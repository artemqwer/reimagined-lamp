import type { User } from "@supabase/supabase-js";

// Who a caller is allowed to be, and which of their stored credentials the
// server will act on.
//
// Everything here reads `app_metadata`, never `user_metadata`. That is the whole
// point of the module. Supabase lets any signed-in user rewrite their own
// `user_metadata` with a single client call:
//
//     supabase.auth.updateUser({ data: { is_admin: true } })
//
// so a privilege flag kept there is self-service. `app_metadata` is writable
// only through the service role, which never leaves the server. The Windsor
// binding code has always known this — see the "app_metadata (which the user
// CANNOT edit client-side)" note in api/windsor-connect — these helpers hold
// the rest of the app to the same rule.
//
// Reading is a different question from writing: `app_metadata` still travels in
// the user's own JWT, so a value here is tamper-proof but not secret from the
// user it belongs to. That is fine for `is_admin` and for a credential the user
// supplied themselves; it would not be fine for anything belonging to someone
// else.

/** Just the metadata carriers, so route code can pass a Supabase user, an admin
 *  `listUsers()` row, or a plain object from a test without casting. */
export type MetadataCarrier = {
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

export type AnyUser = User | MetadataCarrier;

function appMeta(user: AnyUser | null | undefined): Record<string, unknown> {
  return (user?.app_metadata ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * A platform administrator: someone who may open the Admin Panel and, through
 * the `?user=` parameter the data routes accept, read any tenant's figures.
 *
 * Deliberately strict about `true` rather than truthy — the flag arrives as
 * JSON and `"false"` is a truthy string.
 */
// A plain boolean rather than a type predicate: these checks are mostly written
// as `isPlatformAdmin(user) || <team rule> || …`, and a predicate would narrow
// `user` away in the right-hand branches of those chains.
export function isPlatformAdmin(user: AnyUser | null | undefined): boolean {
  return appMeta(user).is_admin === true;
}

/** The Windsor key to bill this user's requests against, if they have their own.
 *  Callers fall back to `process.env.WINDSOR_API_KEY` (the workspace key). */
export function windsorApiKeyOf(user: AnyUser | null | undefined): string | undefined {
  return str(appMeta(user).windsor_api_key);
}


/** Keys that must never be honoured from `user_metadata`, and so must never be
 *  accepted into it either.
 *
 *  The two google_ads_* entries have no accessor any more — the OAuth route
 *  that set them was deleted with the BigQuery source and no UI reached it, so
 *  nothing reads them. They stay on this list deliberately: it is a deny-list,
 *  and a field that cannot currently be set is exactly the kind that comes back
 *  later without the guard being re-added. Exported for the admin user-patch route, which
 *  writes the rest of the profile fields to `user_metadata` as before. */
export const PRIVILEGED_METADATA_KEYS = [
  "is_admin",
  "windsor_api_key",
  "google_ads_refresh_token",
  "google_ads_customer_id",
] as const;
