/**
 * The order the assistant's tool calls run in.
 *
 * The model asks for several things at once — a couple of breakdowns and a
 * settings read. Run in a row they cost the sum of their upstream calls and the
 * user waits through all of it before a word is written, so the reads go
 * together. What makes that safe is the split this pins down: anything that
 * changes what a later read SEES must happen first.
 */

import { partitionToolCalls, STATEFUL_TOOLS } from "@/app/api/ai-chat/route";

const call = (fnName: string, id = fnName) => ({ fnName, id });

describe("splitting the batch", () => {
  it("runs the date range before anything reads data", () => {
    const { stateful, readOnly } = partitionToolCalls([
      call("query_data", "a"),
      call("set_date_range"),
      call("query_data", "b"),
    ]);
    expect(stateful.map((c) => c.id)).toEqual(["set_date_range"]);
    expect(readOnly.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("keeps the dashboard button out of the parallel group", () => {
    // It sets what the answer carries back, not what a read returns — but it
    // is still a write, and writes stay ordered.
    const { stateful } = partitionToolCalls([call("show_on_dashboard"), call("query_data")]);
    expect(stateful.map((c) => c.fnName)).toEqual(["show_on_dashboard"]);
  });

  it("preserves the model's own order within each group", () => {
    const { stateful, readOnly } = partitionToolCalls([
      call("show_on_dashboard"),
      call("campaign_settings", "s"),
      call("set_date_range"),
      call("query_data", "q"),
    ]);
    expect(stateful.map((c) => c.fnName)).toEqual(["show_on_dashboard", "set_date_range"]);
    expect(readOnly.map((c) => c.id)).toEqual(["s", "q"]);
  });

  it("loses nothing from the batch", () => {
    const calls = [call("query_data"), call("set_date_range"), call("unknown_tool")];
    const { stateful, readOnly } = partitionToolCalls(calls);
    expect(stateful.length + readOnly.length).toBe(calls.length);
  });

  it("treats a tool it doesn't know as read-only rather than a write", () => {
    // A tool added later that only reads gets the speed-up for free; one that
    // writes has to be named here, which is the point of the list.
    const { readOnly } = partitionToolCalls([call("some_future_tool")]);
    expect(readOnly).toHaveLength(1);
    expect(STATEFUL_TOOLS).not.toContain("some_future_tool");
  });
});
