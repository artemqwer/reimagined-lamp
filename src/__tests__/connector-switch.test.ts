import { useCrossFilter } from "@/lib/store";

describe("setActiveConnector", () => {
  beforeEach(() => {
    // reset to a known state
    useCrossFilter.getState().clearAll();
    useCrossFilter.setState({ activeConnector: "google_ads" });
  });

  it("switches the active connector", () => {
    useCrossFilter.getState().setActiveConnector("meta_ads");
    expect(useCrossFilter.getState().activeConnector).toBe("meta_ads");
  });

  it("clears all filters / searches / includes when the source changes", () => {
    const s = useCrossFilter.getState();
    s.setFilter("campaign", ["Brand", "Generic"]);
    s.setDimSearch("product", "shirt");
    s.setDimInclude("channel", ["Organic"]);
    expect(useCrossFilter.getState().filters.campaign).toHaveLength(2);

    useCrossFilter.getState().setActiveConnector("shopify");

    const after = useCrossFilter.getState();
    expect(after.filters).toEqual({});
    expect(after.dimSearch).toEqual({});
    expect(after.dimInclude).toEqual({});
  });

  it("bumps clearSignal so tables reset their local state", () => {
    const before = useCrossFilter.getState().clearSignal;
    useCrossFilter.getState().setActiveConnector("ga4");
    expect(useCrossFilter.getState().clearSignal).toBe(before + 1);
  });
});
