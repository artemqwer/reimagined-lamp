import { phrasingHash, type Finding } from "@/lib/optimizerPhrasing";

// The cache key is the whole point of the daily-phrasing design: identical
// findings must hash the same (so the wording is reused and the model isn't
// called again), and any change to what's being reworded must change it (so
// stale wording is never served).

const finding = (id: string, title: string, detail = "d"): Finding => ({
  id,
  kind: "underperformer",
  title,
  detail,
  action: "a",
});

describe("phrasingHash", () => {
  const base: Finding[] = [finding("a", "A"), finding("b", "B")];

  it("is stable for identical inputs", () => {
    expect(phrasingHash("google_ads", "revenue", base)).toBe(
      phrasingHash("google_ads", "revenue", base),
    );
  });

  it("changes when the connector changes", () => {
    expect(phrasingHash("google_ads", "revenue", base)).not.toBe(
      phrasingHash("meta_ads", "revenue", base),
    );
  });

  it("changes when the goal changes", () => {
    expect(phrasingHash("google_ads", "revenue", base)).not.toBe(
      phrasingHash("google_ads", "roas", base),
    );
  });

  it("changes when a finding's text changes", () => {
    const moved = [finding("a", "A changed"), finding("b", "B")];
    expect(phrasingHash("google_ads", "revenue", base)).not.toBe(
      phrasingHash("google_ads", "revenue", moved),
    );
  });
});
