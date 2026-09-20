import {
  scoreBudget,
  scoreBidding,
  scoreKeywords,
  scoreAds,
  scoreTargeting,
  scoreTracking,
  scoreStructure,
  scoreExtensions,
  scoreHealthAxes,
  overallHealth,
  HEALTH_AXIS_ORDER,
} from "@/lib/accountHealth";
import { connectorHasFeature } from "@/lib/connectors";

// The row shapes below are the ones Windsor actually returned for a live
// Google Ads account — including the awkward parts: shares arriving as
// numbers, a campaign whose lost-impression-share is null because Google had
// nothing to report, and an asset_type of null meaning "serves no assets".

describe("scoreBudget", () => {
  it("weights lost impression share by spend, not by campaign count", () => {
    // The dormant campaign loses almost everything to a tiny budget; the one
    // carrying the account loses nothing. An unweighted mean would call this
    // account 50/100 on the strength of a campaign spending $1.
    const axis = scoreBudget([
      { campaign: "Big", cost: 10000, search_budget_lost_impression_share: 0 },
      { campaign: "Dormant", cost: 1, search_budget_lost_impression_share: 0.98 },
    ]);
    expect(axis.score).toBe(100);
  });

  it("scores the capped share against 100", () => {
    const axis = scoreBudget([
      { campaign: "A", cost: 100, search_budget_lost_impression_share: 0.25 },
    ]);
    expect(axis.score).toBe(75);
    expect(axis.note).toMatch(/25\.0% of impressions lost to budget caps/);
  });

  it("skips rows where Google reported nothing rather than reading null as zero", () => {
    // Counting the null as "lost nothing" would score this a perfect 100.
    const axis = scoreBudget([
      { campaign: "Reported", cost: 100, search_budget_lost_impression_share: 0.4 },
      { campaign: "Silent", cost: 900, search_budget_lost_impression_share: null },
    ]);
    expect(axis.score).toBe(60);
  });

  it("returns no score when the account reports the field for nothing", () => {
    const axis = scoreBudget([
      { campaign: "A", cost: 100, search_budget_lost_impression_share: null },
    ]);
    expect(axis.score).toBeNull();
    expect(axis.note).toMatch(/does not report/i);
  });

  it("names the worst campaign when one is dragging the account", () => {
    const axis = scoreBudget([
      { campaign: "Fine", cost: 1000, search_budget_lost_impression_share: 0.05 },
      { campaign: "Starved", cost: 500, search_budget_lost_impression_share: 0.7 },
    ]);
    expect(axis.note).toContain("Starved");
  });
});

describe("scoreBidding", () => {
  it("scores rank-lost impression share and flags manual bidding", () => {
    const axis = scoreBidding([
      {
        campaign: "Search",
        cost: 100,
        search_rank_lost_impression_share: 0.9,
        bidding_strategy_type: "MANUAL_CPC",
      },
    ]);
    expect(axis.score).toBe(10);
    expect(axis.note).toMatch(/manual/);
  });

  it("does not call bidding manual when it is automated", () => {
    const axis = scoreBidding([
      {
        campaign: "Auto",
        cost: 100,
        search_rank_lost_impression_share: 0.2,
        bidding_strategy_type: "MAXIMIZE_CONVERSIONS",
      },
    ]);
    expect(axis.score).toBe(80);
    expect(axis.note).not.toMatch(/manual/);
  });

  it("still reports the strategies when rank share is missing", () => {
    const axis = scoreBidding([{ campaign: "A", cost: 10, bidding_strategy_type: "TARGET_ROAS" }]);
    expect(axis.score).toBeNull();
    expect(axis.note).toMatch(/target roas/);
  });
});

describe("scoreAds", () => {
  it("grades on Google's ad strength, weighted by impressions served", () => {
    const axis = scoreAds([
      { ad_strength: "EXCELLENT", impressions: 900 },
      { ad_strength: "POOR", impressions: 100 },
    ]);
    // 100*900 + 25*100 over 1000
    expect(axis.score).toBe(93);
    expect(axis.note).toMatch(/1 of 2 rated ads/);
  });

  it("ignores ads Google has not rated instead of scoring them badly", () => {
    const axis = scoreAds([
      { ad_strength: "GOOD", impressions: 100 },
      { ad_strength: "PENDING", impressions: 10000 },
    ]);
    expect(axis.score).toBe(80);
  });

  it("returns no score when nothing carries a rating", () => {
    expect(scoreAds([{ ad_strength: null, impressions: 500 }]).score).toBeNull();
  });
});

