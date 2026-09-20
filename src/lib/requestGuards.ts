import { isConnectorId } from "./connectors";

// What a route checks before it calls anything expensive.
//
// The rule these share: an answer a caller can act on, decided here, instead of
// a 500 carrying whatever Windsor or Postgres said. An upstream message names
// tables, columns and internal parameters, and it reaches the browser verbatim
// — which is both a leak and useless to whoever reads it.

/** The longest range any source will serve. Beyond this Windsor times out. */
export const MAX_RANGE_DAYS = 800;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date range that is safe to pass upstream, or the reason it isn't.
 *
 * Windsor rejects a malformed date and a reversed range with a 400 of its own,
 * roughly a second later; a range of decades doesn't come back at all — it sat
 * on the 90-second timeout before failing. All three are decidable here.
 */
export function checkDateRange(
  from: string | null,
  to: string | null,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  if (!from || !to) return { ok: false, error: "Missing date_from or date_to" };
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to))
    return { ok: false, error: "Dates must be written as YYYY-MM-DD." };

  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return { ok: false, error: "Dates must be written as YYYY-MM-DD." };
  if (a > b) return { ok: false, error: "The start date is after the end date." };

  const days = Math.round((b - a) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS)
    return {
      ok: false,
      error: `That range covers ${days} days. Ask for ${MAX_RANGE_DAYS} or fewer.`,
    };
  return { ok: true, from, to };
}

/**
 * A connector id the registry actually knows.
 *
 * getConnector() falls back to the default source for anything it doesn't
 * recognise, which is right inside the app — a page always passes a real id —
 * but wrong at a route boundary, where a typo then returns a confident 200 full
 * of the wrong platform's numbers.
 */
export function checkConnector(id: string): { ok: true } | { ok: false; error: string } {
  return isConnectorId(id) ? { ok: true } : { ok: false, error: `Unknown data source "${id}".` };
}
