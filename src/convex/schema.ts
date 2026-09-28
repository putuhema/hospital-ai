import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /** Published maps: the layout visitors see at /m/<slug>. */
  maps: defineTable({
    slug: v.string(),
    title: v.string(),
    /** The layout as saved by the editor (read back with `parseLayout`). */
    layout: v.string(),
    /** SHA-256 of the editor's publish key; only its holder can update the map. */
    keyHash: v.string(),
    publishedAt: v.number(),
  }).index("by_slug", ["slug"]),
});
