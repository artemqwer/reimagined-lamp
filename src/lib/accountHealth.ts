// The eight axes the design draws on the account-health radar: Budget,
// Bidding, Keywords, Ads, Targeting, Tracking, Structure, Extensions.
//
// These are not performance breakdowns — they ask whether the account is SET
// UP well, which is a different question from whether last month went well.
// That is why they could not be derived from the numbers the dashboard
// already had: an account can spend efficiently while losing half its
// impressions to a budget cap, and no amount of cost/conversion arithmetic
// would say so.
//
// Every axis here is computed from a field Google itself reports — lost
// impression share, ad strength, bidding strategy, asset presence — reached
// through Windsor. Nothing is estimated or inferred from a name.
//
// An axis that cannot be judged returns a null score and says why. It is never
// drawn at zero: zero means "set up badly", and reporting silence as failure
// would be a lie that looks like a measurement.

export type HealthRow = Record<string, unknown>;

export interface HealthAxis {
  key: string;
  label: string;
  /** 0-100, or null when the source could not answer for this axis. */
  score: number | null;
  /** What the score is saying, in words — shown under the radar. */
  note: string;
}

/** The axis order the design draws, clockwise from the top. */
export const HEALTH_AXIS_ORDER = [
  "budget",
  "bidding",
  "keywords",
  "ads",
  "targeting",
  "tracking",
  "structure",
  "extensions",
] as const;

export type HealthAxisKey = (typeof HEALTH_AXIS_ORDER)[number];

const LABELS: Record<HealthAxisKey, string> = {
  budget: "Budget",
  bidding: "Bidding",
  keywords: "Keywords",
  ads: "Ads",
  targeting: "Targeting",
  tracking: "Tracking",
  structure: "Structure",
  extensions: "Extensions",
};

