// ─────────────────────────────────────────────────────────────────────────────
// AI Optimizer — where the account is losing ground against its goal.
//
// Every number here is computed from the account's own rows. Nothing is
// generated: a recommendation that says "$1,240 is going nowhere" can be
// checked against the data, and the phrasing layer on top is only allowed to
// reword, never to invent. An optimiser that made numbers up would be worse
// than none, because it would be believed.
//
// Source-agnostic by construction. Opportunities are found among the source's
// PRIMARY entities — campaigns for Google Ads, channels for GA4, queries for
// Search Console — and are expressed against whichever metric the account is
// being run for. A source with no ad spend is compared on what it does have.
// ─────────────────────────────────────────────────────────────────────────────

import { metricValue, type GoalMetricDef, type MetricTotals } from "./smartGoalMetrics";

/** One primary entity's numbers for the period. */
export interface EntityRow {
  name: string;
  totals: MetricTotals;
}

export type OpportunityKind =
  /** Real money going out with nothing coming back. */
  | "wasted_spend"
  /** Returning far less per unit of spend than the account's own norm. */
  | "underperformer"
  /** Beating the account's norm — the one worth more budget. */
  | "scale"
  /** Converting far below the account's norm, on a source with no spend. */
  | "weak_conversion";

export interface Opportunity {
  id: string;
  entity: string;
  kind: OpportunityKind;
  /** Plain statement of what was found. The phrasing layer may reword this. */
  title: string;
  /** The numbers behind it, so the claim can be checked. */
  detail: string;
  /** Estimated effect on the focus metric if acted on, in that metric's units.
   *  An estimate, and labelled as one wherever it's shown. */
  impact: number;
  /** Bigger is more urgent — what the list is ordered by. */
  weight: number;
}

/**
 * Why the optimizer has nothing to say. Collapsing these into one message
 * claimed "every row is performing in line with the account average" when there
 * were no rows at all — a statement about data that doesn't exist.
 */
export type QuietReason =
  /** The breakdown returned nothing for this period. */
  | "no_rows"
  /** Too few rows for "the account's norm" to mean anything. */
  | "too_few"
  /** Rows, but nothing to judge them by — no spend and no conversions. */
  | "no_basis"
  /** Genuinely nothing unusual: everything sits near the account's own rate. */
  | "in_line";

export interface OptimizerSummary {
  opportunities: Opportunity[];
  /** Set whenever `opportunities` is empty, saying which kind of nothing it is. */
  quietReason?: QuietReason;
  /** The four figures the goal forecast's summary line reports. */
  entitiesWithOpportunities: number;
  totalImpact: number;
  count: number;
  averageImpact: number;
  /** The metric every impact is expressed in. */
  impactMetric: string;
  impactMetricLabel: string;
}

/** An entity has to carry at least this share of the account's spend (or, on a
 *  spend-free source, its traffic) before it's worth a recommendation. Below
 *  it, the numbers are noise and acting on them is busywork. */
const MATERIAL_SHARE = 0.02;
/** …but a 2%-of-total bar is unmeetable on a high-cardinality breakdown: with
 *  tens of thousands of search terms, no single one is ever 2% of the account,
 *  so the whole breakdown would read healthy while thousands of terms quietly
 *  burn spend. So an entity also counts as material when its spend (or traffic)
 *  is at least this many times the average entity's — which surfaces the real
 *  outliers in a big breakdown without lowering the bar on a small one, where
 *  the 2% floor is the looser of the two and still governs. */
const MATERIAL_VS_AVG = 4;
/** Whether one entity's spend/traffic is big enough to act on: a real share of
 *  the whole, OR well above the typical entity in its own breakdown. */
const isMaterial = (value: number, scopeTotal: number, entityCount: number) =>
  scopeTotal > 0 &&
  (value / scopeTotal >= MATERIAL_SHARE ||
    (entityCount > 0 && value >= (scopeTotal / entityCount) * MATERIAL_VS_AVG));
