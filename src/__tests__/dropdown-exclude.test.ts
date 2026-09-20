import { toggleExcluded, toggleAllExcluded } from "@/lib/dropdownExclude";

describe("search-to-exclude selection", () => {
  it("excludes a row on first tick, re-includes it on the second", () => {
    expect(toggleExcluded([], "watches")).toEqual(["watches"]);
    expect(toggleExcluded(["watches"], "watches")).toEqual([]);
  });

  it("doesn't duplicate an already-excluded row", () => {
    expect(toggleExcluded(["watches"], "watches").length).toBe(0);
    expect(toggleExcluded(["a"], "b")).toEqual(["a", "b"]);
  });

  it("excludes every visible (found) row when Select-all is unticked", () => {
    // Search 'watches' → three matches, all currently included → untick header.
    const found = ["mens watches", "womens watches", "kids watches"];
    expect(toggleAllExcluded([], found, true)).toEqual(found);
  });

  it("keeps exclusions from an earlier search when a new search excludes more", () => {
    const already = ["mens watches"];
    const foundNow = ["red shoes", "blue shoes"];
    expect(toggleAllExcluded(already, foundNow, true)).toEqual([
      "mens watches",
      "red shoes",
      "blue shoes",
    ]);
  });

  it("re-includes the visible set without touching other exclusions", () => {
    const current = ["mens watches", "red shoes", "blue shoes"];
    const visible = ["red shoes", "blue shoes"];
    expect(toggleAllExcluded(current, visible, false)).toEqual(["mens watches"]);
  });
});
