/**
 * The dashboard's source comes from the URL. This is what makes a reload — or
 * a pasted link — open the source the link names, instead of whichever one the
 * browser happened to have left in localStorage.
 *
 * There's no jsdom here, so the two browser globals the store reads are stubbed
 * directly.
 */

const withBrowser = async (path: string, stored?: string) => {
  const store: Record<string, string> = stored ? { activeConnector: stored } : {};
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: path },
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  };
  let mod!: typeof import("@/lib/store");
  await jest.isolateModulesAsync(async () => {
    mod = await import("@/lib/store");
  });
  const active = mod.useCrossFilter.getState().activeConnector;
  delete (globalThis as unknown as { window?: unknown }).window;
  return active;
};

describe("the source a freshly loaded dashboard shows", () => {
  it("comes from the URL", async () => {
    expect(await withBrowser("/ga4")).toBe("ga4");
    expect(await withBrowser("/google-ads")).toBe("google_ads");
  });

  it("beats a different source left in localStorage", async () => {
    // The reason this exists: reloading /ga4 used to hand you whatever was
    // stored, which after any visit to Google Ads was google_ads.
    expect(await withBrowser("/ga4", "google_ads")).toBe("ga4");
  });

  it("falls back to localStorage on a page that names no source", async () => {
    expect(await withBrowser("/admin", "ga4")).toBe("ga4");
  });

  it("falls back to the default when nothing says otherwise", async () => {
    expect(await withBrowser("/admin")).toBe("google_ads");
  });
});
