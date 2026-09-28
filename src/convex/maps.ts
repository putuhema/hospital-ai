import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { parseLayout } from "../lib/model/layout.ts";

/** Comfortably below Convex's 1 MB document limit. */
const MAX_LAYOUT = 800_000;
const SLUG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The published layout for a public link, or null if there is none. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const map = await ctx.db
      .query("maps")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    return map && { slug: map.slug, title: map.title, layout: map.layout, publishedAt: map.publishedAt };
  },
});

/**
 * Publish a layout. Without a slug this creates a new public map; with one it
 * replaces that map's layout, provided the key matches the one it was created with.
 */
export const publish = mutation({
  args: { layout: v.string(), key: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, { layout, key, slug }) => {
    if (key.length < 32) throw new ConvexError("Invalid publish key");
    if (layout.length > MAX_LAYOUT) throw new ConvexError("The layout is too large to publish");
    let title: string;
    try {
      title = parseLayout(layout).title;
    } catch {
      throw new ConvexError("Invalid layout");
    }
    const keyHash = await sha256(key),
      publishedAt = Date.now();
    if (slug) {
      const map = await ctx.db
        .query("maps")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!map) throw new ConvexError("This map is no longer published");
      if (map.keyHash !== keyHash) throw new ConvexError("This map was published from another device");
      await ctx.db.patch(map._id, { title, layout, publishedAt });
      return { slug, publishedAt };
    }
    for (;;) {
      const candidate = Array.from(
        { length: 8 },
        () => SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)],
      ).join("");
      const taken = await ctx.db
        .query("maps")
        .withIndex("by_slug", (q) => q.eq("slug", candidate))
        .unique();
      if (taken) continue;
      await ctx.db.insert("maps", { slug: candidate, title, layout, keyHash, publishedAt });
      return { slug: candidate, publishedAt };
    }
  },
});

/** Take a published map offline; the public link stops working. */
export const unpublish = mutation({
  args: { slug: v.string(), key: v.string() },
  handler: async (ctx, { slug, key }) => {
    const map = await ctx.db
      .query("maps")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!map) return;
    if (map.keyHash !== (await sha256(key))) throw new ConvexError("This map was published from another device");
    await ctx.db.delete(map._id);
  },
});