// ── small readers ────────────────────────────────────────────────────────────
// Windsor sends numbers as numbers or as strings depending on the field, and
// sends a field the account does not populate as null. Both have to survive.

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function has(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

/**
 * A "how much of this is good" score.
 *
 * Only a clean sweep scores 100. Rounding let $4 of waste on $14K report a
 * perfect score beside a note that named the waste, which reads as the number
 * contradicting the sentence under it — so anything short of everything is
 * held at 99 or below.
 */
function shareScore(good: number, whole: number): number {
  if (whole <= 0) return 0;
  if (good >= whole) return 100;
  return Math.max(0, Math.min(99, Math.floor((good / whole) * 100)));
}

function money(n: number): string {
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`;
}

/**
 * Spend-weighted average of a share-of-impressions field.
 *
 * Weighted, not a plain mean, because a dormant campaign losing 90% of its
 * impressions to a $1 budget is not the equal of the campaign carrying the
 * account. Rows where the field is null are skipped rather than read as zero —
 * Google leaves it null when it has nothing to report, and counting that as
 * "lost nothing" would quietly inflate every score.
 */
function weightedShare(
  rows: HealthRow[],
  field: string,
  weightField = "cost",
): { share: number; weight: number } | null {
  let weighted = 0;
  let weight = 0;
  for (const r of rows) {
    if (!has(r[field])) continue;
    const w = num(r[weightField]);
    if (w <= 0) continue;
    weighted += num(r[field]) * w;
    weight += w;
  }
  if (weight <= 0) return null;
  return { share: weighted / weight, weight };
}

/** Total of a field over rows, for "is there anything here at all" checks. */
function total(rows: HealthRow[], field: string): number {
  return rows.reduce((s, r) => s + num(r[field]), 0);
}

/**
 * Spend that reached a converting slice, over all spend.
 *
 * Used for the axes judged on where the money went (keywords, targeting).
 * Returns null when the account recorded no conversions at all in the period:
 * the ratio is then 0 for everyone, which would read as a damning score when
 * it actually means there was nothing to divide by.
 */
function convertingSpendShare(
  rows: HealthRow[],
  keyField: string,
  spendField: string,
): { score: number; spend: number; wasted: number } | null {
  if (total(rows, "conversions") <= 0) return null;
  const bySlice = new Map<string, { spend: number; conv: number }>();
  for (const r of rows) {
    const k = str(r[keyField]) || "—";
    const cur = bySlice.get(k) ?? { spend: 0, conv: 0 };
    cur.spend += num(r[spendField]);
    cur.conv += num(r.conversions);
    bySlice.set(k, cur);
  }
  let spend = 0;
  let wasted = 0;
  for (const s of bySlice.values()) {
    spend += s.spend;
    if (s.conv <= 0) wasted += s.spend;
  }
  if (spend <= 0) return null;
  return { score: shareScore(spend - wasted, spend), spend, wasted };
}

// ── the axes ─────────────────────────────────────────────────────────────────

/** Budget: how much of the account's reach its budgets are capping off. */
export function scoreBudget(rows: HealthRow[]): HealthAxis {
  const lost = weightedShare(rows, "search_budget_lost_impression_share");
  if (!lost)
    return {
      key: "budget",
      label: LABELS.budget,
      score: null,
      note: "This account does not report budget lost impression share.",
    };
  const capped = lost.share * 100;
  const worst = rows
    .filter((r) => num(r.cost) > 0 && has(r.search_budget_lost_impression_share))
    .sort(
      (a, b) =>
        num(b.search_budget_lost_impression_share) - num(a.search_budget_lost_impression_share),
    )[0];
  const worstShare = worst ? num(worst.search_budget_lost_impression_share) * 100 : 0;
  return {
    key: "budget",
    label: LABELS.budget,
    score: Math.round(100 - capped),
    note:
      capped < 1
        ? "Budgets are not holding back delivery."
        : `${capped.toFixed(1)}% of impressions lost to budget caps${
            worst && worstShare > capped
              ? ` — worst on "${str(worst.campaign)}" at ${worstShare.toFixed(0)}%`
              : ""
          }.`,
  };
}

/** Bidding: how much reach the bids are losing on rank rather than budget. */
export function scoreBidding(rows: HealthRow[]): HealthAxis {
  const lost = weightedShare(rows, "search_rank_lost_impression_share");
  const strategies = [...new Set(rows.map((r) => str(r.bidding_strategy_type)).filter(Boolean))];
  const manual = strategies.filter((s) => s.startsWith("MANUAL"));
  if (!lost)
    return {
      key: "bidding",
      label: LABELS.bidding,
      score: null,
      note: strategies.length
        ? `Strategies in use: ${strategies.join(", ").toLowerCase().replace(/_/g, " ")}. No rank lost impression share reported.`
        : "This account does not report rank lost impression share.",
    };
  const capped = lost.share * 100;
  return {
    key: "bidding",
    label: LABELS.bidding,
    score: Math.round(100 - capped),
    note: `${capped.toFixed(0)}% of impressions lost to ad rank${
      manual.length
        ? `, with ${manual.length === strategies.length ? "all" : "some"} bidding still manual`
        : ""
    }.`,
  };
}

/** Keywords: the share of keyword spend that bought a conversion. */
export function scoreKeywords(rows: HealthRow[]): HealthAxis {
  const r = convertingSpendShare(rows, "keyword_text", "spend");
  if (!r)
    return {
      key: "keywords",
      label: LABELS.keywords,
      score: null,
      note: rows.length
        ? "No conversions recorded against keywords in this period."
        : "This account does not expose keyword-level data.",
    };
  return {
    key: "keywords",
    label: LABELS.keywords,
    score: r.score,
    note:
      r.wasted > 0
        ? `${money(r.wasted)} of ${money(r.spend)} went to keywords with no conversions.`
        : "Every keyword with spend produced conversions.",
  };
}

/**
 * Ads: Google's own ad strength grade, weighted by the impressions each ad
 * actually served. PENDING and unrated ads are skipped, not scored as bad.
 */
const AD_STRENGTH: Record<string, number> = {
  EXCELLENT: 100,
  GOOD: 80,
  AVERAGE: 60,
  POOR: 25,
};

export function scoreAds(rows: HealthRow[]): HealthAxis {
  let weighted = 0;
  let weight = 0;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const grade = str(r.ad_strength).toUpperCase();
    const value = AD_STRENGTH[grade];
    if (value === undefined) continue;
    const imps = num(r.impressions);
    if (imps <= 0) continue;
    weighted += value * imps;
    weight += imps;
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  if (weight <= 0)
    return {
      key: "ads",
      label: LABELS.ads,
      score: null,
      note: "No ads in this period carry a strength rating.",
    };
  const weak = (counts.get("POOR") ?? 0) + (counts.get("AVERAGE") ?? 0);
  const graded = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    key: "ads",
    label: LABELS.ads,
    score: Math.round(weighted / weight),
    note: weak
      ? `${weak} of ${graded} rated ads are average or poor by Google's ad strength.`
      : `All ${graded} rated ads are good or excellent.`,
  };
}

