/**
 * The optimizer across every breakdown a source has.
 *
 * These figures get acted on — budgets moved, keywords excluded — so the tests
 * hold the same line as the single-breakdown engine: every number has to be
 * derivable from the rows given, and a finding has to carry the rows it came
 * from. A recommendation nobody can check is worse than none.
 */

import {
  analyseAccount,
  categoryIcon,
  entitiesFromPerfRows,
  entitiesFromWindsorRows,
  summariseEntities,
  categoryScore,
  priorityFor,
  rowMeetsThresholds,
  type CategoryInput,
} from "@/lib/optimizerCategories";
import { goalMetricsFor } from "@/lib/smartGoalMetrics";
import type { EntityRow } from "@/lib/aiOptimizer";
import type { ThresholdRule } from "@/lib/connectors";

const ADS = goalMetricsFor("google_ads");
const focus = ADS.find((m) => m.key === "revenue")!;

const entity = (name: string, t: Partial<EntityRow["totals"]>): EntityRow => ({
  name,
  totals: { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {}, ...t },
});

/** Four rows returning 4x, plus one that returns nothing. */
const breakdown = (key: string, label: string, singular: string): CategoryInput => ({
  key,
  label,
  singular,
  rows: [
    ...["A", "B", "C", "D"].map((n) =>
      entity(`${key}-${n}`, { cost: 1_000, revenue: 4_000, conversions: 40, clicks: 500 }),
    ),
    entity(`${key}-dead`, { cost: 1_000, revenue: 0, conversions: 0, clicks: 400 }),
  ],
});

const run = (categories: CategoryInput[]) =>
  analyseAccount({ categories, focus, marginPct: 40, hasCost: true });

describe("analysing every breakdown, not just one", () => {
  it("finds something in each of them", () => {
    const a = run([
      breakdown("search_term", "Search Terms", "Search term"),
      breakdown("device", "Devices", "Device"),
    ]);
    expect(new Set(a.recommendations.map((r) => r.category))).toEqual(
      new Set(["search_term", "device"]),
    );
  });

  it("keeps each finding tied to the breakdown it came from", () => {
    const a = run([breakdown("device", "Devices", "Device")]);
    const r = a.recommendations[0];
    expect(r.categoryLabel).toBe("Devices");
    expect(r.id.startsWith("device:")).toBe(true);
  });

  it("names the categories from the source, not from a fixed list", () => {
    // A source built in the constructor brings its own breakdowns; nothing here
    // may assume Google Ads' set.
    const a = run([breakdown("invented_dim", "Whatever An Admin Added", "Thing")]);
    expect(a.categories.map((c) => c.label)).toEqual(["Whatever An Admin Added"]);
  });

  it("says nothing about a breakdown that returned no rows", () => {
    const a = run([{ key: "empty", label: "Empty", singular: "Row", rows: [] }]);
    expect(a.recommendations).toEqual([]);
    expect(a.categories[0].quietReason).toBe("no_rows");
  });

  it("does not sum the same money across breakdowns — headline is one breakdown, not their total", () => {
    // Every breakdown re-slices the SAME account spend, so adding a second
    // breakdown of the same magnitude must NOT double the headline "+$…/month"
    // figure (the reported inflation: one wasted campaign counted again under its
    // network / ad groups / ads).
    const one = run([breakdown("device", "Devices", "Device")]);
    const two = run([
      breakdown("device", "Devices", "Device"),
      breakdown("search_term", "Search Terms", "Search term"),
    ]);
    expect(one.totalImpact).toBeGreaterThan(0);
    expect(two.totalImpact).toBeCloseTo(one.totalImpact);
  });
});

