// The dimension dropdown's "search-to-exclude" model.
//
// From the default where everything is selected, a search finds matching rows —
// shown CHECKED, because they ARE part of "everything" — and unticking them
// EXCLUDES those rows from the dashboards (the table then shows all-except).
// This is the opposite of building an include set up from nothing, and it's the
// only model that works on a huge dimension (98k search terms) where the full
// list can't be enumerated to include its complement: the exclusions are sent
// to the API as `filter_exclude`.
//
// Pure so the checkbox maths is testable without a DOM.

/** Tick a single row on/off in the exclude set. */
export function toggleExcluded(current: string[], name: string): string[] {
  return current.includes(name)
    ? current.filter((n) => n !== name)
    : [...new Set([...current, name])];
}

/**
 * "Select all", in exclude mode.
 *
 * When every visible row is currently included (none excluded), unticking the
 * header excludes them all; otherwise it re-includes them. `visible` is the
 * currently listed set — the search results when a search is active — so
 * excluding "all" only ever touches what's on screen.
 */
export function toggleAllExcluded(
  current: string[],
  visible: string[],
  allVisibleIncluded: boolean,
): string[] {
  if (allVisibleIncluded) return [...new Set([...current, ...visible])];
  const vis = new Set(visible);
  return current.filter((n) => !vis.has(n));
}
