import crypto from "crypto";

// Gemini via Vertex AI, authenticated with a Google Cloud service account.
// The service-account JWT is signed with node:crypto rather than pulling in
// google-auth-library — no extra dependency for one token exchange.

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function parseServiceAccount(): ServiceAccount {
  const raw = process.env.GEMINI_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GEMINI_SERVICE_ACCOUNT_JSON not set");
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
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

// Signed-key path. Kept as a fallback so a deployment that still carries
// GEMINI_SERVICE_ACCOUNT_JSON keeps working while federation is rolled out.
async function mintKeyToken(sa: ServiceAccount): Promise<Minted> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildJWT(sa),
    }),
  });
  if (!res.ok) throw new Error(`Gemini auth failed: ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  return { token: access_token as string, expiresIn: Number(expires_in) || 3600 };
}

// ─── Workload Identity Federation ────────────────────────────────────────────
// The preferred path: no private key anywhere. Vercel mints a short-lived OIDC
// token per invocation (VERCEL_OIDC_TOKEN); Google's STS exchanges it for a
// federated token, which then impersonates the service account. Two hops, no
// stored secret — which is what `iam.disableServiceAccountKeyCreation`, enforced
// across this GCP organisation, exists to require. The provider itself pins the
// Vercel team, project and environment, so a preview deployment cannot obtain a
// production token even though both present the same issuer.
const wifProvider = () => process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
const wifServiceAccount = () => process.env.GCP_SERVICE_ACCOUNT_EMAIL;

// Reading process.env.VERCEL_OIDC_TOKEN is NOT enough. That variable is
// populated for builds and for `vercel env pull`, but at request time the token
// is per-invocation and lives in the request context, not the environment —
// so the env read returns undefined in production and the exchange never starts.
// getVercelOidcToken() reads whichever of the two is actually present.
async function readOidcToken(): Promise<string | undefined> {
  if (process.env.VERCEL_OIDC_TOKEN) return process.env.VERCEL_OIDC_TOKEN;
  const { getVercelOidcToken } = await import("@vercel/oidc");
  return await getVercelOidcToken();
}

async function mintFederatedToken(): Promise<Minted> {
  const provider = wifProvider();
  const saEmail = wifServiceAccount();
  if (!provider || !saEmail) {
    throw new Error(
      "Vertex AI is not configured: set GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_SERVICE_ACCOUNT_EMAIL, or GEMINI_SERVICE_ACCOUNT_JSON.",
    );
  }
  // Throws its own descriptive error when OIDC is off or unavailable (local dev).
  const oidcToken = await readOidcToken().catch((e) => {
    throw new Error(
      `No Vercel OIDC token — enable OIDC on the project, or set GEMINI_SERVICE_ACCOUNT_JSON for local use. (${e instanceof Error ? e.message : e})`,
    );
  });
  if (!oidcToken) {
    throw new Error(
      "No Vercel OIDC token — enable OIDC on the project, or set GEMINI_SERVICE_ACCOUNT_JSON for local use.",
    );
  }

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
  if (!stsRes.ok) {
    throw new Error(`Vertex AI federation failed at STS: ${(await stsRes.text()).slice(0, 300)}`);
  }
  const { access_token: federated } = await stsRes.json();

  const impRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${federated}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"] }),
    },
  );
  if (!impRes.ok) {
    throw new Error(
      `Vertex AI federation failed impersonating ${saEmail}: ${(await impRes.text()).slice(0, 300)}`,
    );
  }
  const { accessToken, expireTime } = await impRes.json();
  // generateAccessToken returns an absolute expiry, not a duration.
  const ttl = expireTime
    ? Math.max(60, Math.floor((Date.parse(expireTime) - Date.now()) / 1000))
    : 3600;
  return { token: accessToken as string, expiresIn: ttl };
}

interface Minted {
  token: string;
  expiresIn: number;
}

// Cache the access token for its lifetime (~1h) so a burst of calls costs one
// exchange. Per instance; serverless gives each its own.
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount | null): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const minted = sa ? await mintKeyToken(sa) : await mintFederatedToken();
  cachedToken = { token: minted.token, exp: Date.now() + minted.expiresIn * 1000 };
  return minted.token;
}

// With federation there is no key to read the project out of, so it comes from
// GEMINI_PROJECT_ID or, failing that, the service account's own email.
function resolveProjectId(sa: ServiceAccount | null): string {
  const explicit = process.env.GEMINI_PROJECT_ID;
  if (explicit) return explicit;
  if (sa) return sa.project_id;
  const fromEmail = (wifServiceAccount() ?? "").match(/@([^.@]+)\.iam\.gserviceaccount\.com$/)?.[1];
  if (fromEmail) return fromEmail;
  throw new Error("Cannot resolve the Vertex AI project — set GEMINI_PROJECT_ID.");
}

export function isGeminiConfigured(): boolean {
  // Three transports, in the order resolveGeminiEndpoint tries them: an AI
  // Studio API key, a Vertex service-account key, or Vertex via federation.
  return (
    !!process.env.GEMINI_API_KEY ||
    !!process.env.GEMINI_SERVICE_ACCOUNT_JSON ||
    !!(process.env.GCP_WORKLOAD_IDENTITY_PROVIDER && process.env.GCP_SERVICE_ACCOUNT_EMAIL)
  );
}

export interface GeminiTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any;
}

export interface GeminiResult {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiOptions {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  tools?: GeminiTool[];
  // Gemini 2.5 models "think" by default, consuming the output-token budget and
  // truncating the answer (finishReason MAX_TOKENS → malformed JSON). Set to 0
  // to disable thinking (reliable output), or a small number to cap it.
  thinkingBudget?: number;
}

// Resolve the model endpoint URL + auth headers for whichever transport is
// configured (AI Studio API key, or Vertex AI service account).
async function resolveGeminiEndpoint(): Promise<{ url: string; headers: Record<string, string> }> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers,
    };
  }
  // Key if one is present, federation otherwise.
  const sa = process.env.GEMINI_SERVICE_ACCOUNT_JSON ? parseServiceAccount() : null;
  const token = await getAccessToken(sa);
  const project = resolveProjectId(sa);
  const location = process.env.GEMINI_LOCATION || "us-central1";
  headers.Authorization = `Bearer ${token}`;
  return {
    url: `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers,
  };
}

