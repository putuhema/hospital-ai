import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { DAY, decide, rules, windowOf } from "../lib/assistant/limits.ts";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

/**
 * Count one question for a visitor, if it fits the limits. Only the app's
 * server may call it: it holds `CHAT_LIMIT_SECRET`, set on this deployment too
 * (`npx convex env set CHAT_LIMIT_SECRET …`). `CHAT_DAILY_LIMIT` changes how
 * many questions the whole hospital gets a day (1000).
 */
export const take = mutation({
  args: { secret: v.string(), visitor: v.string() },
  handler: async (ctx, { secret, visitor }) => {
    const expected = process.env.CHAT_LIMIT_SECRET;
    if (!expected || secret !== expected) throw new ConvexError("Not allowed");
    const now = Date.now(),
      perDay = Number(process.env.CHAT_DAILY_LIMIT) || undefined;
    const checks = await Promise.all(
      rules(visitor, perDay).map(async (rule) => {
        const { start, end } = windowOf(rule, now);
        const row = await ctx.db
          .query("chatLimits")
          .withIndex("by_key", (q) => q.eq("key", rule.key).eq("window", start))
          .unique();
        return { rule, start, end, row, count: row?.count ?? 0 };
      }),
    );
    const verdict = decide(checks, now);
    if (!verdict.ok) return verdict;
    for (const c of checks)
      if (c.row) await ctx.db.patch(c.row._id, { count: c.count + 1 });
      else await ctx.db.insert("chatLimits", { key: c.rule.key, window: c.start, count: 1 });
    return verdict;
  },
});

/** Forget windows that ended more than a day ago; run daily by crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("chatLimits")
      .withIndex("by_window", (q) => q.lt("window", Date.now() - 2 * DAY))
      .take(4000);
    for (const row of old) await ctx.db.delete(row._id);
  },
});