/** Targeting: the share of spend that reached a device segment that converts. */
export function scoreTargeting(rows: HealthRow[]): HealthAxis {
  const r = convertingSpendShare(rows, "device", "cost");
  if (!r)
    return {
      key: "targeting",
      label: LABELS.targeting,
      score: null,
      note: rows.length
        ? "No conversions recorded in this period, so targeting cannot be judged on outcome."
        : "This account does not expose device-level data.",
    };
  return {
    key: "targeting",
    label: LABELS.targeting,
    score: r.score,
    note:
      r.wasted > 0
        ? `${money(r.wasted)} of ${money(r.spend)} went to devices that produced no conversions.`
        : "Every device segment with spend produced conversions.",
  };
}

/**
 * Tracking: how much of the spend runs through a campaign that reports
 * conversions against a real conversion action.
 *
 * A campaign missing from the conversion-action rows is untracked OR simply
 * had no conversions this period — the two are not separable from this data,
 * so the note says what was measured rather than claiming the setup is broken.
 */
export function scoreTracking(spendRows: HealthRow[], actionRows: HealthRow[]): HealthAxis {
  const spendByCampaign = new Map<string, number>();
  for (const r of spendRows) {
    const c = str(r.campaign);
    if (!c) continue;
    spendByCampaign.set(c, (spendByCampaign.get(c) ?? 0) + num(r.cost));
  }
  const tracked = new Set(
    actionRows.filter((r) => has(r.conversion_action)).map((r) => str(r.campaign)),
  );
  let spend = 0;
  let untracked = 0;
  let untrackedCount = 0;
  for (const [campaign, s] of spendByCampaign) {
    if (s <= 0) continue;
    spend += s;
    if (!tracked.has(campaign)) {
      untracked += s;
      untrackedCount += 1;
    }
  }
  if (spend <= 0)
    return {
      key: "tracking",
      label: LABELS.tracking,
      score: null,
      note: "No spend in this period to trace to a conversion action.",
    };
  return {
    key: "tracking",
    label: LABELS.tracking,
    score: shareScore(spend - untracked, spend),
    note: untracked
      ? `${money(untracked)} of ${money(spend)} was spent by ${untrackedCount} campaign${
          untrackedCount === 1 ? "" : "s"
        } that recorded no conversion action.`
      : "Every spending campaign reports against a conversion action.",
  };
}

/**
 * Structure: how far the spend is spread across the ad groups carrying it.
 *
 * An account funnelling nearly everything through one ad group has a single
 * point of failure and no room to segment message or targeting; one spreading
 * evenly across the groups it has is doing what the structure is for.
 *
 * Scored against the best that account's own group count allows: with four
 * groups an even split puts 25% in the largest, and that is full marks — it
 * would be meaningless to ask a four-group account to look like a forty-group
 * one. A single ad group is not scored at all, because there is nothing to
 * spread across and a zero would read as a verdict on a shape that may be
 * perfectly correct (a Shopping or Performance Max campaign has exactly one).
 *
 * What this deliberately does NOT measure is ads per ad group, though that is
 * the more standard audit question. Windsor returns exactly one ad id per ad
 * group here — 26 groups, 26 ads, and still one apiece over six months —
 * which means the field reports the ad that served, not the ads that exist.
 * Scoring it would have declared every ad group in the account untested on
 * the strength of a column that cannot say so.
 */
export function scoreStructure(rows: HealthRow[]): HealthAxis {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const g = str(r.ad_group);
    if (!g) continue;
    groups.set(g, (groups.get(g) ?? 0) + num(r.cost));
  }
  const active = [...groups.values()].filter((s) => s > 0).sort((a, b) => b - a);
  const spend = active.reduce((a, b) => a + b, 0);
  if (spend <= 0)
    return {
      key: "structure",
      label: LABELS.structure,
      score: null,
      note: "No ad groups with spend in this period.",
    };
  if (active.length < 2)
    return {
      key: "structure",
      label: LABELS.structure,
      score: null,
      note: "All spend runs through a single ad group, so there is nothing to spread across.",
    };
  const topShare = active[0] / spend;
  const evenShare = 1 / active.length;
  // 1 when the split is even or better, 0 when one group holds everything.
  const spread = (1 - topShare) / (1 - evenShare);
  return {
    key: "structure",
    label: LABELS.structure,
    score: Math.max(0, Math.min(100, Math.round(spread * 100))),
    note: `The largest of ${active.length} active ad groups holds ${Math.round(topShare * 100)}% of the spend (an even split would be ${Math.round(evenShare * 100)}%).`,
  };
}