describe("scoreKeywords and scoreTargeting", () => {
  it("scores the share of spend that bought a conversion", () => {
    const axis = scoreKeywords([
      { keyword_text: "buys", spend: 750, conversions: 3 },
      { keyword_text: "wastes", spend: 250, conversions: 0 },
    ]);
    expect(axis.score).toBe(75);
    expect(axis.note).toMatch(/\$250 of \$1K went to keywords with no conversions/);
  });

  it("keeps a trace of waste from rounding up to a perfect score", () => {
    // $4 wasted on $14K rounds to 100, which contradicts the note beside it.
    const axis = scoreKeywords([
      { keyword_text: "buys", spend: 13996, conversions: 9 },
      { keyword_text: "wastes", spend: 4, conversions: 0 },
    ]);
    expect(axis.score).toBe(99);
  });

  it("refuses to score an account that recorded no conversions at all", () => {
    // Every slice would be "wasted" and the axis would read 0 — which says the
    // targeting is broken, when all it means is nothing converted this period.
    const axis = scoreTargeting([
      { device: "DESKTOP", cost: 500, conversions: 0 },
      { device: "MOBILE", cost: 500, conversions: 0 },
    ]);
    expect(axis.score).toBeNull();
    expect(axis.note).toMatch(/no conversions/i);
  });

  it("says so plainly when the source has no such view", () => {
    const axis = scoreKeywords([]);
    expect(axis.score).toBeNull();
    expect(axis.note).toMatch(/does not expose keyword-level data/);
  });
});

describe("scoreTracking", () => {
  it("measures spend behind campaigns with a conversion action", () => {
    const axis = scoreTracking(
      [
        { campaign: "Tracked", cost: 800 },
        { campaign: "Untracked", cost: 200 },
      ],
      [{ campaign: "Tracked", conversion_action: "customers/1/conversionActions/9" }],
    );
    expect(axis.score).toBe(80);
    expect(axis.note).toMatch(/1 campaign that recorded no conversion action/);
  });

  it("adds the spend of a campaign split across rows", () => {
    const axis = scoreTracking(
      [
        { campaign: "A", cost: 100 },
        { campaign: "A", cost: 100 },
      ],
      [],
    );
    expect(axis.note).toMatch(/\$200 of \$200/);
  });
});

describe("scoreStructure", () => {
  it("gives an even split full marks for the group count it has", () => {
    const axis = scoreStructure([
      { ad_group: "a", cost: 250 },
      { ad_group: "b", cost: 250 },
      { ad_group: "c", cost: 250 },
      { ad_group: "d", cost: 250 },
    ]);
    expect(axis.score).toBe(100);
    expect(axis.note).toMatch(/25% of the spend/);
  });

  it("scores an account funnelling nearly everything through one group near zero", () => {
    const axis = scoreStructure([
      { ad_group: "whale", cost: 9900 },
      { ad_group: "b", cost: 50 },
      { ad_group: "c", cost: 50 },
    ]);
    expect(axis.score).toBeLessThan(5);
    expect(axis.note).toMatch(/99% of the spend/);
  });

  it("adds a group's rows together before comparing them", () => {
    const axis = scoreStructure([
      { ad_group: "a", cost: 100 },
      { ad_group: "a", cost: 100 },
      { ad_group: "b", cost: 200 },
    ]);
    expect(axis.score).toBe(100);
  });

  it("leaves ad groups with no spend out of the count", () => {
    const axis = scoreStructure([
      { ad_group: "live1", cost: 100 },
      { ad_group: "live2", cost: 100 },
      { ad_group: "paused", cost: 0 },
    ]);
    expect(axis.note).toMatch(/largest of 2 active ad groups/);
  });

  it("refuses to score a single ad group rather than calling it zero", () => {
    // A Shopping or Performance Max campaign has exactly one by design.
    const axis = scoreStructure([{ ad_group: "only", cost: 500 }]);
    expect(axis.score).toBeNull();
    expect(axis.note).toMatch(/nothing to spread across/);
  });
});

