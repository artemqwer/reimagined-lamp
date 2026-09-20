/**
 * Vertex AI authentication — Workload Identity Federation.
 *
 * The GCP organisation enforces `iam.disableServiceAccountKeyCreation`, so the
 * production path must not depend on a downloaded service-account key. These
 * tests pin the two-hop exchange (Vercel OIDC → Google STS → impersonation) and
 * that the signed-key path still works as a fallback.
 */

import { generateKeyPairSync } from "crypto";

// The runtime token comes from the request context, not the environment, so the
// package is the thing under test here — not process.env.
jest.mock("@vercel/oidc", () => ({ getVercelOidcToken: jest.fn(async () => undefined) }));

const ENV = process.env;

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { body: {} };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

const GENERATE_OK = {
  candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
};

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_SERVICE_ACCOUNT_JSON;
  delete process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.GEMINI_PROJECT_ID;
});
afterAll(() => {
  process.env = ENV;
});

const WIF_ENV = {
  GCP_WORKLOAD_IDENTITY_PROVIDER:
    "projects/65246199654/locations/global/workloadIdentityPools/vercel/providers/vercel-oidc",
  GCP_SERVICE_ACCOUNT_EMAIL: "datarocks-gemini@datarocks-prod.iam.gserviceaccount.com",
  VERCEL_OIDC_TOKEN: "vercel.oidc.jwt",
};

describe("isGeminiConfigured", () => {
  it("is true with federation configured and no key present", async () => {
    Object.assign(process.env, WIF_ENV);
    const { isGeminiConfigured } = await import("@/lib/gemini");
    expect(isGeminiConfigured()).toBe(true);
  });

  it("is false when federation is only half-configured", async () => {
    process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = WIF_ENV.GCP_WORKLOAD_IDENTITY_PROVIDER;
    const { isGeminiConfigured } = await import("@/lib/gemini");
    expect(isGeminiConfigured()).toBe(false);
  });
});

describe("federated token exchange", () => {
  it("exchanges the Vercel OIDC token at STS, then impersonates the service account", async () => {
    Object.assign(process.env, WIF_ENV);
    const calls = mockFetchSequence([
      { body: { access_token: "federated-token" } },
      {
        body: {
          accessToken: "sa-token",
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
      { body: GENERATE_OK },
    ]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await geminiGenerate({ system: "s", user: "hello" });

    expect(calls[0].url).toBe("https://sts.googleapis.com/v1/token");
    const sts = JSON.parse(String(calls[0].init.body));
    // The audience must name the provider, or Google accepts a token minted for
    // a different pool.
    expect(sts.audience).toBe(`//iam.googleapis.com/${WIF_ENV.GCP_WORKLOAD_IDENTITY_PROVIDER}`);
    expect(sts.subjectToken).toBe("vercel.oidc.jwt");
    expect(sts.grantType).toBe("urn:ietf:params:oauth:grant-type:token-exchange");

    expect(calls[1].url).toContain(`serviceAccounts/${WIF_ENV.GCP_SERVICE_ACCOUNT_EMAIL}`);
    expect(calls[1].url).toContain(":generateAccessToken");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer federated-token",
    );
  });

  it("calls Vertex with the impersonated token, and derives the project from the SA email", async () => {
    Object.assign(process.env, WIF_ENV);
    const calls = mockFetchSequence([
      { body: { access_token: "federated-token" } },
      {
        body: {
          accessToken: "sa-token",
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
      { body: GENERATE_OK },
    ]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await geminiGenerate({ system: "s", user: "hello" });

    const vertex = calls[2];
    expect(vertex.url).toContain("aiplatform.googleapis.com");
    // No key to read project_id from — it comes out of the account email.
    expect(vertex.url).toContain("/projects/datarocks-prod/");
    expect((vertex.init.headers as Record<string, string>).Authorization).toBe("Bearer sa-token");
  });

  it("GEMINI_PROJECT_ID wins over the email-derived project", async () => {
    Object.assign(process.env, WIF_ENV, { GEMINI_PROJECT_ID: "datarocks-dev-app" });
    const calls = mockFetchSequence([
      { body: { access_token: "f" } },
      { body: { accessToken: "s", expireTime: new Date(Date.now() + 3600_000).toISOString() } },
      { body: GENERATE_OK },
    ]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await geminiGenerate({ system: "s", user: "hello" });
    expect(calls[2].url).toContain("/projects/datarocks-dev-app/");
  });

  it("says what is missing when no OIDC token can be obtained", async () => {
    process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = WIF_ENV.GCP_WORKLOAD_IDENTITY_PROVIDER;
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = WIF_ENV.GCP_SERVICE_ACCOUNT_EMAIL;
    mockFetchSequence([]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await expect(geminiGenerate({ system: "s", user: "hello" })).rejects.toThrow(
      /Vercel OIDC token/,
    );
  });

  // The regression this file exists for: production has no VERCEL_OIDC_TOKEN in
  // the environment. The token is per-invocation and lives in the request
  // context, so reading process.env alone silently disabled Gemini.
  it("falls back to the request-context token when the env var is absent", async () => {
    process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = WIF_ENV.GCP_WORKLOAD_IDENTITY_PROVIDER;
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = WIF_ENV.GCP_SERVICE_ACCOUNT_EMAIL;
    const { getVercelOidcToken } = await import("@vercel/oidc");
    (getVercelOidcToken as jest.Mock).mockResolvedValueOnce("ctx.oidc.jwt");
    const calls = mockFetchSequence([
      { body: { access_token: "f" } },
      { body: { accessToken: "s", expireTime: new Date(Date.now() + 3600_000).toISOString() } },
      { body: GENERATE_OK },
    ]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await geminiGenerate({ system: "s", user: "hello" });
    expect(JSON.parse(String(calls[0].init.body)).subjectToken).toBe("ctx.oidc.jwt");
  });

  it("surfaces an STS rejection rather than failing later as a Vertex 401", async () => {
    Object.assign(process.env, WIF_ENV);
    mockFetchSequence([{ ok: false, status: 400, body: { error: "invalid_grant" } }]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await expect(geminiGenerate({ system: "s", user: "hello" })).rejects.toThrow(/STS/);
  });
});

describe("signed-key fallback", () => {
  it("is preferred when a key is present, and never touches STS", async () => {
    Object.assign(process.env, WIF_ENV, {
      GEMINI_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "legacy@old-project.iam.gserviceaccount.com",
        // Any RSA key works; the JWT is signed locally and the exchange is mocked.
        private_key: generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
          publicKeyEncoding: { type: "spki", format: "pem" },
        }).privateKey,
        project_id: "old-project",
      }),
    });
    const calls = mockFetchSequence([
      { body: { access_token: "key-token", expires_in: 3600 } },
      { body: GENERATE_OK },
    ]);
    const { geminiGenerate } = await import("@/lib/gemini");
    await geminiGenerate({ system: "s", user: "hello" });

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls.some((c) => c.url.includes("sts.googleapis.com"))).toBe(false);
    expect(calls[1].url).toContain("/projects/old-project/");
  });
});