/** Extensions: the share of spend behind campaigns that serve assets at all. */
export function scoreExtensions(rows: HealthRow[]): HealthAxis {
  const byCampaign = new Map<string, { spend: number; assets: Set<string> }>();
  for (const r of rows) {
    const c = str(r.campaign);
    if (!c) continue;
    const cur = byCampaign.get(c) ?? { spend: 0, assets: new Set<string>() };
    cur.spend += num(r.cost);
    const t = str(r.asset_type);
    if (t) cur.assets.add(t);
    byCampaign.set(c, cur);
  }
  let spend = 0;
  let bare = 0;
  let bareCount = 0;
  for (const c of byCampaign.values()) {
    if (c.spend <= 0) continue;
    spend += c.spend;
    if (c.assets.size === 0) {
      bare += c.spend;
      bareCount += 1;
    }
  }
  if (spend <= 0)
    return {
      key: "extensions",
      label: LABELS.extensions,
      score: null,
      note: "No spend in this period to check for assets.",
    };
  const withSpend = [...byCampaign.values()].filter((c) => c.spend > 0).length;
  return {
    key: "extensions",
    label: LABELS.extensions,
    score: shareScore(spend - bare, spend),
    note: bareCount
      ? `${bareCount} of ${withSpend} spending campaigns serve no assets — ${money(bare)} with no sitelinks, callouts or images.`
      : `All ${withSpend} spending campaigns serve assets.`,
  };
}

export interface HealthInput {
  /** campaign, cost, conversions, budget + lost-impression-share fields */
  delivery: HealthRow[];
  /** campaign, ad_strength, impressions */
  ads: HealthRow[];
  /** campaign, ad_group, cost */
  structure: HealthRow[];
  /** campaign, device, cost, conversions */
  targeting: HealthRow[];
  /** campaign, conversion_action, conversions */
  tracking: HealthRow[];
  /** campaign, asset_type, cost */
  extensions: HealthRow[];
  /** keyword_text, spend, conversions — empty when the source has no keyword view */
  keywords: HealthRow[];
}

/**
 * Which fetched views each axis is built from.
 *
 * Needed because "the view came back empty" and "the view could not be read"
 * are different facts with the same shape — an empty array — and only one of
 * them licenses a sentence about the account. Saying "no ad groups had spend"
 * because a request timed out is a claim made from a network failure.
 */
export const AXIS_VIEWS: Record<HealthAxisKey, (keyof HealthInput)[]> = {
  budget: ["delivery"],
  bidding: ["delivery"],
  keywords: ["keywords"],
  ads: ["ads"],
  targeting: ["targeting"],
  tracking: ["delivery", "tracking"],
  structure: ["structure"],
  extensions: ["extensions"],
};

/** All eight, in the order the radar draws them. */
export function scoreHealthAxes(
  input: HealthInput,
  /** Views whose fetch failed, as opposed to returning no rows. */
  unreadable: ReadonlySet<keyof HealthInput> = new Set(),
): HealthAxis[] {
  const byKey: Record<HealthAxisKey, HealthAxis> = {
    budget: scoreBudget(input.delivery),
    bidding: scoreBidding(input.delivery),
    keywords: scoreKeywords(input.keywords),
    ads: scoreAds(input.ads),
    targeting: scoreTargeting(input.targeting),
    tracking: scoreTracking(input.delivery, input.tracking),
    structure: scoreStructure(input.structure),
    extensions: scoreExtensions(input.extensions),
  };
  return HEALTH_AXIS_ORDER.map((k) => {
    if (AXIS_VIEWS[k].some((v) => unreadable.has(v)))
      return {
        key: k,
        label: LABELS[k],
        score: null,
        note: "This could not be read from the source just now — try again in a moment.",
      };
    return byKey[k];
  });
}

/**
 * One number for the whole account: the mean of the axes that could be judged.
 *
 * Null axes are left out rather than counted as zero, so an account whose
 * source hides half these fields is not punished for its connector's limits.
 */
export function overallHealth(axes: HealthAxis[]): number | null {
  const scored = axes.filter((a) => a.score !== null).map((a) => a.score as number);
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}
