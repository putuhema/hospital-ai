/**
 * Combines two editors' changes to the hospital (a three-way merge). `base`
 * is the layout both started from, `mine` this editor's, `theirs` the one
 * saved meanwhile elsewhere; all are layouts as autosave stores them
 * (`layoutSnapshot`). Changes are combined per row: the site's title, trees
 * and canvas, each building or outdoor piece (with its rooms and doctors),
 * each waypoint, each path and each question. A row both changed differently
 * is a conflict: this editor's version is kept, and the row is named so the
 * editor can say so.
 */
import { stableJson } from "../model/records.ts";

type Row = { id: string | number; name?: string; question?: string };
type Layout = {
  title?: string;
  greenery?: number;
  grid?: unknown;
  pieces?: Row[];
  network?: { nodes?: Row[]; edges?: unknown[] };
  faq?: Row[];
};

export type Merged = { layout: string; conflicts: string[] };

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** One value: theirs unless only mine changed. */
function pick<T>(base: T, mine: T, theirs: T, name: string, conflicts: string[]): T {
  if (same(mine, base) || same(mine, theirs)) return theirs;
  if (same(theirs, base)) return mine;
  conflicts.push(name);
  return mine;
}

/** Rows with ids: each one merged on its own; a row one side removed and the other left alone is removed. */
function byId<T extends Row>(base: T[], mine: T[], theirs: T[], label: (row: T) => string, conflicts: string[]): T[] {
  const index = (rows: T[]) => new Map(rows.map((r) => [r.id, r])),
    b = index(base),
    m = index(mine),
    t = index(theirs);
  // Their order, with rows only this editor has kept where they were.
  const ids = theirs.map((r) => r.id);
  mine.forEach((r, i) => {
    if (!t.has(r.id) && !b.has(r.id)) ids.splice(Math.min(i, ids.length), 0, r.id);
  });
  const out: T[] = [];
  for (const id of ids) {
    const row = pick(b.get(id), m.get(id), t.get(id), label((m.get(id) ?? t.get(id))!), conflicts);
    if (row) out.push(row);
  }
  // Rows this editor changed that the other removed: kept, as the change is newer than the removal.
  for (const id of b.keys())
    if (!t.has(id) && m.has(id) && !same(m.get(id), b.get(id)) && !ids.includes(id)) {
      conflicts.push(label(m.get(id)!));
      out.push(m.get(id)!);
    }
  return out;
}

/** Rows without ids (paths, questions): what this editor added or removed, applied to theirs. */
function asSet<T>(base: T[], mine: T[], theirs: T[]): T[] {
  const key = (r: T) => stableJson(r),
    had = new Set(base.map(key)),
    kept = new Set(mine.map(key));
  const out = theirs.filter((r) => !had.has(key(r)) || kept.has(key(r)));
  const present = new Set(out.map(key));
  mine.forEach((r, i) => {
    if (!had.has(key(r)) && !present.has(key(r))) out.splice(Math.min(i, out.length), 0, r);
  });
  return out;
}

export function mergeLayouts(base: string, mine: string, theirs: string): Merged {
  const b: Layout = JSON.parse(base),
    m: Layout = JSON.parse(mine),
    t: Layout = JSON.parse(theirs);
  const conflicts: string[] = [];
  const merged: Layout = {
    ...t,
    title: pick(b.title, m.title, t.title, "the hospital's name", conflicts),
    greenery: pick(b.greenery, m.greenery, t.greenery, "the trees setting", conflicts),
    grid: pick(b.grid, m.grid, t.grid, "the canvas size", conflicts),
    pieces: byId(b.pieces ?? [], m.pieces ?? [], t.pieces ?? [], (p) => p.name || "a building", conflicts),
    network: {
      nodes: byId(b.network?.nodes ?? [], m.network?.nodes ?? [], t.network?.nodes ?? [], (n) => n.name || "a waypoint", conflicts),
      edges: asSet(b.network?.edges ?? [], m.network?.edges ?? [], t.network?.edges ?? []),
    },
    faq: asSet(b.faq ?? [], m.faq ?? [], t.faq ?? []),
  };
  return { layout: JSON.stringify(merged), conflicts: [...new Set(conflicts)] };
}

/** What the editor says after combining. */
export const mergeMessage = (conflicts: string[]) =>
  conflicts.length
    ? `Someone else also changed ${conflicts.slice(0, 3).join(", ")}${conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""}; your version was kept`
    : "Combined with changes saved by another editor";
