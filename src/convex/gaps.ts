import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { find } from "./hospital";
import { requireEditor } from "./auth";
import { byNeed, GAP_DAYS, sameSubject, subjectOf, topicNamed, withQuestion, type Gap } from "../lib/assistant/gaps.ts";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

const DAY = 86_400_000;

/**
 * A question the assistant couldn't answer, under its subject (lib/assistant/gaps.ts).
 * Only the app's server may call it: it holds `CHAT_LIMIT_SECRET`.
 */
export const note = mutation({
  args: { secret: v.string(), slug: v.optional(v.string()), topic: v.string(), subject: v.string(), question: v.string() },
  handler: async (ctx, { secret, slug, topic, subject, question }) => {
    const expected = process.env.CHAT_LIMIT_SECRET;
    if (!expected || secret !== expected) throw new ConvexError("Not allowed");
    const key = subjectOf(subject);
    const hospital = await find(ctx, slug);
    if (!key || !hospital) return;
    // The same thing worded another way joins its subject (a hospital has tens of them, not thousands).
    const rows = await ctx.db
      .query("gaps")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", hospital._id))
      .collect();
    const row = rows.find((r) => r.subject === key) ?? rows.find((r) => sameSubject(r.subject, key)) ?? null;
    const next = withQuestion(row as Gap | null, { topic: topicNamed(topic), subject: key, question }, Date.now());
    if (row) await ctx.db.patch(row._id, { ...next, doneAt: undefined });
    else await ctx.db.insert("gaps", { hospitalId: hospital._id, ...next });
  },
});

/** The subjects still open, most asked first, for the editor. */
export const list = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    await requireEditor(ctx);
    const hospital = await find(ctx, slug);
    if (!hospital) return [];
    const rows = await ctx.db
      .query("gaps")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", hospital._id))
      .collect();
    return rows
      .filter((r) => r.doneAt === undefined)
      .sort((a, b) => byNeed(a as Gap, b as Gap))
      .slice(0, 100)
      .map(({ hospitalId, _creationTime, ...gap }) => gap);
  },
});

/** An editor wrote the answer (or it needs none): hidden until someone asks again. */
export const done = mutation({
  args: { id: v.id("gaps") },
  handler: async (ctx, { id }) => {
    await requireEditor(ctx);
    if (await ctx.db.get(id)) await ctx.db.patch(id, { doneAt: Date.now() });
  },
});

/** Forget subjects nobody has asked about for 90 days; run daily by crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("gaps")
      .withIndex("by_last", (q) => q.lt("lastAt", Date.now() - GAP_DAYS * DAY))
      .take(4000);
    for (const row of old) await ctx.db.delete(row._id);
  },
});

/** Every hospital's open subjects, for the weekly email (gapsDigest.ts). */
export const forDigest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const hospitals = await ctx.db.query("hospitals").collect();
    return Promise.all(
      hospitals.map(async (h) => ({
        slug: h.slug,
        title: h.title,
        gaps: (
          await ctx.db
            .query("gaps")
            .withIndex("by_hospital", (q) => q.eq("hospitalId", h._id))
            .collect()
        ).map(({ hospitalId, _id, _creationTime, ...gap }) => gap as Gap),
      })),
    );
  },
});
