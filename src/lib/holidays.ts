// ─────────────────────────────────────────────────────────────────────────────
// The US e-commerce holiday calendar.
//
// Both timelines mark holidays — the campaigns dashboard's and Smart Goals' —
// and a shopping calendar that disagrees with itself between two screens would
// be worse than none. So the calendar itself lives here, and each timeline maps
// it into whatever shape its own event taxonomy uses.
//
// Dates are computed rather than listed, so the calendar is right for any year
// without anyone maintaining a table.
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** nth weekday (0=Sun) of a month; n<0 counts back from the end. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/** Easter Sunday for any year — Anonymous Gregorian computus (past and future). */
function easter(y: number): { m: number; d: number } {
  const a = y % 19,
    b = Math.floor(y / 100),
    c = y % 100,
    d = Math.floor(b / 4),
    e = b % 4;
  const f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

export interface Holiday {
  /** Stable across years, so the same holiday keeps one identity. */
  key: string;
  title: string;
  /** ISO date. */
  date: string;
}

/** Every holiday in one year, fixed dates and computed ones alike. */
export function holidaysForYear(y: number): Holiday[] {
  const thanks = nthWeekday(y, 11, 4, 4); // 4th Thursday of November
  const e = easter(y);
  return [
    { key: "newyear", title: "New Year's Day", date: iso(y, 1, 1) },
    { key: "valentine", title: "Valentine's Day", date: iso(y, 2, 14) },
    { key: "presidents", title: "Presidents' Day", date: iso(y, 2, nthWeekday(y, 2, 1, 3)) },
    { key: "easter", title: "Easter", date: iso(y, e.m, e.d) },
    { key: "mother", title: "Mother's Day", date: iso(y, 5, nthWeekday(y, 5, 0, 2)) },
    { key: "memorial", title: "Memorial Day", date: iso(y, 5, nthWeekday(y, 5, 1, -1)) },
    { key: "father", title: "Father's Day", date: iso(y, 6, nthWeekday(y, 6, 0, 3)) },
    { key: "independence", title: "Independence Day", date: iso(y, 7, 4) },
    { key: "labor", title: "Labor Day", date: iso(y, 9, nthWeekday(y, 9, 1, 1)) },
    { key: "halloween", title: "Halloween", date: iso(y, 10, 31) },
    { key: "veterans", title: "Veterans Day", date: iso(y, 11, 11) },
    { key: "thanksgiving", title: "Thanksgiving", date: iso(y, 11, thanks) },
    { key: "blackfriday", title: "Black Friday", date: iso(y, 11, thanks + 1) },
    { key: "smallbiz", title: "Small Business Saturday", date: iso(y, 11, thanks + 2) },
    { key: "cybermonday", title: "Cyber Monday", date: iso(y, 11, thanks + 4) },
    { key: "greenmonday", title: "Green Monday", date: iso(y, 12, nthWeekday(y, 12, 1, 2)) },
    { key: "xmaseve", title: "Christmas Eve", date: iso(y, 12, 24) },
    { key: "christmas", title: "Christmas", date: iso(y, 12, 25) },
    { key: "postxmas", title: "Post-Christmas Sale", date: iso(y, 12, 26) },
    { key: "nye", title: "New Year's Eve", date: iso(y, 12, 31) },
  ];
}

/** Holidays between two ISO dates, inclusive. */
export function holidaysBetween(fromIso: string, toIso: string): Holiday[] {
  if (!fromIso || !toIso || toIso < fromIso) return [];
  const y0 = Number(fromIso.slice(0, 4));
  // Clamp the span so a pathological range can't spin up a huge loop.
  const y1 = Math.min(Number(toIso.slice(0, 4)), y0 + 12);
  const out: Holiday[] = [];
  for (let y = y0; y <= y1; y++)
    for (const h of holidaysForYear(y)) if (h.date >= fromIso && h.date <= toIso) out.push(h);
  return out;
}
