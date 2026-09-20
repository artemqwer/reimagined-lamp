/**
 * AI Optimizer — the engine that decides what's worth acting on.
 *
 * These numbers get believed and acted on, so the tests hold two lines: every
 * figure has to be derivable from the rows given, and the engine has to stay
 * quiet when the data doesn't support a claim. A recommendation nobody can
 * check is worse than none.
 */

import { findOpportunities, type EntityRow } from "@/lib/aiOptimizer";
import { goalMetricsFor, type GoalMetricDef } from "@/lib/smartGoalMetrics";

const ADS = goalMetricsFor("google_ads");
const GA4 = goalMetricsFor("ga4");
const focus = (metrics: GoalMetricDef[], key: string) => metrics.find((m) => m.key === key)!;

const entity = (name: string, totals: Partial<EntityRow["totals"]>): EntityRow => ({
  name,
  totals: {
    clicks: 0,
    impressions: 0,
    cost: 0,
    conversions: 0,
    revenue: 0,
    extra: {},
    ...totals,
  },
});

/** Four campaigns each returning 4x — a healthy, uniform account. */
const healthy = (): EntityRow[] =>
  ["A", "B", "C", "D"].map((n) =>
    entity(n, { cost: 1_000, revenue: 4_000, conversions: 40, clicks: 500 }),
  );

const run = (rows: EntityRow[], key = "revenue", metrics = ADS, hasCost = true) =>
  findOpportunities({ rows, focus: focus(metrics, key), marginPct: 40, hasCost });

describe("staying quiet", () => {
  it("finds nothing in an account where everything performs alike", () => {
    expect(run(healthy()).opportunities).toEqual([]);
  });

  it("claims nothing from too few entities to have a norm", () => {
    // With two campaigns, "the account average" is mostly the campaign itself.
    const rows = [
      entity("A", { cost: 1_000, revenue: 4_000 }),
      entity("B", { cost: 1_000, revenue: 0 }),
    ];
    expect(run(rows).opportunities).toEqual([]);
  });

  it("ignores an entity too small to be worth acting on", () => {
    // $5 of a $4,005 account: real, but recommending work on it is busywork.
    const rows = [...healthy(), entity("Tiny", { cost: 5, revenue: 0 })];
    expect(run(rows).opportunities.map((o) => o.entity)).not.toContain("Tiny");
  });

  it("still finds the worst offenders in a huge, high-cardinality breakdown", () => {
    // 300 uniform search terms plus one that burned $500 for nothing. That $500
    // is only 1.6% of total spend — under the 2%-of-account bar that works for
    // campaigns — but it is 5x the average term, which on a breakdown this size
    // is the honest signal. Without this, tens of thousands of search terms all
    // read healthy because none is individually 2% of the account.
    const many = Array.from({ length: 300 }, (_, i) =>
      entity(`t${i}`, { cost: 100, revenue: 400, conversions: 4, clicks: 50 }),
    );
    const rows = [...many, entity("burn", { cost: 500, revenue: 0, conversions: 0, clicks: 60 })];
    const found = run(rows).opportunities.find((o) => o.entity === "burn");
    expect(found?.kind).toBe("wasted_spend");
  });

  it("says nothing at all when there is no data", () => {
    const s = run([]);
    expect(s.count).toBe(0);
    expect(s.totalImpact).toBe(0);
    expect(s.averageImpact).toBe(0);
  });
});

