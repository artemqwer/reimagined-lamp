/**
 * /api/smart-goals — reading a period's goals and saving them.
 *
 * The parts worth pinning down are the ones a browser can't easily show: that
 * an unconfigured period inherits the previous one's goals, that a period the
 * user planned ahead is never overwritten by that inheritance, that a client
 * skipping validation can't store a configuration the app can't read, and that
 * a fresh install (no tables yet) reports a setup state rather than a 500.
 */

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockUpsert = jest.fn();
// The most-recent-row read GET uses to apply one shared order/colour layout,
// and the "other periods" read POST uses to propagate it. Empty by default, so
// they're a no-op unless a test opts in.
const mockRecent = jest.fn();
const mockOthers = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            // .in(periods) — the period + related rows
            in: mockSelect,
            // .neq(period) — every OTHER period, for layout propagation on save
            neq: mockOthers,
            // .order(updated_at).limit(1) — the newest row, for the shared layout
            order: () => ({ limit: mockRecent }),
          }),
        }),
      }),
      upsert: mockUpsert,
    }),
  })),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => Promise.resolve({ getAll: () => [] })),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/smart-goals/route";
import { emptySettings, type SmartGoalsSettings } from "@/lib/smartGoals";
import { goalMetricsFor } from "@/lib/smartGoalMetrics";

const ADS = goalMetricsFor("google_ads");

const USER = { id: "user-1" };

/** A saveable configuration: one goal enabled with a target. */
const valid = (period: string, revenueTarget = 10_000): SmartGoalsSettings => {
  const s = emptySettings(period, "google_ads", ADS);
  const revenue = s.goals.find((g) => g.metric === "revenue")!;
  revenue.enabled = true;
  revenue.target = revenueTarget;
  return s;
};

const get = (period: string, connector = "google_ads") =>
  GET(new NextRequest(`http://localhost/api/smart-goals?period=${period}&connector=${connector}`));

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/smart-goals", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockSelect.mockResolvedValue({ data: [], error: null });
  mockUpsert.mockResolvedValue({ error: null });
  mockRecent.mockResolvedValue({ data: [], error: null });
  mockOthers.mockResolvedValue({ data: [], error: null });
});

describe("reading a period", () => {
  it("refuses without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await get("2026-01")).status).toBe(401);
  });

  it("rejects a period it can't parse instead of guessing", async () => {
    const res = await get("last-month");
    expect(res.status).toBe(400);
  });

  it("rejects a source that doesn't exist", async () => {
    // Goals belong to a source; storing them against one the registry doesn't
    // know would make them unreadable.
    expect((await get("2026-01", "not_a_source")).status).toBe(400);
  });

  it("keeps each source's goals apart", async () => {
    // The query is scoped by connector, so GA4's goals can't answer a request
    // for Google Ads'.
    await get("2026-01", "ga4");
    expect(mockSelect).toHaveBeenCalled();
  });

  it("reports the empty state when the period has no goals", async () => {
    const json = await (await get("2026-01")).json();
    expect(json).toMatchObject({ settings: null, configured: false, source: "empty" });
  });

  it("returns the period's own goals when it has them", async () => {
    mockSelect.mockResolvedValue({
      data: [{ period: "2026-01", config: valid("2026-01", 55_000) }],
      error: null,
    });
    const json = await (await get("2026-01")).json();
    expect(json.source).toBe("own");
    expect(json.configured).toBe(true);
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      55_000,
    );
  });

  it("applies one shared order/colour layout across periods, keeping the period's targets", async () => {
    // This period's own goals: revenue first (order 0), its own target.
    const own = valid("2026-01", 55_000);
    own.goals.find((g) => g.metric === "revenue")!.order = 0;
    own.goals.find((g) => g.metric === "revenue")!.color = "#EF4444";
    mockSelect.mockResolvedValue({ data: [{ period: "2026-01", config: own }], error: null });
    // The most recently edited period put revenue at order 3 in blue. That
    // layout must win everywhere — but the target stays this period's own.
    const recent = valid("2026-05");
    recent.goals.find((g) => g.metric === "revenue")!.order = 3;
    recent.goals.find((g) => g.metric === "revenue")!.color = "#3B82F6";
    mockRecent.mockResolvedValue({ data: [{ config: recent }], error: null });

    const json = await (await get("2026-01")).json();
    const rev = json.settings.goals.find((g: { metric: string }) => g.metric === "revenue");
    expect(rev.order).toBe(3);
    expect(rev.color).toBe("#3B82F6");
    expect(rev.target).toBe(55_000);
  });

  it("carries last month's goals into a month with none", async () => {
    // What makes a new month continue where the last one left off instead of
    // starting empty.
    mockSelect.mockResolvedValue({
      data: [{ period: "2025-12", config: valid("2025-12", 42_000) }],
      error: null,
    });
    const json = await (await get("2026-01")).json();
    expect(json.source).toBe("carried");
    expect(json.settings.period).toBe("2026-01");
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      42_000,
    );
  });

  it("never lets that inheritance overwrite a month planned ahead", async () => {
    mockSelect.mockResolvedValue({
      data: [
        { period: "2025-12", config: valid("2025-12", 42_000) },
        { period: "2026-01", config: valid("2026-01", 99_000) },
      ],
      error: null,
    });
    const json = await (await get("2026-01")).json();
    expect(json.source).toBe("own");
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      99_000,
    );
  });

  it("treats a missing table as 'not set up yet', not as a failure", async () => {
    // PostgREST answers PGRST205 for a table it can't find in its schema cache;
    // Postgres itself raises 42P01. Both mean the migration hasn't been run.
    for (const code of ["PGRST205", "42P01"]) {
      mockSelect.mockResolvedValue({ data: null, error: { code, message: "missing" } });
      const res = await get("2026-01");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ configured: false });
    }
  });

  it("says what to do when the table predates per-source goals", async () => {
    // "column smart_goals.connector does not exist" tells nobody what to run.
    mockSelect.mockResolvedValue({ data: null, error: { code: "42703", message: "no column" } });
    const res = await get("2026-01");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/smart_goals\.sql/);
  });

  it("still reports a real database error", async () => {
    mockSelect.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    expect((await get("2026-01")).status).toBe(500);
  });
});

