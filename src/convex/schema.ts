import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The hospital, as the editor saves it: the source of truth for the visitor
 * app. Split into rows as described in lib/model/records.ts.
 */
export default defineSchema({
  /** The site: its name, canvas and walking paths. Visitors open it at / and /m/<slug>. */
  hospitals: defineTable({
    slug: v.string(),
    title: v.string(),
    /** Trees and foliage around the campus on the map: 0 none, 1 normal, 2 lush. */
    greenery: v.optional(v.number()),
    width: v.number(),
    height: v.number(),
    /** Real metres per tile of the map, for walking distances; 2 when unset. */
    tileMeters: v.optional(v.number()),
    /** Waypoints and the paths between them (their details are in `places`). */
    network: v.any(),
    /** Goes up with every saved change, so editors see each other's changes. */
    revision: v.number(),
    updatedAt: v.number(),
    /** When a leaflet was last added, changed or removed (leaflets.ts), for caches; unset before any. */
    leafletsAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]),

  /**
   * Leaflets, brochures and posters uploaded as images (lib/model/leaflets.ts):
   * the image on Vercel Blob, and its title and text for the assistant.
   */
  leaflets: defineTable({
    hospitalId: v.id("hospitals"),
    url: v.string(),
    title: v.string(),
    text: v.string(),
    topic: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_hospital", ["hospitalId", "createdAt"]),

  /** Buildings, corridors and outdoor pieces with their rooms (their details are in `places`). */
  buildings: defineTable({
    hospitalId: v.id("hospitals"),
    pieceId: v.number(),
    order: v.number(),
    piece: v.any(),
  }).index("by_hospital", ["hospitalId", "pieceId"]),

  /** What visitors read about a building, room or landmark: description, phone, hours, keywords. */
  places: defineTable({
    hospitalId: v.id("hospitals"),
    /** "b:<piece>", "r:<piece>:<room>" or "n:<waypoint>". */
    place: v.string(),
    info: v.object({
      description: v.optional(v.string()),
      phone: v.optional(v.string()),
      hours: v.optional(v.any()),
      visiting: v.optional(v.boolean()),
      keywords: v.optional(v.array(v.string())),
      simrs: v.optional(v.array(v.string())),
    }),
  }).index("by_hospital", ["hospitalId", "place"]),

  /** Doctors' practice schedules (jadwal dokter), per clinic or room. */
  doctors: defineTable({
    hospitalId: v.id("hospitals"),
    place: v.string(),
    order: v.number(),
    name: v.string(),
    specialty: v.optional(v.string()),
    hours: v.any(),
    leave: v.optional(v.array(v.object({ from: v.string(), to: v.string() }))),
  }).index("by_hospital", ["hospitalId", "place", "order"]),

  /** Questions & answers about the hospital: registration, BPJS, visiting and more. */
  faq: defineTable({
    hospitalId: v.id("hospitals"),
    order: v.number(),
    topic: v.string(),
    question: v.string(),
    answer: v.string(),
  }).index("by_hospital", ["hospitalId", "order"]),

  /**
   * Live figures from SIMRS, sent by the bridge at the hospital (live.ts): a
   * row per clinic (today's queue) and per ward (beds), one for the
   * registration counters' queue, and one "sync" row
   * with when the bridge last reported.
   */
  live: defineTable({
    hospitalId: v.id("hospitals"),
    kind: v.union(v.literal("poli"), v.literal("ward"), v.literal("loket"), v.literal("jadwal"), v.literal("sync")),
    /** kd_poli ("poli", and "jadwal": a clinic's doctors' schedules) or kd_bangsal; empty for "loket" (the registration counters' queue) and "sync". */
    code: v.string(),
    data: v.any(),
  }).index("by_hospital", ["hospitalId", "kind", "code"]),

  /** Questions the assistant answered, counted per window (lib/assistant/limits.ts). */
  chatLimits: defineTable({
    key: v.string(),
    /** When the window started. */
    window: v.number(),
    count: v.number(),
  })
    .index("by_key", ["key", "window"])
    .index("by_window", ["window"]),

  /**
   * Questions the assistant couldn't answer, per subject ("jam besuk", "atm"),
   * for the editor to fill in (lib/assistant/gaps.ts). Anonymous; forgotten
   * 90 days after the last question.
   */
  gaps: defineTable({
    hospitalId: v.id("hospitals"),
    subject: v.string(),
    topic: v.string(),
    count: v.number(),
    questions: v.array(v.string()),
    firstAt: v.number(),
    lastAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_hospital", ["hospitalId", "subject"])
    .index("by_last", ["lastAt"]),

  /**
   * Visitors who asked to be told when their queue number is near (lib/model/turn-alerts.ts):
   * the ticket and the phone's Web Push address, for the day; nothing about who they are.
   */
  turnAlerts: defineTable({
    hospitalId: v.id("hospitals"),
    ticket: v.any(),
    lang: v.union(v.literal("id"), v.literal("en")),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    /** The steps sent already: "soon", "now". */
    sent: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_hospital", ["hospitalId"])
    .index("by_endpoint", ["endpoint"])
    .index("by_created", ["createdAt"]),

  /** Recent answers to a conversation's first question, replayed instead of asking the model again. */
  chatAnswers: defineTable({
    /** A hash of the hospital version, the question, the language, where the visitor is and the model. */
    key: v.string(),
    /** The reply's text and cards, as the chat shows them. */
    events: v.any(),
    /** What the assistant noted it couldn't answer, so a replayed answer still counts. */
    missing: v.optional(v.object({ topic: v.string(), subject: v.string() })),
    expires: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expires", ["expires"]),
});