describe("judging a scoped slice against an outside benchmark", () => {
  it("flags a small campaign's dead spend against the account, past MIN_ENTITIES", () => {
    // One campaign's two search terms: one dead. On their own that's "too few
    // to have a norm" (see above) and nothing is claimed. Against the whole
    // account's 4x rate, the dead one is a real, findable loss.
    const scope = [
      entity("kw-good", { cost: 500, revenue: 2_000, conversions: 20, clicks: 250 }),
      entity("kw-dead", { cost: 500, revenue: 0, conversions: 0, clicks: 250 }),
    ];
    const account = healthy(); // 4x across the account
    const s = findOpportunities({
      rows: scope,
      focus: focus(ADS, "revenue"),
      marginPct: 40,
      hasCost: true,
      benchmark: account,
    });
    const dead = s.opportunities.find((o) => o.entity === "kw-dead");
    expect(dead?.kind).toBe("wasted_spend");
    // $500 at the account's own 4x is worth $2,000 left on the table.
    expect(dead?.impact).toBeCloseTo(2_000);
  });

  it("leaves the account-level path unchanged when no benchmark is given", () => {
    const rows = [
      entity("A", { cost: 1_000, revenue: 4_000 }),
      entity("B", { cost: 1_000, revenue: 0 }),
    ];
    // Two entities, no benchmark — still "too few to have a norm".
    expect(run(rows).opportunities).toEqual([]);
  });
});

describe("spend that returns nothing", () => {
  const rows = [...healthy(), entity("Dead", { cost: 1_000, revenue: 0, conversions: 0 })];

  it("is found and named", () => {
    const found = run(rows).opportunities.find((o) => o.entity === "Dead");
    expect(found?.kind).toBe("wasted_spend");
    expect(found?.title).toMatch(/returned nothing/);
  });

  it("quotes an impact the rows actually support", () => {
    // The account returns 16,000/5,000 = 3.2x. That $1,000 at 3.2x is $3,200.
    const found = run(rows).opportunities.find((o) => o.entity === "Dead")!;
    expect(found.impact).toBeCloseTo(3_200);
    expect(found.detail).toContain("$3,200");
  });

  it("ranks it above a merely weak performer", () => {
    const withWeak = [...rows, entity("Weak", { cost: 1_000, revenue: 500, conversions: 5 })];
    const ordered = run(withWeak).opportunities.map((o) => o.entity);
    expect(ordered.indexOf("Dead")).toBeLessThan(ordered.indexOf("Weak"));
  });
});

describe("under- and over-performers", () => {
  it("measures against the account's own rate, not an outside benchmark", () => {
    const rows = [...healthy(), entity("Weak", { cost: 1_000, revenue: 500, conversions: 5 })];
    const found = run(rows).opportunities.find((o) => o.entity === "Weak")!;
    expect(found.kind).toBe("underperformer");
    // Account: 16,500/5,000 = 3.3x. Weak: 0.5x. Gap on its $1,000: 3,300 − 500.
    expect(found.impact).toBeCloseTo(2_800);
  });

  it("claims only a lift to the account's average, never to the best", () => {
    // The conservative claim: nothing in the data says a weak campaign can
    // reach the best one's rate.
    const rows = [
      ...healthy(),
      entity("Star", { cost: 1_000, revenue: 20_000, conversions: 200 }),
      entity("Weak", { cost: 1_000, revenue: 100, conversions: 1 }),
    ];
    const weak = run(rows).opportunities.find((o) => o.entity === "Weak")!;
    const accountReturn = (16_000 + 20_000 + 100) / 6_000;
    expect(weak.impact).toBeCloseTo(1_000 * accountReturn - 100);
  });

  it("points out the one worth more budget", () => {
    const rows = [...healthy(), entity("Star", { cost: 1_000, revenue: 20_000, conversions: 200 })];
    const found = run(rows).opportunities.find((o) => o.entity === "Star")!;
    expect(found.kind).toBe("scale");
    // 20% more spend (extra=200), but marginal returns diminish: the added spend
    // is assumed to convert at SCALE_MARGINAL_FACTOR (0.6) of the 20x rate, so
    // the projected profit is a conservative estimate, not a flat same-rate one.
    expect(found.impact).toBeCloseTo(200 * 20 * 0.6 - 200);
  });
});

