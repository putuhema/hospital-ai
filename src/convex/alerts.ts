import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { find } from "./hospital";
import { liveOf } from "./live";
import { fresh, turnOf, type Ticket } from "../lib/model/live.ts";
import { alertMessage, dueStep, finished, parseTicket, type AlertStep } from "../lib/model/turn-alerts.ts";

const HOUR = 3_600_000;
/** More than any hospital's visitors following a number in one day; past it, new ones wait. */
const MAX_PER_HOSPITAL = 3000;

const subscription = v.object({
  endpoint: v.string(),
  keys: v.object({ p256dh: v.string(), auth: v.string() }),
});

/** Only push services' own https addresses, never somewhere the server would be sent to. */
function checked(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    throw new ConvexError("Not a push address");
  }
  if (url.protocol !== "https:" || sub.endpoint.length > 1000 || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100)
    throw new ConvexError("Not a push address");
  return sub;
}

/** Tell this phone when the number is near; replaces what it followed before. Open to visitors. */
export const subscribe = mutation({
  args: { slug: v.optional(v.string()), ticket: v.any(), lang: v.union(v.literal("id"), v.literal("en")), subscription },
  handler: async (ctx, { slug, ticket, lang, subscription: sub }) => {
    const parsed = parseTicket(ticket);
    if (!parsed) throw new ConvexError("Not a queue number");
    const { endpoint, keys } = checked(sub);
    const hospital = await find(ctx, slug);
    if (!hospital) throw new ConvexError("No such hospital");
    for (const old of await ctx.db
      .query("turnAlerts")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .collect())
      await ctx.db.delete(old._id);
    const today = await ctx.db
      .query("turnAlerts")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", hospital._id))
      .take(MAX_PER_HOSPITAL);
    if (today.length >= MAX_PER_HOSPITAL) throw new ConvexError("Too many");
    await ctx.db.insert("turnAlerts", { hospitalId: hospital._id, ticket: parsed, lang, endpoint, keys, sent: [], createdAt: Date.now() });
  },
});

/** Stop telling this phone. */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    for (const row of await ctx.db
      .query("turnAlerts")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .collect())
      await ctx.db.delete(row._id);
  },
});

/** The alerts due now at a hospital, with their messages; and the ones that are over. */
export const due = internalQuery({
  args: { hospitalId: v.id("hospitals") },
  handler: async (ctx, { hospitalId }) => {
    const now = Date.now();
    const live = fresh(await liveOf(ctx, hospitalId), now);
    const rows = await ctx.db
      .query("turnAlerts")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", hospitalId))
      .collect();
    const send: { id: (typeof rows)[number]["_id"]; step: AlertStep; subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; message: { title: string; body: string; tag: string; url: string } }[] = [],
      over: (typeof rows)[number]["_id"][] = [];
    if (!live) return { send, over };
    const hospital = await ctx.db.get(hospitalId);
    for (const row of rows) {
      const ticket = row.ticket as Ticket,
        sent = row.sent as AlertStep[];
      const turn = turnOf(ticket, live);
      if (finished(turn, sent)) {
        over.push(row._id);
        continue;
      }
      const step = dueStep(turn, sent);
      if (!step) continue;
      const path = hospital ? `/m/${hospital.slug}` : "/";
      send.push({
        id: row._id,
        step,
        subscription: { endpoint: row.endpoint, keys: row.keys },
        message: { ...alertMessage(step, ticket, turn, row.lang), tag: `turn-${ticket.number}`, url: ticket.place ? `${path}?to=${encodeURIComponent(ticket.place)}` : path },
      });
    }
    return { send, over };
  },
});

/** A step was sent. */
export const sent = internalMutation({
  args: { id: v.id("turnAlerts"), step: v.string() },
  handler: async (ctx, { id, step }) => {
    const row = await ctx.db.get(id);
    if (row && !row.sent.includes(step)) await ctx.db.patch(id, { sent: [...row.sent, step] });
  },
});

/** Alerts that are over, or whose phone unsubscribed. */
export const drop = internalMutation({
  args: { ids: v.array(v.id("turnAlerts")) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

/** A queue number is for one day: forget it after 18 hours. Run hourly by crons.ts. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("turnAlerts")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - 18 * HOUR))
      .take(4000);
    for (const row of old) await ctx.db.delete(row._id);
  },
});
