import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { find } from "./hospital";
import { parseSnapshot, type ClinicLive, type CounterLive, type Live, type WardLive } from "../lib/model/live.ts";
import { stableJson } from "../lib/model/records.ts";
import { tidyName, type ClinicSchedule } from "../lib/model/schedules.ts";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** When the bridge last reported, and when SIMRS's schedules last changed. */
type Sync = { at: number; schedulesAt?: number };

/** SIMRS's doctors' schedules per clinic, and when they last changed. Kept when the bridge goes quiet: they change rarely. */
export async function schedulesOf(ctx: QueryCtx, hospitalId: Id<"hospitals">) {
  const rows = await ctx.db
    .query("live")
    .withIndex("by_hospital", (q) => q.eq("hospitalId", hospitalId).eq("kind", "jadwal"))
    .collect();
  const sync = await ctx.db
    .query("live")
    .withIndex("by_hospital", (q) => q.eq("hospitalId", hospitalId).eq("kind", "sync"))
    .first();
  return { schedules: rows.map((r) => r.data as ClinicSchedule), at: (sync?.data as Sync | undefined)?.schedulesAt ?? 0 };
}

/** The clinics SIMRS has schedules for and their doctors' names, for the editor to say whose schedules come from SIMRS. */
export const schedules = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const h = await find(ctx, slug);
    if (!h) return [];
    return (await schedulesOf(ctx, h._id)).schedules.map((s) => ({ code: s.code, doctors: s.doctors.map((d) => tidyName(d.name)) }));
  },
});

/**
 * Today's queue per clinic and the beds per ward, as the bridge last sent
 * them, with when that was; null before the bridge has ever reported. Open
 * to visitors: it holds totals and queue numbers only.
 */
export const get = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }): Promise<Live | null> => {
    const h = await find(ctx, slug);
    if (!h) return null;
    const rows = await ctx.db
      .query("live")
      .withIndex("by_hospital", (q) => q.eq("hospitalId", h._id))
      .collect();
    const sync = rows.find((r) => r.kind === "sync");
    if (!sync) return null;
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const counter = rows.find((r) => r.kind === "loket");
    return {
      at: (sync.data as Sync).at,
      ...(counter && { counter: counter.data as CounterLive }),
      clinics: rows.filter((r) => r.kind === "poli").map((r) => r.data as ClinicLive).sort(byName),
      wards: rows.filter((r) => r.kind === "ward").map((r) => r.data as WardLive).sort(byName),
    };
  },
});

/**
 * What the bridge sent (http.ts checks its secret): writes only the clinics
 * and wards that changed, and notes that the bridge reported.
 */
export const push = internalMutation({
  args: { slug: v.optional(v.string()), snapshot: v.any() },
  handler: async (ctx, { slug, snapshot }) => {
    const h = await find(ctx, slug);
    if (!h) return { ok: false as const, error: "No such hospital" };
    let parsed;
    try {
      parsed = parseSnapshot(snapshot);
    } catch {
      return { ok: false as const, error: "Invalid snapshot" };
    }
    const stored = new Map(
      (
        await ctx.db
          .query("live")
          .withIndex("by_hospital", (q) => q.eq("hospitalId", h._id))
          .collect()
      ).map((r) => [`${r.kind}:${r.code}`, r]),
    );
    let changed = 0;
    const rows = [
      ...parsed.clinics.map((data) => ({ kind: "poli" as const, code: data.code, data })),
      ...parsed.wards.map((data) => ({ kind: "ward" as const, code: data.code, data })),
      ...(parsed.counter ? [{ kind: "loket" as const, code: "", data: parsed.counter }] : []),
      ...(parsed.schedules ?? []).map((data) => ({ kind: "jadwal" as const, code: data.code, data })),
    ];
    // A bridge that doesn't send schedules leaves the stored ones alone.
    if (!parsed.schedules) for (const key of [...stored.keys()]) if (key.startsWith("jadwal:")) stored.delete(key);
    let schedulesChanged = false;
    for (const row of rows) {
      const key = `${row.kind}:${row.code}`,
        doc = stored.get(key);
      stored.delete(key);
      if (!doc) await ctx.db.insert("live", { hospitalId: h._id, ...row });
      else if (stableJson(doc.data) !== stableJson(row.data)) await ctx.db.patch(doc._id, { data: row.data });
      else continue;
      changed++;
      if (row.kind === "jadwal") schedulesChanged = true;
    }
    const sync = stored.get("sync:");
    stored.delete("sync:");
    for (const doc of stored.values()) {
      await ctx.db.delete(doc._id);
      changed++;
      if (doc.kind === "jadwal") schedulesChanged = true;
    }
    const before = sync?.data as Sync | undefined,
      now = Date.now();
    const at: Sync = { at: now, ...((schedulesChanged || before?.schedulesAt) && { schedulesAt: schedulesChanged ? now : before!.schedulesAt }) };
    if (sync) await ctx.db.patch(sync._id, { data: at });
    else await ctx.db.insert("live", { hospitalId: h._id, kind: "sync", code: "", data: at });
    return { ok: true as const, changed };
  },
});