/** How far from the account's own norm counts as "far". */
const UNDERPERFORM_RATIO = 0.5;
const OVERPERFORM_RATIO = 1.5;
// Extra budget does NOT keep earning the entity's full current ROAS — marginal
// returns diminish as you scale. A "scale up" projection assumes the added spend
// converts at only this fraction of the current rate, so the quoted impact is a
// conservative estimate rather than a flat same-rate extrapolation (which
// overstates it — the headline number a review flagged as "a marketing figure").
// Tunable.
const SCALE_MARGINAL_FACTOR = 0.6;
/** Nothing is claimed from fewer than this many entities: with two or three,
 *  "the account's norm" is just one of them. */
const MIN_ENTITIES = 4;

const sum = (rows: EntityRow[], pick: (t: MetricTotals) => number) =>
  rows.reduce((a, r) => a + pick(r.totals), 0);

const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

/**
 * Find what's worth acting on.
 *
 * The comparisons are always against the account's OWN aggregate for the
 * period — never against an outside benchmark, which wouldn't know the
 * business. So "underperforming" means underperforming this account, this
 * month, which is the only claim the data supports.
 */
export function findOpportunities(args: {
  rows: EntityRow[];
  /** The metric the account is being run for. Impacts are expressed in it when
   *  that's meaningful — see impactBasis. */
  focus: GoalMetricDef;
  marginPct: number;
  /** True when the source reports ad spend — it changes what "waste" means. */
  hasCost: boolean;
  /** Judge `rows` against THIS set's aggregate rate instead of their own.
   *
   *  Used to score one campaign's sub-entities (its search terms, ad groups)
   *  against the WHOLE account rather than against each other — "this search
   *  term returns 0.1x vs the account's 0.4x" is the meaningful claim, and a
   *  campaign with only two search terms has no norm of its own to compare to.
   *  Defaults to `rows` (compare against themselves), which is the account-level
   *  behaviour and leaves every existing caller unchanged. */
  benchmark?: EntityRow[];
  /** A row may only become a flagged opportunity when this returns true — the AI
   *  Optimization Threshold (e.g. Clicks ≥ 50 AND Profit < 0). Every row still
   *  counts toward the account's norm, materiality and the evidence table's
   *  context; only which rows get FLAGGED and counted as savings is gated. Absent
   *  → every row is eligible, the original behaviour. */
  flaggable?: (t: MetricTotals) => boolean;
  /** Max flagged opportunities to keep (by weight). Default 12. A consolidated
   *  table passes a high value so its single card can list every qualifying row. */
  limit?: number;
}): OptimizerSummary {
  const { rows, focus, marginPct, hasCost } = args;
  // How many flagged opportunities a breakdown may produce. Small by default so a
  // per-entity breakdown doesn't spawn dozens of cards; a consolidated table
  // (one card listing every qualifying row) passes a high limit so it can flag
  // ALL the rows that meet the threshold, not just the top few.
  const limit = args.limit ?? 12;
  // The rows whose aggregate sets the bar. Same as `rows` unless a caller passed
  // an outside benchmark (a scoped list judged against the account).
  const bench = args.benchmark ?? rows;
  const scoped = args.benchmark != null;
  // A ratio can't be moved BY an amount: "+0.4 ROAS" from one campaign is not a
  // number the data supports. Those fall back to the amount that actually
  // changes hands, which is the honest thing to quote.
  //
  // Which unit a gap comes out in depends on the branch below: money where
  // there's spend to judge, conversions where there isn't. Conflating the two
  // would put a conversion count under a dollar sign.
  const costBranch = hasCost && sum(bench, (t) => t.cost) > 0;
  const revenuePerConv = (() => {
    const c = sum(bench, (t) => t.conversions);
    return c > 0 ? sum(bench, (t) => t.revenue) / c : 0;
  })();
  const basis = impactBasis(focus, costBranch, revenuePerConv);
  const impactMetric = basis.key;

  const empty = (quietReason: QuietReason): OptimizerSummary => ({
    opportunities: [],
    quietReason,
    entitiesWithOpportunities: 0,
    totalImpact: 0,
    count: 0,
    averageImpact: 0,
    impactMetric,
    impactMetricLabel: basis.label,
  });
  if (rows.length === 0) return empty("no_rows");
  // The "too few to have a norm" guard only applies when the rows ARE the norm.
  // With an outside benchmark the norm is the account's, so a campaign with one
  // or two entities is judged fine against it.
  if (!scoped && rows.length < MIN_ENTITIES) return empty("too_few");

  // Rates come from the benchmark (the account, when scoped). Materiality is
  // judged within the SCOPE being reported on — a search term that's a rounding
  // error against the whole account can still be the bulk of its own campaign,
  // and dropping it would leave the campaign looking clean.
  const totalCost = sum(bench, (t) => t.cost);
  const totalClicks = sum(bench, (t) => t.clicks);
  const totalRevenue = sum(bench, (t) => t.revenue);
  const totalConv = sum(bench, (t) => t.conversions);
  const scopeCost = scoped ? sum(rows, (t) => t.cost) : totalCost;
  const scopeClicks = scoped ? sum(rows, (t) => t.clicks) : totalClicks;

  const found: Opportunity[] = [];

  if (costBranch) {
    // Return per unit of spend, across the whole account — the bar each entity
    // is held to.
    const accountReturn = totalRevenue / totalCost;

    for (const row of rows) {
      const { cost, revenue, conversions } = row.totals;
      // What's worth flagging: when a threshold is set (flaggable) IT is the bar —
      // the admin's "≥50 clicks AND loss" already filters noise, so the built-in
      // 2%-materiality heuristic on top would wrongly drop qualifying low-cost
      // rows. With no threshold, materiality decides. Rows that fail the gate
      // still shaped the account norm above and remain as evidence context.
      if (args.flaggable ? !args.flaggable(row.totals) : !isMaterial(cost, scopeCost, rows.length))
        continue;

      // Spend with nothing to show for it. Impact = what that spend would return
      // at the account's own rate, BUT never less than the spend itself: on an
      // account that returns nothing yet (accountReturn ≈ 0 — a new Meta account,
      // conversions not tracked), the gap-to-rate is 0, which zeroed the impact
      // and filtered the finding out entirely, so a whole source showed "0
      // recommendations". The wasted spend IS the loss, so quote at least that.
      if (revenue === 0 && conversions === 0) {
        const gap = Math.max(cost * accountReturn - revenue, cost - revenue);
        found.push({
          id: `waste-${row.name}`,
          entity: row.name,
          kind: "wasted_spend",
          title: `${row.name} spent ${money(cost)} and returned nothing`,
          detail: `${money(cost)} of spend, no conversions and no revenue in this period. At the account's own return of ${accountReturn.toFixed(2)}x, that spend would be worth ${money(cost * accountReturn)}.`,
          impact: impactIn(basis.key, {
            gapRevenue: gap,
            row,
            marginPct,
            revenuePerConv,
          }),
          weight: gap * 1.25,
        });
        continue;
      }

      const entityReturn = revenue / cost;
      // What counts as "underperforming". Normally it's being FAR below the
      // account's rate (< half). But once a threshold gates flagging, the
      // threshold IS the selector — a row that met it (e.g. Clicks ≥ 50 AND
      // Profit < 0) must be flagged even if it has conversions and sits only a
      // little below the rate, so here the bar is simply "below the rate". Scale
      // is reserved for genuinely profitable rows, so a threshold-flagged loss
      // can't be mislabelled "scale up".
      const underBar = args.flaggable ? accountReturn : accountReturn * UNDERPERFORM_RATIO;
      const profitable = revenue >= cost;
      if (accountReturn > 0 && entityReturn < underBar) {
        // Bringing it merely to the account's average is the conservative
        // claim — not to the best performer's rate, which nothing supports.
        // Never negative: a row just under the rate would give a tiny/negative
        // gap, so fall back to the loss it's actually running (cost − revenue).
        const gap = Math.max(cost * accountReturn - revenue, cost - revenue);
        found.push({
          id: `under-${row.name}`,
          entity: row.name,
          kind: "underperformer",
          title: `${row.name} returns ${entityReturn.toFixed(2)}x against the account's ${accountReturn.toFixed(2)}x`,
          detail: `${money(cost)} spent for ${money(revenue)} back. At the account's own rate the same spend would return ${money(cost * accountReturn)}.`,
          impact: impactIn(basis.key, { gapRevenue: gap, row, marginPct, revenuePerConv }),
          weight: gap,
        });
      } else if (
        profitable &&
        entityReturn > accountReturn * (args.flaggable ? 1 : OVERPERFORM_RATIO) &&
        revenue > 0
      ) {
        // The one worth more budget. Modest step (+20% of spend), and the added
        // spend is assumed to convert at only SCALE_MARGINAL_FACTOR of the
        // current rate — marginal returns diminish, so a flat same-rate
        // projection overstates the gain. marginalProfit ≤ 0 (scaling not worth
        // it under the conservative assumption) is dropped by the impact > 0
        // filter below.
        const extra = cost * 0.2;
        const marginalProfit = extra * entityReturn * SCALE_MARGINAL_FACTOR - extra;
        found.push({
          id: `scale-${row.name}`,
          entity: row.name,
          kind: "scale",
          title: `${row.name} returns ${entityReturn.toFixed(2)}x, above the account's ${accountReturn.toFixed(2)}x`,
          detail: `${money(cost)} spent for ${money(revenue)} back. A further ${money(extra)} in budget could add more profit even after allowing for diminishing returns on the new spend.`,
          impact: impactIn(basis.key, {
            gapRevenue: marginalProfit,
            row,
            marginPct,
            revenuePerConv,
          }),
          // A projected lift is a weaker claim than money already being wasted.
          weight: marginalProfit * 0.9,
        });
      } else if (args.flaggable) {
        // A threshold-flagged row that is neither clearly below the rate nor
        // genuinely profitable (e.g. a loss sitting just above the account's own
        // losing rate) still MET the threshold, so it must be flagged — the
        // threshold is the sole selector. Framed as a below-rate loss to reduce.
        const gap = Math.max(cost * accountReturn - revenue, cost - revenue, 0);
        found.push({
          id: `under-${row.name}`,
          entity: row.name,
          kind: "underperformer",
          title: `${row.name} returns ${entityReturn.toFixed(2)}x on ${money(cost)} of spend`,
          detail: `${money(cost)} spent for ${money(revenue)} back — an ad profit of ${money(revenue - cost)} below break-even this period.`,
          impact: impactIn(basis.key, { gapRevenue: gap, row, marginPct, revenuePerConv }),
          weight: gap,
        });
      }
    }
  } else if (totalClicks === 0 || totalConv === 0) {
    // No spend to judge efficiency by and no conversions to judge traffic by:
    // there is nothing here to compare rows on, which is not the same as
    // saying they all look fine.
    return empty("no_basis");
  } else {
    // No spend to judge efficiency by, so the comparison is how well each
    // entity converts the traffic it gets, against the account's own rate.
    const accountRate = totalConv / totalClicks;
    for (const row of rows) {
      const { clicks, conversions } = row.totals;
      if (clicks === 0) continue;
      if (
        args.flaggable ? !args.flaggable(row.totals) : !isMaterial(clicks, scopeClicks, rows.length)
      )
        continue;
      const rate = conversions / clicks;
      // Same rule as the cost branch: normally flag only rates FAR below the
      // account's (< half); once a threshold gates flagging, the threshold is the
      // selector, so any threshold-meeting row below the rate is flagged.
      const weakBar = args.flaggable ? accountRate : accountRate * UNDERPERFORM_RATIO;
      if (rate < weakBar) {
        const missing = Math.max(clicks * accountRate - conversions, 0);
        found.push({
          id: `weak-${row.name}`,
          entity: row.name,
          kind: "weak_conversion",
          title: `${row.name} converts at ${(rate * 100).toFixed(2)}% against the account's ${(accountRate * 100).toFixed(2)}%`,
          detail: `${Math.round(clicks).toLocaleString("en-US")} sessions produced ${conversions.toFixed(0)} conversions. At the account's own rate that traffic would produce more (monthly potential shown above).`,
          impact: impactIn(basis.key, { gapConv: missing, row, marginPct, revenuePerConv }),
          weight: missing,
        });
      }
    }
  }

  const opportunities = found
    .filter((o) => o.impact > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);

  if (opportunities.length === 0) return empty("in_line");

  const totalImpact = opportunities.reduce((a, o) => a + o.impact, 0);
  return {
    opportunities,
    entitiesWithOpportunities: new Set(opportunities.map((o) => o.entity)).size,
    totalImpact,
    count: opportunities.length,
    averageImpact: opportunities.length > 0 ? totalImpact / opportunities.length : 0,
    impactMetric,
    impactMetricLabel: basis.label,
  };
}

