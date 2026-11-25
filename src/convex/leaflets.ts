import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { find } from "./hospital";
import { requireEditor } from "./auth";
import { topics } from "../lib/model/faq.ts";
import { isLeafletUrl, MAX_LEAFLET_TEXT, MAX_LEAFLET_TITLE, MAX_LEAFLETS, type Leaflet } from "../lib/model/leaflets.ts";

/**
 * The hospital's leaflets and brochures (lib/model/leaflets.ts). The editor
 * uploads the image to Vercel Blob itself (routes/api/leaflets) and keeps it
 * here with its title and text. Each change marks the hospital's `leafletsAt`,
 * so the assistant's cache (lib/server/hospital-cache.ts) reads them again.
 */

const asLeaflet = (d: Doc<"leaflets">): Leaflet => ({
  id: d._id,
  url: d.url,
  title: d.title,
  text: d.text,
  topic: d.topic as Leaflet["topic"],
  ...(d.width && d.height && { width: d.width, height: d.height }),
});

const rowsOf = (ctx: QueryCtx, hospitalId: Id<"hospitals">) =>
  ctx.db
    .query("leaflets")
    .withIndex("by_hospital", (q) => q.eq("hospitalId", hospitalId))
    .collect();

/** The leaflets, oldest first: for the editor and the assistant. Visitors see one only when the assistant shows it. */
export const list = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const h = await find(ctx, slug);
    return h ? (await rowsOf(ctx, h._id)).map(asLeaflet) : [];
  },
});

function checked(fields: { title?: string; text?: string; topic?: string }) {
  const out: { title?: string; text?: string; topic?: string } = {};
  if (fields.title !== undefined) {
    out.title = fields.title.trim();
    if (out.title.length > MAX_LEAFLET_TITLE) throw new ConvexError(`A title is at most ${MAX_LEAFLET_TITLE} characters`);
  }
  if (fields.text !== undefined) {
    out.text = fields.text.trim();
    if (out.text.length > MAX_LEAFLET_TEXT) throw new ConvexError(`The text is at most ${MAX_LEAFLET_TEXT} characters`);
  }
  if (fields.topic !== undefined) {
    if (!topics.some((t) => t.id === fields.topic)) throw new ConvexError("Unknown topic");
    out.topic = fields.topic;
  }
  return out;
}

const touch = (ctx: MutationCtx, hospitalId: Id<"hospitals">) => ctx.db.patch(hospitalId, { leafletsAt: Date.now() });

/** A leaflet just uploaded to Vercel Blob. Only admins. */
export const add = mutation({
  args: {
    slug: v.optional(v.string()),
    url: v.string(),
    title: v.string(),
    text: v.optional(v.string()),
    topic: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, { slug, url, width, height, ...rest }) => {
    await requireEditor(ctx);
    const h = await find(ctx, slug);
    if (!h) throw new ConvexError("Save the map once before adding leaflets");
    if (!isLeafletUrl(url)) throw new ConvexError("Not an uploaded leaflet");
    if ((await rowsOf(ctx, h._id)).length >= MAX_LEAFLETS) throw new ConvexError(`That's the most leaflets a hospital can hold (${MAX_LEAFLETS})`);
    const { title = "", text = "", topic = "lainnya" } = checked({ topic: "lainnya", ...rest });
    const size = width && height && width > 0 && height > 0 && { width: Math.round(width), height: Math.round(height) };
    const id = await ctx.db.insert("leaflets", { hospitalId: h._id, url, title, text, topic, ...size, createdAt: Date.now() });
    await touch(ctx, h._id);
    return id;
  },
});

/** A leaflet's title, text or topic. Only admins. */
export const update = mutation({
  args: { id: v.id("leaflets"), title: v.optional(v.string()), text: v.optional(v.string()), topic: v.optional(v.string()) },
  handler: async (ctx, { id, ...fields }) => {
    await requireEditor(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError("This leaflet no longer exists");
    await ctx.db.patch(id, checked(fields));
    await touch(ctx, row.hospitalId);
  },
});

/** Forget a leaflet; returns its image's URL, for the editor to delete from Vercel Blob. Only admins. */
export const remove = mutation({
  args: { id: v.id("leaflets") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx);
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.delete(id);
    await touch(ctx, row.hospitalId);
    return row.url;
  },
});
