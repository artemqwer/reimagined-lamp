import {
  isPlatformAdmin,
  windsorApiKeyOf,
  PRIVILEGED_METADATA_KEYS,
} from "@/lib/authz";
import { connectedConnectorsFrom } from "@/lib/connectors";

// The rule these protect: `user_metadata` is writable by the user it describes.
//
//     await supabase.auth.updateUser({ data: { is_admin: true } })
//
// is a legal call for any signed-in account, straight from the browser console.
// While the admin gates read `user_metadata.is_admin`, that one line granted the
// Admin Panel and — through the `view_as` parameter the data routes honour for
// admins — every other tenant's spend and revenue. Nothing the server trusts may
// be read from there.

describe("isPlatformAdmin", () => {
  it("grants on app_metadata", () => {
    expect(isPlatformAdmin({ app_metadata: { is_admin: true } })).toBe(true);
  });

  it("IGNORES user_metadata — the escalation path", () => {
    expect(isPlatformAdmin({ user_metadata: { is_admin: true }, app_metadata: {} })).toBe(false);
  });

  it("is not fooled by a user_metadata flag next to a false app_metadata one", () => {
    expect(
      isPlatformAdmin({ user_metadata: { is_admin: true }, app_metadata: { is_admin: false } }),
    ).toBe(false);
  });

  it("requires the boolean, not a truthy string", () => {
    // The flag round-trips through JSON, and "false" is truthy.
    expect(isPlatformAdmin({ app_metadata: { is_admin: "false" } })).toBe(false);
    expect(isPlatformAdmin({ app_metadata: { is_admin: "true" } })).toBe(false);
  });

  it("says no for absent, null and empty users", () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
    expect(isPlatformAdmin({ app_metadata: null })).toBe(false);
  });
});

describe("stored credentials", () => {
  it("are read from app_metadata", () => {
    const user = { app_metadata: { windsor_api_key: "wk" } };
    expect(windsorApiKeyOf(user)).toBe("wk");
  });

  it("are NOT read from user_metadata", () => {
    const user = { user_metadata: { windsor_api_key: "wk" }, app_metadata: {} };
    expect(windsorApiKeyOf(user)).toBeUndefined();
  });

  it("treats an empty string as absent, so callers fall back to the workspace key", () => {
    expect(windsorApiKeyOf({ app_metadata: { windsor_api_key: "" } })).toBeUndefined();
  });

  it("ignores a non-string value rather than passing it upstream", () => {
    expect(windsorApiKeyOf({ app_metadata: { windsor_api_key: { evil: true } } })).toBeUndefined();
  });
});

// The callers that used to take a bare `user_metadata` bag, now that the two
// credentials they branch on have moved.
describe("callers read the moved fields from the right bag", () => {
  it("connectedConnectorsFrom counts a Google Ads OAuth grant from app_metadata", () => {
    expect(connectedConnectorsFrom({ app_metadata: { google_ads_refresh_token: "rt" } })).toContain(
      "google_ads",
    );
  });
});

describe("PRIVILEGED_METADATA_KEYS", () => {
  it("names every field the server trusts, so the migration can strip them", () => {
    expect([...PRIVILEGED_METADATA_KEYS].sort()).toEqual([
      "google_ads_customer_id",
      "google_ads_refresh_token",
      "is_admin",
      "windsor_api_key",
    ]);
  });
});
