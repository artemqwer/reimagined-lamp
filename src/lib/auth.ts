import { isPlatformAdmin } from "@/lib/authz";
import { createClient } from "./supabase";
import { firstConnectedConnector, connectorSlug } from "./connectors";

/**
 * Where to send a user after they authenticate.
 *
 * No connected data source yet → the Data Sources page, so a new account is
 * asked to connect a platform instead of landing on an empty Google Ads
 * dashboard. Otherwise → the dashboard of their FIRST connected source (registry
 * / admin order). Google Ads is never opened just because it's the default.
 */
export async function landingRoute(): Promise<string> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  const first = firstConnectedConnector(user);
  return first ? `/${connectorSlug(first)}` : "/data-sources";
}

export type Session = {
  email: string;
  name: string;
  avatar?: string;
  teamId?: string | null;
  isAdmin?: boolean;
};

export async function registerUser(
  email: string,
  name: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  // Route registration through our server so the browser only fetches the
  // same Vercel origin. Bypasses client-side blockers (adblock, firewalls,
  // regional restrictions) that may prevent direct supabase.co reach.
  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: json.error ?? "Registration failed" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ success: boolean; session?: Session; error?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("email not confirmed")) {
      return {
        success: false,
        error: "Please confirm your email first — check your inbox for a confirmation link",
      };
    }
    if (msg.includes("invalid") || msg.includes("credentials")) {
      return { success: false, error: "Incorrect email or password" };
    }
    return { success: false, error: error.message };
  }
  const name = data.user?.user_metadata?.full_name ?? email.split("@")[0];
  return { success: true, session: { email: data.user.email!, name } };
}

export async function loginWithGoogle(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export async function sendPasswordResetEmail(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback`,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function verifyPasswordResetOtp(
  email: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function logoutUser(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

// ─── Two-Factor Authentication (TOTP via Supabase MFA) ───────────────────────

// Verified TOTP factors the user has enrolled (one enables 2FA).
export async function listVerifiedTotp(): Promise<{ id: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  return (data.totp ?? []).filter((f) => f.status === "verified").map((f) => ({ id: f.id }));
}

// Start enrolling a new TOTP factor — returns a QR code + secret to scan.
export async function startMfaEnroll(): Promise<
  { factorId: string; qr: string; secret: string; uri: string } | { error: string }
> {
  const supabase = createClient();
  // Clean up any leftover unverified factor first (re-enrolling otherwise errors).
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified")
      await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) return { error: error?.message ?? "Failed to start 2FA setup" };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

// Verify a 6-digit code to either confirm enrollment or satisfy a login challenge.
export async function verifyMfaCode(
  factorId: string,
  code: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = createClient();
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr || !ch) return { error: chErr?.message ?? "Could not start verification" };
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.id,
    code: code.trim(),
  });
  if (error)
    return { error: /invalid/i.test(error.message) ? "Invalid code — try again" : error.message };
  return { ok: true };
}

export async function disableMfa(factorId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: error.message };
  return { ok: true };
}

// After password login: does the user still need to pass an MFA challenge?
// Returns the TOTP factorId to challenge, or null if no 2FA step is needed.
export async function pendingMfaFactor(): Promise<string | null> {
  const supabase = createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel === aal.nextLevel || aal.nextLevel !== "aal2") return null;
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factor = (list?.totp ?? []).find((f) => f.status === "verified");
  return factor?.id ?? null;
}

export async function getSupabaseSession(): Promise<Session | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return null;
  const user = data.session.user;
  const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
  const avatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture;
  const teamId = (user.user_metadata?.team_id as string | undefined) ?? null;
  const isAdmin = isPlatformAdmin(user);
  return { email: user.email!, name, avatar, teamId, isAdmin };
}