describe("the evidence under a recommendation", () => {
  const a = run([breakdown("search_term", "Search Terms", "Search term")]);
  const rec = a.recommendations.find((r) => r.entity === "search_term-dead")!;

  it("includes the row the recommendation is about, flagged", () => {
    const flagged = rec.evidence!.rows.filter((r) => r.flagged);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].label).toBe("search_term-dead");
  });

  it("shows it beside its neighbours, so it can be read in context", () => {
    expect(rec.evidence!.rows.length).toBeGreaterThan(1);
  });

  it("totals exactly the rows it displays", () => {
    const shown = rec.evidence!.rows;
    expect(rec.evidence!.total.cost).toBeCloseTo(shown.reduce((s, r) => s + r.values.cost, 0));
    expect(rec.evidence!.total.clicks).toBeCloseTo(shown.reduce((s, r) => s + r.values.clicks, 0));
  });

  it("derives every cell from the row's own numbers", () => {
    const row = rec.evidence!.rows.find((r) => !r.flagged)!;
    // 4,000 back on 1,000 spent.
    expect(row.values.roas).toBeCloseTo(4);
    // Ad Profit = revenue − spend (no margin adjustment).
    expect(row.values.adProfit).toBeCloseTo(4_000 - 1_000);
  });

  it("labels the first column with the breakdown's own noun", () => {
    expect(rec.evidence!.columns[0].label).toBe("Search term");
  });
});

describe("the AI Optimization Thresholds", () => {
  const clicksAtLeast = (n: number): ThresholdRule[] => [{ metric: "clicks", op: "gte", value: n }];
  const run1 = (categories: CategoryInput[], thresholds: ThresholdRule[]) =>
    analyseAccount({ categories, focus, marginPct: 40, hasCost: true, thresholds });

  it("flags only rows that meet the threshold, not every row", () => {
    // The table is analysed in full (norm + evidence context from every row),
    // but only threshold-meeting rows become flagged opportunities. The dead row
    // has 400 clicks: flagged at ≥200, excluded at ≥500.
    const cats = [breakdown("search_term", "Search Terms", "Search term")];
    expect(
      run1(cats, clicksAtLeast(200)).recommendations.some((r) => r.entity.endsWith("-dead")),
    ).toBe(true);
    expect(
      run1(cats, clicksAtLeast(500)).recommendations.some((r) => r.entity.endsWith("-dead")),
    ).toBe(false);
  });

  it("flags a threshold-meeting row even when it has conversions", () => {
    // The reported bug: a row that meets the threshold (≥50 clicks AND a loss)
    // but has conversions/revenue was skipped because it wasn't FAR below the
    // account rate. With a threshold set, meeting it is sufficient.
    const rules: ThresholdRule[] = [
      { metric: "clicks", op: "gte", value: 50 },
      { metric: "profit", op: "lt", value: 0 },
    ];
    const cats: CategoryInput[] = [
      {
        key: "ad_group",
        label: "Ad Groups",
        singular: "Ad group",
        rows: [
          // Meets the threshold AND has 2 conversions + revenue, still a loss.
          entity("Men's Watches", { clicks: 3069, cost: 492, conversions: 2, revenue: 360 }),
          entity("Women's Watches", { clicks: 672, cost: 132, conversions: 0, revenue: 0 }),
          entity("Vases", { clicks: 312, cost: 60, conversions: 0, revenue: 0 }),
          entity("Bowls", { clicks: 74, cost: 16, conversions: 0, revenue: 0 }),
          // Profitable, well above rate — not a loss, so it must NOT be flagged.
          entity("Winner", { clicks: 500, cost: 100, conversions: 20, revenue: 900 }),
        ],
      },
    ];
    const recs = analyseAccount({
      categories: cats,
      focus,
      marginPct: 40,
      hasCost: true,
      thresholds: rules,
    }).recommendations;
    expect(recs.some((r) => r.entity === "Men's Watches")).toBe(true);
    expect(recs.some((r) => r.entity === "Winner")).toBe(false);
  });

  it("analyses everything with no rules", () => {
    const cats = [breakdown("device", "Devices", "Device")];
    expect(run1(cats, []).recommendations.length).toBeGreaterThan(0);
  });

  it("flags wasted spend even when the whole account returns nothing", () => {
    // A new Meta account: spend, but no conversions/revenue anywhere, so the
    // account's own rate is 0. The gap-to-rate is then 0 and used to zero the
    // impact, filtering every finding out — a source showing "0 recommendations".
    // The wasted spend must still be quoted (as the spend itself).
    const cats: CategoryInput[] = [
      {
        key: "adset",
        label: "Ad Sets",
        singular: "Ad set",
        rows: [
          entity("Set A", { clicks: 300, cost: 120, conversions: 0, revenue: 0 }),
          entity("Set B", { clicks: 250, cost: 90, conversions: 0, revenue: 0 }),
          entity("Set C", { clicks: 210, cost: 60, conversions: 0, revenue: 0 }),
          entity("Set D", { clicks: 180, cost: 40, conversions: 0, revenue: 0 }),
        ],
      },
    ];
    const recs = analyseAccount({
      categories: cats,
      focus,
      marginPct: 40,
      hasCost: true,
      thresholds: [{ metric: "clicks", op: "gte", value: 50 }],
    }).recommendations;
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.impact > 0)).toBe(true);
  });

  it("ANDs the rules — a row must meet all of them", () => {
    const t = { clicks: 500, impressions: 0, conversions: 0, extra: {} };
    const rules: ThresholdRule[] = [
      { metric: "clicks", op: "gte", value: 200 },
      { metric: "profit", op: "lt", value: 0 },
    ];
    // 500 clicks and a loss → passes both.
    expect(rowMeetsThresholds({ ...t, cost: 100, revenue: 0 }, rules)).toBe(true);
    // 500 clicks but profitable → fails the profit rule.
    expect(rowMeetsThresholds({ ...t, cost: 100, revenue: 400 }, rules)).toBe(false);
    // A loss but too few clicks → fails the clicks rule.
    expect(rowMeetsThresholds({ ...t, clicks: 50, cost: 100, revenue: 0 }, rules)).toBe(false);
  });
});