// Single POST to the model with one retry on transient errors (429 rate-limit /
// 5xx). Throws a descriptive Error on final failure so callers can decide how to
// surface it (e.g. fall back to Groq, or show a friendly message).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callGeminiRaw(body: any): Promise<any> {
  const { url, headers } = await resolveGeminiEndpoint();
  // Per-minute rate limits (429) are common when the chat fires several calls in
  // a burst (tool loop) alongside the insights call. Back off and retry a couple
  // of times — this smooths transient bursts without blowing the 60s budget.
  // Sustained quota exhaustion will still surface (caller handles it gracefully).
  const backoffs = [1500, 4000];
  let lastErr = "Gemini request failed";
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const retryable = res.status === 429 || res.status === 500 || res.status === 503;
    if (retryable && attempt < backoffs.length) {
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
      continue;
    }
    break;
  }
  throw new Error(lastErr);
}

export async function geminiGenerate(opts: GeminiOptions): Promise<GeminiResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.maxTokens ?? 2048,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      ...(opts.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
        : {}),
    },
  };
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
  }

  const data = await callGeminiRaw(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const fnPart = parts.find((p) => p.functionCall);
  if (fnPart) {
    return {
      functionCall: { name: fnPart.functionCall.name, args: fnPart.functionCall.args ?? {} },
    };
  }
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return { text };
}

// REST generativelanguage only accepts roles "user" and "model"; function
// results are sent back inside a "user" turn carrying a functionResponse part.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeminiContent = { role: "user" | "model"; parts: any[] };

// Multi-turn variant for tool-calling loops: caller manages the `contents`
// array (appending the model's functionCall and the functionResponse between
// turns) and inspects the returned parts to decide whether to keep looping.
export async function geminiConverse(opts: {
  system: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<{ parts: any[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.maxTokens ?? 2048,
      ...(opts.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
        : {}),
    },
  };
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
  }

  const data = await callGeminiRaw(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  return { parts };
}
