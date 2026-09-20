import { progressFill } from "@/lib/smartGoals";

// The numbers here are the ones the bug report specifies. The bar used to show
// the attainment figure, which is inverted for a lower-is-better goal: full at
// $214 of a $500 budget, and part-full at $652 of it.

describe("progressFill", () => {
  it("fills proportionally before the target is reached", () => {
    expect(Math.round(progressFill(214, 500))).toBe(43);
  });

  it("fills completely at the target", () => {
    expect(progressFill(500, 500)).toBe(100);
  });

  it("stays full past the target", () => {
    expect(progressFill(652, 500)).toBe(100);
    expect(progressFill(5_000, 500)).toBe(100);
  });

  it("is empty at zero", () => {
    expect(progressFill(0, 500)).toBe(0);
  });

  it("never goes below zero", () => {
    // A profit goal can run negative while its target is positive.
    expect(progressFill(-250, 500)).toBe(0);
  });

  it("reads a negative target as progress towards it", () => {
    // A net-profit goal of -$7,000 with -$253 booked is 3.6% of the way.
    expect(Math.round(progressFill(-253, -7000))).toBe(4);
  });

  it("returns zero rather than dividing by a zero or missing target", () => {
    expect(progressFill(100, 0)).toBe(0);
    expect(progressFill(100, NaN)).toBe(0);
    expect(progressFill(NaN, 500)).toBe(0);
  });
});
