import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { parseLayout } from "../lib/model/layout.ts";
import { joinLayout, splitLayout, stableJson, type Records } from "../lib/model/records.ts";

/** Comfortably below what one save can write. */
const MAX_LAYOUT = 800_000;
const SLUG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
type Rows = "buildings" | "places" | "doctors" | "faq";

/** The hospital at /m/<slug>, or the first one (the one at /) without a slug. */
async function find(ctx: QueryCtx, slug?: string) {
  return slug
    ? await ctx.db
        .query("hospitals")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique()
    : await ctx.db.query("hospitals").order("asc").first();
}

const rowsOf = <T extends Rows>(ctx: QueryCtx, table: T, hospitalId: Id<"hospitals">) =>
  ctx.db
    .query(table)
    // Every row table has this index; the cast is for TypeScript, which can't tell.
    .withIndex("by_hospital", (q) => q.eq("hospitalId", hospitalId as never))
    .collect() as Promise<Doc<T>[]>;

/** A stored row without the database's own fields. */
function fields<T extends Rows>(doc: Doc<T>) {
  const { _id, _creationTime, hospitalId, ...rest } = doc;
  return rest;
}

/** The hospital with all its information, as a layout for `parseLayout`; null before the first save. */
export const get = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const h = await find(ctx, slug);
    if (!h) return null;
    const [buildings, places, doctors, faq] = await Promise.all(
      (["buildings", "places", "doctors", "faq"] as const).map((t) => rowsOf(ctx, t, h._id)),
    );
    const records = {
      site: { title: h.title, greenery: h.greenery ?? 1, width: h.width, height: h.height, network: h.network },
      buildings: buildings.map(fields),
      places: places.map(fields),
      doctors: doctors.map(fields),
      faq: faq.map(fields),
    } as Records;
    return {
      slug: h.slug,
      title: h.title,
      revision: h.revision,
      updatedAt: h.updatedAt,
      layout: JSON.stringify(joinLayout(records)),
    };
  },
});

/** Which version of the hospital is saved and its name, without its contents: for caches that keep the rest. */
export const version = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const h = await find(ctx, slug);
    return h && { slug: h.slug, title: h.title, revision: h.revision };
  },
});

/** Writes only the rows that changed; true when anything did. */
async function sync<T extends Rows>(
  ctx: MutationCtx,
  table: T,
  hospitalId: Id<"hospitals">,
  rows: Record<string, unknown>[],
  key: (row: Record<string, unknown>) => string,
) {
  const stored = new Map((await rowsOf(ctx, table, hospitalId)).map((d) => [key(d), d]));
  let changed = false;
  for (const row of rows) {
    const doc = stored.get(key(row));
    stored.delete(key(row));
    if (!doc) await ctx.db.insert(table, { ...row, hospitalId } as never);
    else if (stableJson(fields(doc)) !== stableJson(row)) await ctx.db.replace(doc._id, { ...row, hospitalId } as never);
    else continue;
    changed = true;
  }
  for (const doc of stored.values()) {
    await ctx.db.delete(doc._id);
    changed = true;
  }
  return changed;
}

/**
 * Save the hospital from the editor. It is live for visitors straight away.
 * The first save creates the hospital and its public address.
 */
export const save = mutation({
  args: { layout: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, { layout, slug }) => {
    if (layout.length > MAX_LAYOUT) throw new ConvexError("The hospital is too large to save");
    let records: Records;
    try {
      records = splitLayout(parseLayout(layout));
    } catch {
      throw new ConvexError("Invalid layout");
    }
    const { title, greenery, width, height, network } = records.site,
      updatedAt = Date.now();
    let h = await find(ctx, slug);
    if (!h && slug) throw new ConvexError("This hospital no longer exists");
    if (!h) {
      let candidate: string;
      do
        candidate = Array.from(
          { length: 8 },
          () => SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)],
        ).join("");
      while (await find(ctx, candidate));
      const id = await ctx.db.insert("hospitals", {
        slug: candidate,
        title,
        greenery,
        width,
        height,
        network,
        revision: 0,
        updatedAt,
      });
      h = (await ctx.db.get(id))!;
    }
    const site = stableJson({ title, greenery, width, height, network }) !==
      stableJson({ title: h.title, greenery: h.greenery ?? 1, width: h.width, height: h.height, network: h.network });
    const changed = [
      site,
      await sync(ctx, "buildings", h._id, records.buildings, (r) => String(r.pieceId)),
      await sync(ctx, "places", h._id, records.places, (r) => String(r.place)),
      await sync(ctx, "doctors", h._id, records.doctors, (r) => `${r.place}#${r.order}`),
      await sync(ctx, "faq", h._id, records.faq, (r) => String(r.order)),
    ].some(Boolean);
    if (!changed) return { slug: h.slug, revision: h.revision };
    const revision = h.revision + 1;
    await ctx.db.patch(h._id, { title, greenery, width, height, network, revision, updatedAt });
    return { slug: h.slug, revision };
  },
});