describe("saving a period", () => {
  it("refuses without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await post({ settings: valid("2026-01") })).status).toBe(401);
  });

  it("stores a valid configuration under the user and period", async () => {
    const res = await post({ settings: valid("2026-01") });
    expect(res.status).toBe(200);
    const [row] = mockUpsert.mock.calls[0];
    expect(row).toMatchObject({ user_id: USER.id, period: "2026-01", connector: "google_ads" });
    expect(row.config.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      10_000,
    );
  });

  it("rejects a configuration with nothing enabled", async () => {
    const res = await post({ settings: emptySettings("2026-01", "google_ads", ADS) });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a zero target even if the client allowed it", async () => {
    const res = await post({ settings: valid("2026-01", 0) });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.revenue).toBeTruthy();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("stores only the fields the model defines", async () => {
    const settings = valid("2026-01") as SmartGoalsSettings & { rogue?: string };
    settings.rogue = "should not be stored";
    await post({ settings });
    expect(mockUpsert.mock.calls[0][0].config).not.toHaveProperty("rogue");
  });

  it("coerces a target that arrived as a string", async () => {
    const settings = valid("2026-01");
    // A number input hands back a string; storing it as one would break every
    // comparison downstream.
    (settings.goals.find((g) => g.metric === "revenue") as { target: unknown }).target = "7500";
    await post({ settings });
    expect(
      mockUpsert.mock.calls[0][0].config.goals.find(
        (g: { metric: string }) => g.metric === "revenue",
      ).target,
    ).toBe(7_500);
  });

  it("explains what to do when the table isn't there yet", async () => {
    mockUpsert.mockResolvedValue({ error: { code: "PGRST205", message: "missing" } });
    const res = await post({ settings: valid("2026-01") });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/smart_goals\.sql/);
  });

  it("rejects a body with no settings", async () => {
    expect((await post({})).status).toBe(400);
  });
});

describe("a plan entered on one shape answering for the other", () => {
  // The complaint this closes: goals set on months left the yearly view empty,
  // so switching to it demanded a second set of goals that said the same thing.
  const row = (period: string, config: SmartGoalsSettings) => ({ period, config });

  it("builds a year out of the months inside it", async () => {
    mockSelect.mockResolvedValue({ data: [row("2026-08", valid("2026-08", 30_000))], error: null });
    const json = await (await get("2026")).json();
    expect(json.source).toBe("rolled_up");
    expect(json.configured).toBe(true);
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      360_000,
    );
  });

  it("asks for the months when the period is a year", async () => {
    await get("2026");
    // Every month of that year, so any planned month can contribute.
    const periods = mockSelect.mock.calls[0][1] as string[];
    for (const m of ["2026-01", "2026-06", "2026-12"]) expect(periods).toContain(m);
  });

  it("gives a month its share when only the year was planned", async () => {
    mockSelect.mockResolvedValue({ data: [row("2026", valid("2026", 360_000))], error: null });
    const json = await (await get("2026-08")).json();
    expect(json.source).toBe("split");
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      30_000,
    );
  });

  it("never lets a derived plan override what was set on the period itself", async () => {
    mockSelect.mockResolvedValue({
      data: [row("2026", valid("2026", 360_000)), row("2026-08", valid("2026-08", 999))],
      error: null,
    });
    const json = await (await get("2026-08")).json();
    expect(json.source).toBe("own");
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      999,
    );
  });

  it("prefers last month's plan over a share of the year", async () => {
    // The month before is the most recent thing the user actually decided; a
    // twelfth of the year is the coarser statement.
    mockSelect.mockResolvedValue({
      data: [row("2026", valid("2026", 360_000)), row("2026-07", valid("2026-07", 50_000))],
      error: null,
    });
    const json = await (await get("2026-08")).json();
    expect(json.source).toBe("carried");
    expect(json.settings.goals.find((g: { metric: string }) => g.metric === "revenue").target).toBe(
      50_000,
    );
  });

  it("prefers this year's own months over last year's plan", async () => {
    mockSelect.mockResolvedValue({
      data: [row("2025", valid("2025", 120_000)), row("2026-03", valid("2026-03", 30_000))],
      error: null,
    });
    const json = await (await get("2026")).json();
    expect(json.source).toBe("rolled_up");
  });

  it("still reports an empty period as empty", async () => {
    mockSelect.mockResolvedValue({ data: [], error: null });
    const json = await (await get("2026")).json();
    expect(json.source).toBe("empty");
    expect(json.configured).toBe(false);
  });
});