describe("the evidence preview", () => {
  it("caps the rows shown and reports the true total", () => {
    // One flagged dead row against 40 healthy others: the preview shows at most
    // 20, and rowCount says how many there really were.
    const rows: EntityRow[] = [
      entity("dead", { cost: 1_000, revenue: 0, conversions: 0, clicks: 500 }),
      ...Array.from({ length: 40 }, (_, i) =>
        entity(`kw${i}`, { cost: 1_000, revenue: 4_000, conversions: 40, clicks: 500 }),
      ),
    ];
    const a = analyseAccount({
      categories: [{ key: "search_term", label: "Search Terms", singular: "Search term", rows }],
      focus,
      marginPct: 40,
      hasCost: true,
    });
    const ev = a.recommendations.find((r) => r.entity === "dead")!.evidence!;
    expect(ev.rows.length).toBeLessThanOrEqual(20);
    expect(ev.rowCount).toBe(41);
  });
});

describe("consolidating Time of Day", () => {
  // Several unprofitable hours against a healthy backdrop.
  const hours = (): CategoryInput => ({
    key: "hour",
    label: "Time of Day",
    singular: "Hour",
    rows: [
      ...Array.from({ length: 6 }, (_, i) =>
        entity(`${8 + i}:00`, { cost: 1_000, revenue: 4_000, conversions: 40, clicks: 500 }),
      ),
      entity("17:00", { cost: 1_000, revenue: 0, conversions: 0, clicks: 500 }),
      entity("18:00", { cost: 1_000, revenue: 0, conversions: 0, clicks: 500 }),
      entity("19:00", { cost: 1_000, revenue: 0, conversions: 0, clicks: 500 }),
    ],
  });

  it("emits ONE recommendation, not one per hour", () => {
    const a = run([hours()]);
    const hourRecs = a.recommendations.filter((r) => r.category === "hour");
    expect(hourRecs).toHaveLength(1);
  });

  it("lists every underperforming hour in the one table, and sums their impact", () => {
    const a = run([hours()]);
    const rec = a.recommendations.find((r) => r.category === "hour")!;
    // All three bad hours are flagged in the single evidence table.
    const flagged = (rec.evidence?.rows ?? []).filter((r) => r.flagged).map((r) => r.label);
    expect(flagged).toEqual(expect.arrayContaining(["17:00", "18:00", "19:00"]));
    // Its impact is the total, and it carries every hour for the dashboard link.
    expect(rec.entities).toEqual(expect.arrayContaining(["17:00", "18:00", "19:00"]));
    expect(rec.impact).toBeGreaterThan(0);
  });

  it("leaves other breakdowns one-per-finding", () => {
    const a = run([breakdown("device", "Devices", "Device")]);
    expect(a.recommendations.filter((r) => r.category === "device").length).toBeGreaterThan(0);
    expect(a.recommendations.every((r) => r.id !== "device:all")).toBe(true);
  });
});