describe("a source with no ad spend", () => {
  const rows = [
    entity("Organic", { clicks: 1_000, conversions: 50 }),
    entity("Direct", { clicks: 1_000, conversions: 50 }),
    entity("Social", { clicks: 1_000, conversions: 50 }),
    entity("Referral", { clicks: 1_000, conversions: 2 }),
  ];

  it("compares how well each converts instead of what it costs", () => {
    const s = findOpportunities({
      rows,
      focus: focus(GA4, "revenue"),
      marginPct: 40,
      hasCost: false,
    });
    const found = s.opportunities.find((o) => o.entity === "Referral")!;
    expect(found.kind).toBe("weak_conversion");
    // Account converts 152/4,000 = 3.8%. Referral's 1,000 sessions would give
    // 38; it gave 2. The magnitude now rides on the impact badge (monthly), so
    // the detail states the comparison qualitatively rather than restating it.
    expect(found.detail).toMatch(/would produce more/);
    expect(found.impact).toBeGreaterThan(0);
  });

  it("states impacts in conversions, since there's no money to state", () => {
    const s = findOpportunities({
      rows,
      focus: focus(GA4, "revenue"),
      marginPct: 40,
      hasCost: false,
    });
    expect(s.impactMetric).toBe("conv");
  });
});

describe("impacts are stated in the goal's own terms", () => {
  const rows = [...healthy(), entity("Dead", { cost: 1_000, revenue: 0, conversions: 0 })];

  it("in revenue for a revenue goal", () => {
    expect(run(rows, "revenue").impactMetric).toBe("revenue");
  });

  it("at margin for a net profit goal", () => {
    // The same finding is worth less to profit than to revenue.
    const net = run(rows, "net_profit");
    expect(net.impactMetric).toBe("net_profit");
    expect(net.totalImpact).toBeCloseTo(3_200 * 0.4);
  });

  it("as the spend saved for a budget goal", () => {
    const cost = run(rows, "cost");
    expect(cost.impactMetric).toBe("cost");
    expect(cost.opportunities.find((o) => o.entity === "Dead")?.impact).toBeCloseTo(1_000);
  });

  it("falls back to money for a ratio goal rather than inventing a delta", () => {
    // "+0.4 ROAS from this campaign" isn't a number the data supports.
    const roas = run(rows, "roasVal");
    expect(roas.impactMetric).toBe("revenue");
    expect(roas.count).toBeGreaterThan(0);
  });
});

describe("the summary the goal forecast reports", () => {
  const rows = [
    ...healthy(),
    entity("Dead", { cost: 1_000, revenue: 0, conversions: 0 }),
    entity("Weak", { cost: 1_000, revenue: 300, conversions: 3 }),
  ];

  it("counts entities, total and average consistently", () => {
    const s = run(rows);
    expect(s.count).toBe(s.opportunities.length);
    expect(s.entitiesWithOpportunities).toBe(new Set(s.opportunities.map((o) => o.entity)).size);
    expect(s.totalImpact).toBeCloseTo(s.opportunities.reduce((a, o) => a + o.impact, 0));
    expect(s.averageImpact).toBeCloseTo(s.totalImpact / s.count);
  });

  it("never reports an opportunity worth nothing", () => {
    for (const o of run(rows).opportunities) expect(o.impact).toBeGreaterThan(0);
  });
});

describe("saying which kind of nothing it found", () => {
  // Collapsing these into one message claimed "every row is performing in line
  // with the account average" when there were no rows at all.
  it("knows the breakdown returned nothing", () => {
    expect(run([]).quietReason).toBe("no_rows");
  });

  it("knows there were too few rows to have a norm", () => {
    expect(run([entity("A", { cost: 100, revenue: 400 })]).quietReason).toBe("too_few");
  });

  it("knows there was nothing to judge rows by", () => {
    // Traffic, but no spend and no conversions anywhere.
    const rows = ["A", "B", "C", "D"].map((n) => entity(n, { clicks: 500 }));
    const s = findOpportunities({
      rows,
      focus: focus(GA4, "revenue"),
      marginPct: 40,
      hasCost: false,
    });
    expect(s.quietReason).toBe("no_basis");
  });

  it("only says everything is in line when it actually compared them", () => {
    expect(run(healthy()).quietReason).toBe("in_line");
  });

  it("says nothing about quiet when it did find something", () => {
    const rows = [...healthy(), entity("Dead", { cost: 1_000, revenue: 0, conversions: 0 })];
    expect(run(rows).quietReason).toBeUndefined();
  });
});