describe("scoreExtensions", () => {
  it("treats a campaign with a null asset_type as serving no assets", () => {
    const axis = scoreExtensions([
      { campaign: "WithAssets", asset_type: "TEXT", cost: 700 },
      { campaign: "Bare", asset_type: null, cost: 300 },
    ]);
    expect(axis.score).toBe(70);
    expect(axis.note).toMatch(/1 of 2 spending campaigns serve no assets/);
  });

  it("counts a campaign as covered if any of its rows carries an asset", () => {
    const axis = scoreExtensions([
      { campaign: "C", asset_type: null, cost: 100 },
      { campaign: "C", asset_type: "SITELINK", cost: 100 },
    ]);
    expect(axis.score).toBe(100);
  });
});

describe("scoreHealthAxes", () => {
  const empty = {
    delivery: [],
    ads: [],
    structure: [],
    targeting: [],
    tracking: [],
    extensions: [],
    keywords: [],
  };

  it("returns all eight axes in the order the design draws them", () => {
    const axes = scoreHealthAxes(empty);
    expect(axes.map((a) => a.key)).toEqual([...HEALTH_AXIS_ORDER]);
  });

  it("gives every axis a reason when there is no data behind any of them", () => {
    for (const axis of scoreHealthAxes(empty)) {
      expect(axis.score).toBeNull();
      expect(axis.note.length).toBeGreaterThan(10);
    }
  });

  it("averages only the axes that could be judged", () => {
    const axes = scoreHealthAxes({
      ...empty,
      delivery: [{ campaign: "A", cost: 100, search_budget_lost_impression_share: 0.2 }],
      ads: [{ ad_strength: "GOOD", impressions: 100 }],
    });
    // Budget 80, Ads 80, tracking 100 (all spend traced to... no actions → 0)
    const scored = axes.filter((a) => a.score !== null);
    expect(scored.length).toBeGreaterThan(0);
    expect(overallHealth(axes)).toBe(
      Math.round(scored.reduce((s, a) => s + (a.score as number), 0) / scored.length),
    );
  });

  it("has no overall score when nothing could be judged", () => {
    expect(overallHealth(scoreHealthAxes(empty))).toBeNull();
  });

  it("says a failed read failed, rather than reporting it as an empty account", () => {
    // The distinction that matters: a timed-out request and a view with no
    // rows both arrive as [], but only one of them permits the sentence "no ad
    // groups had spend in this period".
    const axes = scoreHealthAxes(empty, new Set(["structure"]));
    const structure = axes.find((a) => a.key === "structure")!;
    expect(structure.score).toBeNull();
    expect(structure.note).toMatch(/could not be read/i);
    expect(structure.note).not.toMatch(/no ad groups/i);
  });

  it("fails only the axes built on the view that failed", () => {
    const axes = scoreHealthAxes(
      {
        ...empty,
        delivery: [{ campaign: "A", cost: 100, search_budget_lost_impression_share: 0.2 }],
      },
      new Set(["keywords"]),
    );
    expect(axes.find((a) => a.key === "budget")!.score).toBe(80);
    expect(axes.find((a) => a.key === "keywords")!.note).toMatch(/could not be read/i);
  });

  it("fails an axis when any one of its several views failed", () => {
    // Tracking reads both the spend view and the conversion-action view; half
    // an answer would understate the tracked share.
    const axes = scoreHealthAxes(
      { ...empty, delivery: [{ campaign: "A", cost: 100 }] },
      new Set(["tracking"]),
    );
    expect(axes.find((a) => a.key === "tracking")!.note).toMatch(/could not be read/i);
  });
});

describe("connectorHasFeature", () => {
  // Default on: a source nobody has configured keeps both pages, exactly as
  // before the toggle existed.
  it("says yes when there is no config at all", () => {
    expect(connectorHasFeature("smartGoals", undefined)).toBe(true);
    expect(connectorHasFeature("optimizer", {})).toBe(true);
  });

  it("says yes for a feature the admin did not touch", () => {
    expect(connectorHasFeature("optimizer", { features: { smartGoals: false } })).toBe(true);
  });

  it("says no only for an explicit false", () => {
    expect(connectorHasFeature("smartGoals", { features: { smartGoals: false } })).toBe(false);
  });
});