describe("how urgent a finding is", () => {
  it("is measured against the size of the account, not an absolute", () => {
    // The same $500 is a crisis on a small account and noise on a large one.
    expect(priorityFor(500, 2_000)).toBe("high");
    expect(priorityFor(500, 1_000_000)).toBe("low");
  });

  it("counts them by priority for the header", () => {
    const a = run([breakdown("device", "Devices", "Device")]);
    const total = a.counts.high + a.counts.medium + a.counts.low;
    expect(total).toBe(a.recommendations.length);
  });
});

describe("the health score", () => {
  it("is 100 when nothing is being missed", () => {
    expect(categoryScore(0, 10_000)).toBe(100);
  });

  it("falls with the share of the potential that is going astray", () => {
    expect(categoryScore(5_000, 10_000)).toBe(50);
  });

  it("never goes below zero, however bad it gets", () => {
    expect(categoryScore(999_999, 1_000)).toBe(0);
  });

  it("says nothing is wrong when there is nothing to judge", () => {
    expect(categoryScore(0, 0)).toBe(100);
  });

  it("scores the account as the average of the categories it could judge", () => {
    const a = run([
      breakdown("device", "Devices", "Device"),
      { key: "empty", label: "Empty", singular: "Row", rows: [] },
    ]);
    // The empty one has nothing to say and must not drag the account to 100.
    const judged = a.categories.filter((c) => c.quietReason !== "no_rows");
    expect(a.overallScore).toBe(
      Math.round(judged.reduce((s, c) => s + c.score, 0) / judged.length),
    );
  });
});

describe("what the recommendation tells you to do", () => {
  const a = run([breakdown("geo", "Geography", "Location")]);

  it("phrases the action in the breakdown's own noun", () => {
    const rec = a.recommendations.find((r) => r.kind === "wasted_spend")!;
    expect(rec.action.toLowerCase()).toContain("location");
  });

  it("states the expected result as potential, never as a promise", () => {
    // The magnitude is the monthly "potential" badge; the expected-result line is
    // framed as potential/would-recover, not a guaranteed "you will get $X".
    for (const r of a.recommendations)
      expect(r.expectedResult.toLowerCase()).toMatch(/potential|would recover/);
  });

  it("puts what is most at stake first", () => {
    const weights = a.recommendations.map((r) => r.weight);
    expect([...weights].sort((x, y) => y - x)).toEqual(weights);
  });
});

describe("stating an impact in its own units", () => {
  // A conversion count printed with a dollar sign is a number nobody can act
  // on, and the panel is believed — so the unit travels with the figure.
  const noSpend: CategoryInput = {
    key: "channel",
    label: "Channels",
    singular: "Channel",
    rows: [
      entity("Organic", { clicks: 1_000, conversions: 50 }),
      entity("Direct", { clicks: 1_000, conversions: 50 }),
      entity("Social", { clicks: 1_000, conversions: 50 }),
      entity("Referral", { clicks: 1_000, conversions: 2 }),
    ],
  };

  it("quotes money where there is money to quote", () => {
    const a = run([breakdown("device", "Devices", "Device")]);
    expect(a.impactFormat).toBe("money");
    // The money now lives on the impact figure + the current-state facts (real
    // window spend/revenue), not restated in the expected-result line.
    expect(a.recommendations[0].currentState).toContain("$");
  });

  it("quotes conversions plainly where there is no spend", () => {
    const ga4 = goalMetricsFor("ga4");
    const a = analyseAccount({
      categories: [noSpend],
      focus: ga4.find((m) => m.key === "revenue")!,
      marginPct: 40,
      hasCost: false,
    });
    expect(a.impactMetric).toBe("conv");
    expect(a.impactFormat).toBe("number");
    for (const r of a.recommendations) expect(r.expectedResult).not.toContain("$");
  });
});

