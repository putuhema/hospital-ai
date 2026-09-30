import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

/** Answers mention who is practising now, so they are kept briefly. */
export const ANSWER_TTL = 10 * 60_000;

function allowed(secret: string) {
  const expected = process.env.CHAT_LIMIT_SECRET;
  if (!expected || secret !== expected) throw new ConvexError("Not allowed");
}

/** A recent answer to the same first question, or null. Only the app's server may read them. */
export const get = query({
  args: { secret: v.string(), key: v.string() },
  handler: async (ctx, { secret, key }) => {
    allowed(secret);
    const row = await ctx.db
      .query("chatAnswers")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row && row.expires > Date.now() ? (row.events as unknown[]) : null;
  },
});

/** Keep an answer for the next visitor who asks the same. */
export const put = mutation({
  args: { secret: v.string(), key: v.string(), events: v.array(v.any()) },
  handler: async (ctx, { secret, key, events }) => {
    allowed(secret);
    const expires = Date.now() + ANSWER_TTL;
    const row = await ctx.db
      .query("chatAnswers")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (row) await ctx.db.patch(row._id, { events, expires });
    else await ctx.db.insert("chatAnswers", { key, events, expires });
  },
});

/** Forget expired answers; run daily by crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("chatAnswers")
      .withIndex("by_expires", (q) => q.lt("expires", Date.now()))
      .take(4000);
    for (const row of old) await ctx.db.delete(row._id);
  },
});
