import { adminClient } from "@/lib/supabase-admin";

// Global "is public sign-up allowed" flag, toggled from the Admin panel.
//
// Stored as a reserved row in the existing `connector_config` table (whose PK is
// `connector`), so it needs no new migration. The connector-config API filters
// this pseudo-connector out via isConnectorId, so it never surfaces as a real
// connector. Default is OPEN — a missing row (or no service-role key) means
// registration is allowed, so nothing locks users out by accident.
const REG_ROW = "_registration";

export async function isRegistrationEnabled(): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  const { data } = await adminClient()
    .from("connector_config")
    .select("config")
    .eq("connector", REG_ROW)
    .maybeSingle();
  const cfg = data?.config as { enabled?: boolean } | null | undefined;
  return cfg?.enabled !== false;
}

export async function setRegistrationEnabled(enabled: boolean): Promise<void> {
  await adminClient()
    .from("connector_config")
    .upsert(
      { connector: REG_ROW, config: { enabled }, updated_at: new Date().toISOString() },
      { onConflict: "connector" },
    );
}