describe("reading the dashboard's own rows", () => {
  // That endpoint reports money in thousands and names its fields for the
  // table. Read raw, an $858 search term arrives as 0.858 and every impact the
  // optimizer quotes comes out a thousandth of what it is.
  const row = {
    dimension: "автовыкуп днепр",
    impr: 269,
    clicks: 26,
    conv: 10.5,
    revenue: 0.0105,
    cost: 0.85819,
  };

  it("puts money back into the account's own currency", () => {
    const [e] = entitiesFromPerfRows([row]);
    expect(e.totals.cost).toBeCloseTo(858.19);
    expect(e.totals.revenue).toBeCloseTo(10.5);
  });

  it("reads the counts under the names that endpoint uses", () => {
    const [e] = entitiesFromPerfRows([row]);
    expect(e.totals.clicks).toBe(26);
    expect(e.totals.impressions).toBe(269);
    expect(e.totals.conversions).toBe(10.5);
  });

  it("adds up rows that repeat a value rather than keeping the last", () => {
    const [e] = entitiesFromPerfRows([row, row]);
    expect(e.totals.clicks).toBe(52);
    expect(e.totals.cost).toBeCloseTo(1716.38);
  });

  it("drops rows with no dimension instead of inventing an empty one", () => {
    expect(entitiesFromPerfRows([{ ...row, dimension: "  " }, row])).toHaveLength(1);
  });

  it("survives a response that isn't rows at all", () => {
    expect(entitiesFromPerfRows([])).toEqual([]);
  });
});

describe("the insight under the evidence", () => {
  // It used to repeat the recommendation's own wording, which taught nobody
  // anything. The point of the table is the comparison, so the sentence states
  // it — and every figure in it has to come from the rows on screen.
  const a = run([breakdown("device", "Devices", "Device")]);
  const rec = a.recommendations.find((r) => r.entity === "device-dead")!;

  it("compares the flagged row against the ones shown beside it", () => {
    // The other three shown return 4x. The dead row's $1,000 would be $4,000.
    expect(rec.evidence!.insight).toContain("4.00x");
    expect(rec.evidence!.insight).toContain("$4,000");
  });

  it("does not simply repeat the recommendation", () => {
    expect(rec.evidence!.insight).not.toBe(rec.detail);
  });

  it("says so plainly when there is nothing to compare against", () => {
    const lone = run([
      {
        key: "solo",
        label: "Solo",
        singular: "Row",
        rows: [
          ...["A", "B", "C"].map((n) => entity(`solo-${n}`, { cost: 1_000, revenue: 4_000 })),
          entity("solo-dead", { cost: 1_000, revenue: 0 }),
        ],
      },
    ]);
    for (const r of lone.recommendations) expect(r.evidence!.insight.length).toBeGreaterThan(20);
  });

  it("counts conversions, not money, on a source with no spend", () => {
    const ga4 = goalMetricsFor("ga4");
    const noSpend = analyseAccount({
      categories: [
        {
          key: "channel",
          label: "Channels",
          singular: "Channel",
          rows: [
            entity("Organic", { clicks: 1_000, conversions: 50 }),
            entity("Direct", { clicks: 1_000, conversions: 50 }),
            entity("Social", { clicks: 1_000, conversions: 50 }),
            entity("Referral", { clicks: 1_000, conversions: 2 }),
          ],
        },
      ],
      focus: ga4.find((m) => m.key === "revenue")!,
      marginPct: 40,
      hasCost: false,
    });
    const r = noSpend.recommendations[0];
    expect(r.evidence!.insight).toContain("convert at");
    expect(r.evidence!.insight).not.toContain("$");
  });
});

