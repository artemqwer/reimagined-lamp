/**
 * The metric filter has to work for a source's OWN metrics, not just the
 * canonical ones — an admin-registered metric has no field of its own on a
 * row, and its key isn't in the canonical list.
 */

import {
  isMetricFilterActive,
  applyMetricFilter,
  readMetric,
  metricFilterKey,
  METRIC_FILTER_NONE,
  type MetricFilterState,
} from "@/lib/metricFilter";

const filter = (metric: string, value: string): MetricFilterState => ({
  ...METRIC_FILTER_NONE,
  metric,
  op: "gt",
  value,
});

describe("isMetricFilterActive", () => {
  it("accepts a canonical metric", () => {
    expect(isMetricFilterActive(filter("clicks", "10"))).toBe(true);
  });

  it("accepts an admin-registered metric", () => {
    // Previously false — the key wasn't in the canonical list — so the control
    // offered the choice and the filter then did nothing.
    expect(isMetricFilterActive(filter("avg_position", "5"))).toBe(true);
  });

  it("stays inactive with no metric or no value", () => {
    expect(isMetricFilterActive(filter("", "10"))).toBe(false);
    expect(isMetricFilterActive(filter("clicks", ""))).toBe(false);
    expect(isMetricFilterActive(METRIC_FILTER_NONE)).toBe(false);
  });

  it("between needs both bounds", () => {
    const f: MetricFilterState = { metric: "clicks", op: "between", value: "1", value2: "" };
    expect(isMetricFilterActive(f)).toBe(false);
    expect(isMetricFilterActive({ ...f, value2: "9" })).toBe(true);
  });
});

describe("readMetric", () => {
  const row = { clicks: 12, extra: { avg_position: 3.5 } };

  it("reads a canonical metric from its own field", () => {
    expect(readMetric(row, "clicks")).toBe(12);
  });

  it("falls back to the row's custom-metric bag", () => {
    expect(readMetric(row, "avg_position")).toBe(3.5);
  });

  it("an unknown key reads 0 rather than throwing", () => {
    expect(readMetric(row, "nope")).toBe(0);
  });
});

describe("applyMetricFilter", () => {
  const rows = [
    { dimension: "a", clicks: 5, extra: { avg_position: 2 } },
    { dimension: "b", clicks: 50, extra: { avg_position: 40 } },
  ];

  it("filters on a canonical metric", () => {
    expect(applyMetricFilter(rows, filter("clicks", "10")).map((r) => r.dimension)).toEqual(["b"]);
  });

  it("filters on an admin-registered metric", () => {
    expect(applyMetricFilter(rows, filter("avg_position", "10")).map((r) => r.dimension)).toEqual([
      "b",
    ]);
  });

  it("passes everything through when inactive", () => {
    expect(applyMetricFilter(rows, METRIC_FILTER_NONE)).toHaveLength(2);
  });
});

describe("metricFilterKey", () => {
  it("changes with the custom metric, so the table refetches", () => {
    expect(metricFilterKey(filter("avg_position", "5"))).not.toBe("");
    expect(metricFilterKey(filter("avg_position", "5"))).not.toBe(
      metricFilterKey(filter("avg_position", "9")),
    );
  });
});
