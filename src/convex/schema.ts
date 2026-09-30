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
    width: v.number(),
    height: v.number(),
    /** Waypoints and the paths between them (their details are in `places`). */
    network: v.any(),
    /** Goes up with every saved change, so editors see each other's changes. */
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

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

  /** Questions the assistant answered, counted per window (lib/assistant/limits.ts). */
  chatLimits: defineTable({
    key: v.string(),
    /** When the window started. */
    window: v.number(),
    count: v.number(),
  })
    .index("by_key", ["key", "window"])
    .index("by_window", ["window"]),

  /** Recent answers to a conversation's first question, replayed instead of asking the model again. */
  chatAnswers: defineTable({
    /** A hash of the hospital version, the question, the language, where the visitor is and the model. */
    key: v.string(),
    /** The reply's text and cards, as the chat shows them. */
    events: v.any(),
    expires: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expires", ["expires"]),
});