describe("sorting categories by the kind of work they are", () => {
  // From the findings, not from a list of table names: cutting a losing search
  // term and cutting a losing device are the same job, and a source nobody has
  // seen yet still sorts correctly.
  it("puts a category full of waste under cost saving", () => {
    const a = run([breakdown("search_term", "Search Terms", "Search term")]);
    expect(a.categories[0].group).toBe("cost_saving");
  });

  it("puts one whose findings are all about scaling under growth", () => {
    const a = run([
      {
        key: "device",
        label: "Devices",
        singular: "Device",
        rows: [
          ...["A", "B", "C", "D"].map((n) =>
            entity(`d-${n}`, { cost: 1_000, revenue: 4_000, conversions: 40 }),
          ),
          entity("d-star", { cost: 1_000, revenue: 20_000, conversions: 200 }),
        ],
      },
    ]);
    expect(a.recommendations.every((r) => r.kind === "scale")).toBe(true);
    expect(a.categories[0].group).toBe("growth");
  });
});

describe("the list of entities you land on", () => {
  // A campaign at 20% with six figures behind it is the one to open, and that
  // judgement can't be made from a single account-wide number.
  const rows = [
    ...["A", "B", "C", "D"].map((n) =>
      entity(n, { cost: 1_000, revenue: 4_000, conversions: 40, clicks: 500 }),
    ),
    entity("Dead", { cost: 1_000, revenue: 0, conversions: 0, clicks: 400 }),
  ];
  const run1 = () => summariseEntities({ rows, focus, marginPct: 40, hasCost: true });

  it("gives every entity a line, not just the ones with findings", () => {
    expect(
      run1()
        .entities.map((e) => e.name)
        .sort(),
    ).toEqual(["A", "B", "C", "D", "Dead"]);
  });

  it("scores an entity against what it could be returning, not the account", () => {
    const { entities } = run1();
    // The healthy ones have nothing being missed.
    expect(entities.find((e) => e.name === "A")!.score).toBe(100);
    // The dead one is missing everything it could have returned.
    expect(entities.find((e) => e.name === "Dead")!.score).toBe(0);
  });

  it("counts the findings that are about that entity", () => {
    const { entities } = run1();
    expect(entities.find((e) => e.name === "Dead")!.count).toBeGreaterThan(0);
    expect(entities.find((e) => e.name === "A")!.count).toBe(0);
  });

  it("puts what is most at stake at the top", () => {
    expect(run1().entities[0].name).toBe("Dead");
  });

  it("lists a below-threshold entity as 'not enough data', not omitted", () => {
    // Dead has 400 clicks: a Clicks >= 500 threshold leaves it unqualified, but
    // it must still appear — scored 0, no findings, marked unqualified.
    const { entities } = summariseEntities({
      rows,
      focus,
      marginPct: 40,
      hasCost: true,
      thresholds: [{ metric: "clicks", op: "gte", value: 500 }],
    });
    const dead = entities.find((e) => e.name === "Dead")!;
    expect(dead).toBeDefined();
    expect(dead.qualified).toBe(false);
    expect(dead.count).toBe(0);
    expect(dead.impact).toBe(0);
    // The qualified ones (500 clicks) still come first.
    expect(entities[entities.length - 1].name).toBe("Dead");
  });

  it("drops an entity with no activity at all", () => {
    const { entities } = summariseEntities({
      rows: [...rows, entity("Empty", {})],
      focus,
      marginPct: 40,
      hasCost: true,
    });
    expect(entities.find((e) => e.name === "Empty")).toBeUndefined();
  });

  it("says how much of the account each one carries", () => {
    const { entities } = run1();
    const total = entities.reduce((a, e) => a + e.share, 0);
    expect(total).toBeCloseTo(1);
  });

  it("states the impact in the same units the recommendations do", () => {
    expect(run1().impactFormat).toBe("money");
  });
});

