/**
 * Visitor details for a destination (building, room or landmark): what it is,
 * how to call it and when it is open. Wards use visiting hours instead.
 */

/** One opening rule. Days are 0 (Sunday) – 6 (Saturday); times are "HH:MM". */
export type Hours = { days: number[]; open: string; close: string };
export type PlaceInfo = {
  description?: string;
  phone?: string;
  hours?: Hours[];
  /** The hours are visiting hours (e.g. a ward), not opening hours. */
  visiting?: boolean;
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 1440,
  WEEK = 7 * DAY,
  TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const clock = (m: number) =>
  `${String(Math.floor((m % DAY) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Validates stored details; returns undefined when there are none. */
export function parseInfo(value: unknown): PlaceInfo | undefined {
  if (value === undefined) return undefined;
  const d = value as PlaceInfo;
  const text = (s: unknown, max: number) => s === undefined || (typeof s === "string" && s.length <= max);
  if (
    !d ||
    typeof d !== "object" ||
    !text(d.description, 500) ||
    !text(d.phone, 40) ||
    (d.visiting !== undefined && typeof d.visiting !== "boolean") ||
    (d.hours !== undefined &&
      (!Array.isArray(d.hours) ||
        d.hours.length > 14 ||
        d.hours.some(
          (h) =>
            !h ||
            !Array.isArray(h.days) ||
            !h.days.length ||
            h.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6) ||
            !TIME.test(h.open) ||
            !TIME.test(h.close),
        )))
  )
    throw Error("Invalid place details");
  const info: PlaceInfo = {};
  if (d.description?.trim()) info.description = d.description.trim();
  if (d.phone?.trim()) info.phone = d.phone.trim();
  if (d.hours?.length)
    info.hours = d.hours.map((h) => ({ days: [...new Set(h.days)].sort(), open: h.open, close: h.close }));
  if (d.visiting) info.visiting = true;
  return Object.keys(info).length ? info : undefined;
}

/** Open periods in minutes from Sunday 00:00. A close at or before the open time runs past midnight. */
function periods(hours: Hours[]) {
  const out: [number, number][] = [];
  for (const h of hours)
    for (const d of h.days) {
      const start = d * DAY + minutes(h.open);
      let end = d * DAY + minutes(h.close);
      if (end <= start) end += DAY;
      out.push([start, end]);
    }
  return out.sort((a, b) => a[0] - b[0]);
}

export type HoursStatus = { open: boolean; text: string };

/** Whether it is open at `now` (the visitor's local time) and when that changes. */
export function hoursStatus(info: PlaceInfo, now: Date): HoursStatus | null {
  if (!info.hours?.length) return null;
  const list = periods(info.hours),
    at = now.getDay() * DAY + now.getHours() * 60 + now.getMinutes();
  // Look over two weeks so periods crossing Saturday midnight still count.
  const all = [...list, ...list.map(([s, e]) => [s + WEEK, e + WEEK] as [number, number])];
  const [yes, no] = info.visiting ? ["Visiting now", "No visiting now"] : ["Open now", "Closed"];
  const current = (t: number) => all.find(([s, e]) => s <= t && t < e);
  for (const t of [at, at + WEEK]) {
    if (!current(t)) continue;
    // Follow back-to-back periods to find when it really closes.
    let end = t;
    for (let p = current(end); p && end < t + WEEK; p = current(end)) end = p[1];
    if (end >= t + WEEK) return { open: true, text: `${yes} · 24 hours` };
    return { open: true, text: `${yes} · until ${clock(end)}` };
  }
  const next = all.map(([s]) => s).find((s) => s > at)!;
  const days = Math.floor(next / DAY) - Math.floor(at / DAY),
    when = days === 0 ? "" : days === 1 ? "tomorrow " : `${DAY_NAMES[Math.floor(next / DAY) % 7]} `;
  return { open: false, text: `${no} · ${info.visiting ? "from" : "opens"} ${when}${clock(next)}` };
}

/** "Mon–Fri" for runs of days, "Mon, Wed" otherwise; the week starts on Monday. */
export function dayRange(days: number[]) {
  if (days.length === 7) return "Every day";
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)),
    runs: number[][] = [];
  for (const d of order) {
    const last = runs.at(-1);
    if (last && (last.at(-1)! + 1) % 7 === d) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length > 2 ? `${DAY_NAMES[r[0]]}–${DAY_NAMES[r.at(-1)!]}` : r.map((d) => DAY_NAMES[d]).join(", ")))
    .join(", ");
}

/** One line per rule, e.g. "Mon–Fri 08:00–17:00". */
export const hoursLines = (hours: Hours[]) =>
  hours.map((h) => `${dayRange(h.days)} ${h.open === h.close ? "24 hours" : `${h.open}–${h.close}`}`);
