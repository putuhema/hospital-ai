import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { find } from "./hospital";

const KIND = v.union(
  v.literal("route"),
  v.literal("qr"),
  v.literal("chat"),
  v.literal("helpful"),
  v.literal("unhelpful"),
);
const MAX_LABEL = 80;

/** Strip long digit sequences (phone/MRN/BPJS numbers) and trim so analytics never store PII. */
function cleanLabel(raw: string) {
  return raw
    .replace(/\d{5,}/g, "•••")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
}

/** Increment an anonymous aggregate counter for a destination, QR sign, chat question, or answer rating. */
export const record = mutation({
  args: { slug: v.optional(v.string()), kind: KIND, label: v.string() },
  handler: async (ctx, { slug, kind, label }) => {
    const clean = cleanLabel(label);
    if (!clean) return;
    const h = await find(ctx, slug);
    if (!h) return;
    const existing = await ctx.db
      .query("analytics")
      .withIndex("by_hospital_kind_label", (q) => q.eq("hospitalId", h._id).eq("kind", kind).eq("label", clean))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1, lastAt: now });
    } else {
      await ctx.db.insert("analytics", { hospitalId: h._id, kind, label: clean, count: 1, lastAt: now });
    }
  },
});

/** Top destinations, QR sign scans, most-asked questions, and answer helpfulness for the Hospital Hub dashboard. */
export const summary = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const h = await find(ctx, slug);
    if (!h)
      return {
        routes: [],
        qr: [],
        chat: [],
        totals: { routes: 0, qr: 0, chat: 0 },
        feedback: { helpful: 0, unhelpful: 0 },
      };
    const rows = await ctx.db
      .query("analytics")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", h._id))
      .collect();
    const top = (kind: "route" | "qr" | "chat") =>
      rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
        .slice(0, 10)
        .map((r) => ({ label: r.label, count: r.count, lastAt: r.lastAt }));
    const sum = (kind: "route" | "qr" | "chat" | "helpful" | "unhelpful") =>
      rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0);
    return {
      routes: top("route"),
      qr: top("qr"),
      chat: top("chat"),
      totals: { routes: sum("route"), qr: sum("qr"), chat: sum("chat") },
      feedback: { helpful: sum("helpful"), unhelpful: sum("unhelpful") },
    };
  },
});