/**
 * Which metric an impact can honestly be stated in.
 *
 * The focus metric when the data can carry it there, and otherwise whatever
 * actually changes hands. A ratio never can: "+0.4 ROAS from this campaign" is
 * not something the rows support. And on a source with no revenue at all, money
 * can't be quoted whatever the goal says — the finding is in conversions.
 */
function impactBasis(
  focus: GoalMetricDef,
  costBranch: boolean,
  revenuePerConv: number,
): { key: string; label: string } {
  const moneyLike = ["revenue", "profit", "net_profit", "cost"];
  const quotableInMoney = costBranch || revenuePerConv > 0;
  if (focus.key === "conv") return { key: "conv", label: focus.label };
  if (moneyLike.includes(focus.key) && quotableInMoney)
    return { key: focus.key, label: focus.label };
  if (quotableInMoney) return { key: "revenue", label: "Revenue" };
  return { key: "conv", label: "Conversions" };
}

/**
 * Translate a gap measured in revenue (or conversions) into the metric the
 * account is actually being run for.
 *
 * A revenue target and a profit target are moved by the same finding to
 * different degrees, and a spend target is moved the other way entirely — so
 * the same opportunity is worth stating in the user's own terms rather than
 * always in dollars.
 */
function impactIn(
  basisKey: string,
  args: {
    /** The finding, in money. Set by the spend branch. */
    gapRevenue?: number;
    /** The finding, in conversions. Set by the traffic branch. */
    gapConv?: number;
    row: EntityRow;
    marginPct: number;
    /** The account's own revenue per conversion, for moving between the two. */
    revenuePerConv: number;
  },
): number {
  const { gapRevenue, gapConv, row, marginPct, revenuePerConv } = args;
  // Whichever unit the finding arrived in, expressed in both where the data
  // allows it. Where it doesn't, the missing one stays zero and the caller's
  // filter drops the opportunity rather than quoting a number nothing supports.
  const perConv =
    row.totals.conversions > 0 && row.totals.revenue > 0
      ? row.totals.revenue / row.totals.conversions
      : revenuePerConv;
  const inRevenue = gapRevenue ?? (gapConv ?? 0) * perConv;
  const inConv = gapConv ?? (perConv > 0 ? (gapRevenue ?? 0) / perConv : 0);

  switch (basisKey) {
    case "revenue":
    case "profit":
      return inRevenue;
    case "net_profit":
      return inRevenue * (marginPct / 100);
    case "conv":
      return inConv;
    case "cost":
      // A spend goal is helped by NOT spending the part that returns nothing.
      return row.totals.revenue === 0 ? row.totals.cost : 0;
    default:
      // An admin-registered metric with no known relationship to either —
      // nothing can be claimed about how far this would move it.
      return metricValue(basisKey, row.totals, marginPct) > 0 ? inRevenue : 0;
  }
}