describe("reading the primary breakdown, from /api/windsor", () => {
  // /api/data only ever validated the SECONDARY tables — the primary entity
  // (campaigns, for Google Ads) has always been served by /api/windsor
  // instead, in raw units and under a connector-specific name.
  const row = {
    dimension: "Winter Sale Collection",
    clicks: 26,
    impressions: 269,
    conversions: 10.5,
    spend: 858.19,
    conversion_value: 10.5,
  };

  it("reads money as the account's own currency, not thousands", () => {
    const [e] = entitiesFromWindsorRows([row]);
    expect(e.totals.cost).toBeCloseTo(858.19);
    expect(e.totals.revenue).toBeCloseTo(10.5);
  });

  it("reads clicks, impressions and conversions under their raw names", () => {
    const [e] = entitiesFromWindsorRows([row]);
    expect(e.totals.clicks).toBe(26);
    expect(e.totals.impressions).toBe(269);
    expect(e.totals.conversions).toBe(10.5);
  });

  it("falls back to the connector's own field when there is no `dimension`", () => {
    // Google Ads' /api/windsor rows carry the name under `campaign`.
    const [e] = entitiesFromWindsorRows([{ ...row, dimension: undefined, campaign: "Sale" }]);
    expect(e.name).toBe("Sale");
  });

  it("adds up rows that repeat a name rather than keeping the last", () => {
    const [e] = entitiesFromWindsorRows([row, row]);
    expect(e.totals.clicks).toBe(52);
    expect(e.totals.cost).toBeCloseTo(1716.38);
  });

  it("drops rows with no name at all", () => {
    expect(entitiesFromWindsorRows([{ ...row, dimension: "  ", campaign: "" }])).toHaveLength(0);
  });
});

describe("the glyph beside each category", () => {
  // The spec draws one per category, and the list is built from whatever
  // breakdowns a source has — so every row needs one, including rows the spec
  // never named.
  it("uses the spec's own glyph for the categories it names", () => {
    expect(categoryIcon("keyword", "Keywords")).toBe("🔑");
    expect(categoryIcon("match_type", "Match Type Performance")).toBe("🎯");
    expect(categoryIcon("search_term", "Search Terms Performance")).toBe("🔍");
    expect(categoryIcon("device", "Device Performance")).toBe("📱");
    expect(categoryIcon("network", "Network Performance")).toBe("🌐");
    expect(categoryIcon("time", "Time Performance")).toBe("⏰");
    expect(categoryIcon("country", "Geography Performance")).toBe("🌍");
    expect(categoryIcon("ad_group", "Ad Groups Performance")).toBe("👥");
    expect(categoryIcon("ad", "Ad Performance")).toBe("📄");
    expect(categoryIcon("campaign", "Campaign Performance")).toBe("📊");
  });

  it("recognises a breakdown by its label when the key is one it has never seen", () => {
    // What an admin registers through the constructor.
    expect(categoryIcon("lp_perf", "Landing Pages")).toBe("🖼️");
    expect(categoryIcon("dim_7", "Product Performance")).toBe("📦");
    expect(categoryIcon("xyz", "Audience Segments")).toBe("👥");
  });

  it("falls back to the spec's Other glyph rather than leaving a gap", () => {
    expect(categoryIcon("wholly_unknown", "Zzz")).toBe("⋯");
  });

  it("never returns an empty string, whatever it is given", () => {
    for (const key of ["", "  ", "!!", "123"]) {
      expect(categoryIcon(key, "").length).toBeGreaterThan(0);
    }
  });

  it("gives every real Google Ads breakdown a glyph of its own kind", () => {
    // Nothing in the built-in set should land on the fallback.
    const keys = [
      "campaign",
      "ad_group",
      "ad",
      "campaign_type",
      "search_term",
      "match_type",
      "device",
      "network",
      "time",
      "country",
    ];
    for (const k of keys) expect(categoryIcon(k, "")).not.toBe("⋯");
  });
});
