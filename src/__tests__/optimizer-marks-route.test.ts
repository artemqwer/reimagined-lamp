/**
 * /api/optimizer-marks — what has been acted on, and what was waved away.
 *
 * The parts worth pinning down are the ones a browser can't easily show: that
 * a mark belongs to one source and one period and can't leak into another,
 * that a fresh install without the migration degrades to "not stored" rather
 * than a 500, and that nothing can be stored under a state the page can't read.
 */

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const eqCalls: [string, unknown][] = [];

const chain = (terminal: jest.Mock) => {
  const self = {
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return self;
    },
    then: (...a: unknown[]) => (terminal() as Promise<unknown>).then(...(a as [])),
  };
  return self;
};

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => chain(mockSelect),
      upsert: mockUpsert,
      delete: () => chain(mockDelete),
    }),
  })),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => Promise.resolve({ getAll: () => [] })),
}));

import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/optimizer-marks/route";

const USER = { id: "user-1" };
const qs = "connector=google_ads&period=2026-08";

const get = (q = qs) => GET(new NextRequest(`http://localhost/api/optimizer-marks?${q}`));
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/optimizer-marks", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
const del = (q: string) =>
  DELETE(new NextRequest(`http://localhost/api/optimizer-marks?${q}`, { method: "DELETE" }));

beforeEach(() => {
  jest.clearAllMocks();
  eqCalls.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockSelect.mockResolvedValue({ data: [], error: null });
  mockUpsert.mockResolvedValue({ error: null });
  mockDelete.mockResolvedValue({ error: null });
});

describe("who can see what", () => {
  it("refuses without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("scopes every read to one user, source and period", async () => {
    await get();
    expect(eqCalls).toEqual([
      ["user_id", "user-1"],
      ["connector", "google_ads"],
      ["period", "2026-08"],
    ]);
  });

  it("rejects a period it can't parse instead of guessing", async () => {
    expect((await get("connector=google_ads&period=last-month")).status).toBe(400);
  });

  it("rejects a source that doesn't exist", async () => {
    expect((await get("connector=not_a_source&period=2026-08")).status).toBe(400);
  });
});

describe("marking one", () => {
  it("stores it against the recommendation's own id", async () => {
    const res = await post({
      connector: "google_ads",
      period: "2026-08",
      id: "device:waste-MOBILE",
      state: "completed",
    });
    expect(res.status).toBe(200);
    const row = mockUpsert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: "user-1",
      connector: "google_ads",
      period: "2026-08",
      recommendation_id: "device:waste-MOBILE",
      state: "completed",
    });
  });

  it("refuses a state the page can't read back", async () => {
    const res = await post({
      connector: "google_ads",
      period: "2026-08",
      id: "x",
      state: "maybe-later",
    });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses a mark with nothing to attach it to", async () => {
    const res = await post({ connector: "google_ads", period: "2026-08", state: "dismissed" });
    expect(res.status).toBe(400);
  });
});

describe("putting one back", () => {
  it("deletes only that recommendation, for that source and period", async () => {
    const res = await del(`${qs}&id=device:waste-MOBILE`);
    expect(res.status).toBe(200);
    expect(eqCalls).toEqual([
      ["user_id", "user-1"],
      ["connector", "google_ads"],
      ["period", "2026-08"],
      ["recommendation_id", "device:waste-MOBILE"],
    ]);
  });
});

describe("before the migration has been run", () => {
  // PostgREST answers PGRST205 for a table it doesn't know; Postgres raises
  // 42P01. Either way it's a setup state, not a failure — dismissing still
  // works for the visit, and the page says so rather than refusing to load.
  for (const code of ["42P01", "PGRST205"]) {
    it(`reads as "not stored yet" on ${code}`, async () => {
      mockSelect.mockResolvedValue({ data: null, error: { code } });
      const res = await get();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.stored).toBe(false);
      expect(json.marks).toEqual({});
      expect(json.hint).toContain("optimizer_marks.sql");
    });

    it(`writes as "not stored yet" on ${code}`, async () => {
      mockUpsert.mockResolvedValue({ error: { code } });
      const res = await post({
        connector: "google_ads",
        period: "2026-08",
        id: "x",
        state: "dismissed",
      });
      expect(res.status).toBe(200);
      expect((await res.json()).stored).toBe(false);
    });
  }

  it("still reports a real database failure as one", async () => {
    mockSelect.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    expect((await get()).status).toBe(500);
  });
});

describe("reading them back", () => {
  it("keys them by recommendation, with when it happened", async () => {
    mockSelect.mockResolvedValue({
      data: [
        { recommendation_id: "a", state: "completed", marked_at: "2026-08-10T23:29:00Z" },
        { recommendation_id: "b", state: "dismissed", marked_at: "2026-08-10T23:30:00Z" },
      ],
      error: null,
    });
    const json = await (await get()).json();
    expect(json.marks.a).toEqual({ state: "completed", at: "2026-08-10T23:29:00Z" });
    expect(json.marks.b.state).toBe("dismissed");
    expect(json.stored).toBe(true);
  });
});
