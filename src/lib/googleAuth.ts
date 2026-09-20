import crypto from "crypto";

// Google Cloud access tokens for BigQuery — two transports, no new dependency.
//
// 1) SERVICE-ACCOUNT KEY (BQ_SERVICE_ACCOUNT_JSON): sign a JWT with node:crypto
//    and exchange it for an access token. This is what is actually wired in
//    Vercel today (BQ_SERVICE_ACCOUNT_JSON is set), and mirrors gemini.ts.
// 2) WORKLOAD IDENTITY FEDERATION (GCP_WORKLOAD_IDENTITY_PROVIDER +
//    GCP_SERVICE_ACCOUNT_EMAIL): no stored key — Vercel OIDC → Google STS →
//    impersonate the SA. Preferred once federation is rolled out, since the org
//    enforces `iam.disableServiceAccountKeyCreation` (see docs/bigquery-disabled.md).
//
// Key path is tried first when the JSON is present (matches current prod), else
// federation. The `cloud-platform` scope covers BigQuery, so the SA just needs
// roles/bigquery.dataEditor + roles/bigquery.jobUser.
//
// Kept SEPARATE from gemini.ts so BigQuery work cannot destabilise the AI path.

interface Minted {
  token: string;
  expiresIn: number;
}
interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

// ─── Service-account key path ────────────────────────────────────────────────
function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.BQ_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    } catch {
      return null;
    }
  }
}

function buildJWT(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(sa.private_key, "base64url");
  return `${header}.${payload}.${sig}`;
}

async function mintKeyToken(sa: ServiceAccount): Promise<Minted> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildJWT(sa),
    }),
  });
  if (!res.ok) throw new Error(`BigQuery auth (key) failed: ${(await res.text()).slice(0, 300)}`);
  const { access_token, expires_in } = await res.json();
  return { token: access_token as string, expiresIn: Number(expires_in) || 3600 };
}

// ─── Workload Identity Federation path ───────────────────────────────────────
// The WIF provider is SHARED with Gemini (it just trusts Vercel's OIDC issuer).
// The service account is BigQuery-specific so we never touch Gemini's
// GCP_SERVICE_ACCOUNT_EMAIL: both impersonate DIFFERENT service accounts through
// the same provider. Falls back to the shared var only if the BQ one is unset.
const wifProvider = () => process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
const wifServiceAccount = () =>
  process.env.GCP_BIGQUERY_SERVICE_ACCOUNT_EMAIL ?? process.env.GCP_SERVICE_ACCOUNT_EMAIL;

// The OIDC token is per-invocation and lives in the request context, not env —
// so a plain env read returns undefined in production. getVercelOidcToken() reads
// whichever of the two is present (env for build/pull, context at runtime).
async function readOidcToken(): Promise<string | undefined> {
  if (process.env.VERCEL_OIDC_TOKEN) return process.env.VERCEL_OIDC_TOKEN;
  const { getVercelOidcToken } = await import("@vercel/oidc");
  return await getVercelOidcToken();
}

async function mintFederatedToken(): Promise<Minted> {
  const provider = wifProvider();
  const saEmail = wifServiceAccount();
  if (!provider || !saEmail)
    throw new Error(
      "BigQuery auth not configured: set BQ_SERVICE_ACCOUNT_JSON, or GCP_WORKLOAD_IDENTITY_PROVIDER + GCP_SERVICE_ACCOUNT_EMAIL for federation.",
    );
  const oidcToken = await readOidcToken().catch((e) => {
    throw new Error(
      `No Vercel OIDC token — enable OIDC on the project. (${e instanceof Error ? e.message : e})`,
    );
  });
  if (!oidcToken) throw new Error("No Vercel OIDC token — enable OIDC on the project.");

  const stsRes = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${provider}`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken: oidcToken,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  if (!stsRes.ok)
    throw new Error(`BigQuery federation failed at STS: ${(await stsRes.text()).slice(0, 300)}`);
  const { access_token: federated } = await stsRes.json();

  const impRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${federated}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"] }),
    },
  );
  if (!impRes.ok)
    throw new Error(
      `BigQuery federation failed impersonating ${saEmail}: ${(await impRes.text()).slice(0, 300)}`,
    );
  const { accessToken, expireTime } = await impRes.json();
  const ttl = expireTime
    ? Math.max(60, Math.floor((Date.parse(expireTime) - Date.now()) / 1000))
    : 3600;
  return { token: accessToken as string, expiresIn: ttl };
}

// ─── Cached token getter ─────────────────────────────────────────────────────
// ~1h lifetime; per serverless instance, like gemini.ts.
let cachedToken: { token: string; exp: number } | null = null;

/** A short-lived Google Cloud access token (cloud-platform scope) for BigQuery. */
export async function googleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const sa = parseServiceAccount();
  const minted = sa ? await mintKeyToken(sa) : await mintFederatedToken();
  cachedToken = { token: minted.token, exp: Date.now() + minted.expiresIn * 1000 };
  return minted.token;
}

/** True only when BigQuery is explicitly switched ON *and* auth is wired up.
 *
 *  The explicit BQ_ENABLED master switch matters: BQ_PROJECT_ID and
 *  BQ_SERVICE_ACCOUNT_JSON are ALREADY present in the project's env (left from the
 *  old, never-working setup), so keying only on those would silently activate the
 *  BigQuery path the moment this ships — hammering a table that doesn't exist yet
 *  and adding a failed round-trip before every Windsor fall-back. BQ_ENABLED=true
 *  is set by hand only once the dataset/table exist and BQ_TABLE points at them. */
export function isBigQueryConfigured(): boolean {
  if (process.env.BQ_ENABLED !== "true") return false;
  return (
    !!process.env.BQ_PROJECT_ID &&
    (!!process.env.BQ_SERVICE_ACCOUNT_JSON || !!(wifProvider() && wifServiceAccount()))
  );
}
