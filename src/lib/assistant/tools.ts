/**
 * The hospital assistant's tools, as plain code. The assistant never guesses
 * hospital facts: it calls these and answers from what they return. Each tool
 * takes JSON input and returns JSON the model can read; problems come back as
 * `{ error }` so the model can say so or try again, never as exceptions.
 */
import type { Piece } from "../model/layout.ts";
import { hoursLines, hoursStatus } from "../model/place-info.ts";
import type { WalkingNetwork } from "../wayfinding/navigation.ts";
import {
  buildGrid,
  nearestOfType,
  places,
  planRoute,
  walkMinutes,
  type NavGrid,
  type Place,
} from "../wayfinding/routing.ts";
import { editDistance, normalize, search } from "../wayfinding/search.ts";
import { dateOf, doctorStatus, shortDate, specialtyOf, type Doctor } from "../model/doctors.ts";
import { shortcuts } from "../wayfinding/shortcuts.ts";
import { topicOf, topics, type FaqEntry } from "../model/faq.ts";
import { faqMatches } from "./faq-match.ts";
import { clinicKey, COUNTER_KEY, doctorToday, liveFor, quotaLeft, started, wardKey, type ClinicLive, type CounterLive, type Live, type WardLive } from "../model/live.ts";

/** What the tools know: the hospital map and the time at the hospital. */
export type AssistantContext = {
  places: Place[];
  grid: NavGrid;
  /** The hospital's questions & answers, for `search_hospital_info`. */
  faq?: FaqEntry[];
  /** The hospital's local time: its day, hours and minutes are read for open-now. */
  now: Date;
  /** Today's queue and the beds from SIMRS (model/live.ts), while the bridge at the hospital is reporting. */
  live?: Live | null;
  /** Set once a tool has answered from the live figures: such a reply is true only now, so it isn't kept for the next visitor. */
  liveUsed?: boolean;
};

/** The context for a layout (as `parseLayout` returns it) at a moment. */
export function assistantContext(
  layout: { pieces: Piece[]; network: WalkingNetwork; grid: { width: number; height: number }; faq?: FaqEntry[] },
  now: Date,
): AssistantContext {
  return {
    places: places(layout.pieces, layout.network),
    grid: buildGrid(layout.pieces, layout.grid.width, layout.grid.height),
    ...(layout.faq && { faq: layout.faq }),
    now,
  };
}

/** A place as the model sees it. `id` is what the other tools take. */
export type PlaceSummary = {
  id: string;
  name: string;
  /** What it is, e.g. "Pharmacy", "Parking" or "Building". */
  type: string;
  building?: string;
  /** e.g. "Open now · until 16:00"; only when hours are set. */
  status?: string;
  open?: boolean;
  /** The other name the search matched, e.g. a doctor who works there. */
  matched?: string;
};

export type PlaceDetails = PlaceSummary & {
  description?: string;
  phone?: string;
  /** e.g. ["Mon–Fri 08:00–16:00"]. */
  hours?: string[];
  /** The hours are visiting hours (a ward), not opening hours. */
  visiting_hours?: boolean;
  other_names?: string[];
  /** Doctors who practise here. */
  doctors?: DoctorSchedule[];
  /** Today's registrations and queue here, live from SIMRS. */
  queue_today?: ClinicQueue[];
  /** The beds here right now, live from SIMRS. */
  beds_now?: WardBeds[];
  /** The registration counters' queue here, live from SIMRS. */
  registration_queue?: RegistrationQueue;
};

/** The registration counters' queue (antrean loket pendaftaran) as the model sees it. */
export type RegistrationQueue = {
  /** Where the counters are on the map, when a place is linked to them. */
  place?: PlaceSummary;
  tickets_taken_today: number;
  waiting: number;
  /** The ticket number called last, e.g. "036". */
  last_called?: string;
  counters: { counter: number; serving: string }[];
};

/** A clinic's queue today as the model sees it. */
export type ClinicQueue = {
  clinic: string;
  /** Where it is on the map, when a place is linked to it. */
  place?: PlaceSummary;
  registered_today: number;
  waiting: number;
  doctors: {
    name: string;
    registered_today: number;
    waiting: number;
    /** The queue number called last. */
    now_serving?: string;
    quota?: number;
    quota_left?: number;
  }[];
};

/** A ward's beds as the model sees them. */
export type WardBeds = {
  ward: string;
  place?: PlaceSummary;
  beds: number;
  empty: number;
  classes: { class: string; beds: number; empty: number }[];
};

/** A doctor's schedule as the model sees it. */
export type DoctorSchedule = {
  name: string;
  specialty?: string;
  /** Where they practise; left out inside `get_place_details`, which is about that place. */
  place?: PlaceSummary;
  /** e.g. ["Mon, Wed 08:00–12:00"]. */
  hours: string[];
  /** e.g. "Practising · until 12:00" or "On leave · back Mon 08:00". */
  status?: string;
  practising?: boolean;
  on_leave?: boolean;
  /** Leave today or coming up, e.g. ["30 Sep – 2 Oct"]. */
  leave?: string[];
  /** While practising, from SIMRS: whether they have started seeing today's patients, and how many they have seen. */
  seeing_patients?: boolean;
  seen_today?: number;
  /** The schedule is SIMRS's own. */
  from_simrs?: boolean;
};

export type Directions = {
  from: PlaceSummary;
  to: PlaceSummary;
  meters: number;
  minutes: number;
  steps: string[];
};

/** A place or a route for the app to show; `link` is the map's own query string. */
export type MapSelection =
  | { kind: "place"; to: string; link: string }
  | { kind: "route"; from: string; to: string; link: string; meters: number; minutes: number };

export type ToolError = { error: string };

function summary(ctx: AssistantContext, p: Place, matched?: string): PlaceSummary {
  const s: PlaceSummary = { id: p.id, name: p.name, type: p.detail };
  if (p.building) s.building = p.building;
  const status = p.info && hoursStatus(p.info, ctx.now);
  if (status) {
    s.status = status.text;
    s.open = status.open;
  }
  if (matched) s.matched = matched;
  return s;
}

const byId = (ctx: AssistantContext, id: string) => ctx.places.find((p) => p.id === id);
const unknown = (id: string): ToolError => ({
  error: `There is no place with id "${id}". Use search_places to find its id.`,
});

/** Places matching what the visitor said, best first. */
export function searchPlaces(
  ctx: AssistantContext,
  { query, limit = 5 }: { query: string; limit?: number },
): { results: PlaceSummary[] } | ToolError {
  if (!normalize(query)) return { error: "The query is empty." };
  const results = search(ctx.places, query)
    .slice(0, Math.min(Math.max(1, Math.round(limit)), 20))
    .map((m) => summary(ctx, m.place, m.via));
  return { results };
}

/** Everything the map knows about one place, with whether it is open now. */
export function getPlaceDetails(
  ctx: AssistantContext,
  { place_id }: { place_id: string },
): PlaceDetails | ToolError {
  const p = byId(ctx, place_id);
  if (!p) return unknown(place_id);
  const d: PlaceDetails = summary(ctx, p);
  if (p.info?.description) d.description = p.info.description;
  if (p.info?.phone) d.phone = p.info.phone;
  if (p.info?.hours?.length) {
    d.hours = hoursLines(p.info.hours);
    if (p.info.visiting) d.visiting_hours = true;
  }
  if (p.info?.keywords?.length) d.other_names = p.info.keywords;
  if (p.info?.doctors?.length) d.doctors = p.info.doctors.map((doc) => schedule(ctx, doc));
  const live = liveFor(p.info?.simrs, ctx.live);
  if (live) {
    ctx.liveUsed = true;
    if (live.clinics.length) d.queue_today = live.clinics.map((c) => queueOf(ctx, c, false));
    if (live.wards.length) d.beds_now = live.wards.map((w) => bedsOf(ctx, w, false));
    if (live.counter) d.registration_queue = counterOf(ctx, live.counter, false);
  }
  return d;
}

const linked = (ctx: AssistantContext, key: string) => ctx.places.find((p) => p.info?.simrs?.includes(key));

function queueOf(ctx: AssistantContext, c: ClinicLive, withPlace = true): ClinicQueue {
  const place = withPlace && linked(ctx, clinicKey(c.code));
  return {
    clinic: c.name,
    ...(place && { place: summary(ctx, place) }),
    registered_today: c.registered,
    waiting: c.waiting,
    doctors: c.doctors
      .filter((d) => d.registered || d.quota)
      .map((d) => ({
        name: d.name,
        registered_today: d.registered,
        waiting: d.waiting,
        ...(d.serving && { now_serving: d.serving }),
        ...(d.quota !== undefined && { quota: d.quota, quota_left: quotaLeft(d) }),
      })),
  };
}

function bedsOf(ctx: AssistantContext, w: WardLive, withPlace = true): WardBeds {
  const place = withPlace && linked(ctx, wardKey(w.code));
  return {
    ward: w.name,
    ...(place && { place: summary(ctx, place) }),
    beds: w.beds,
    empty: w.empty,
    classes: w.classes.map((k) => ({ class: k.name, beds: k.beds, empty: k.empty })),
  };
}

const ticket = (n: number) => String(n).padStart(3, "0");
function counterOf(ctx: AssistantContext, k: CounterLive, withPlace = true): RegistrationQueue {
  const place = withPlace && linked(ctx, COUNTER_KEY);
  return {
    ...(place && { place: summary(ctx, place) }),
    tickets_taken_today: k.tickets,
    waiting: k.waiting,
    ...(k.called && { last_called: ticket(k.called) }),
    counters: k.counters.map((c) => ({ counter: c.no, serving: ticket(c.serving) })),
  };
}

const NO_LIVE: ToolError = {
  error:
    "The live figures from the hospital's system (SIMRS) aren't available right now. Don't guess them; say so and point the visitor to registration (pendaftaran).",
};
// Words in a question about queues or beds that aren't part of a clinic's, doctor's or ward's name.
const LIVE_WORDS = new Set(
  "poli poliklinik klinik clinic antrian antrean queue nomor dokter doctor dr drg kamar tempat tidur bed beds kosong tersedia empty available ruang ruangan rawat inap bangsal ward hari ini today sekarang now berapa ada masih".split(
    " ",
  ),
);
/** Whether every word of the query is in the text: short words ("1", "vip") whole, longer ones from their start. */
function named(query: string | undefined, text: string) {
  const wanted = normalize(query ?? "")
      .split(" ")
      .filter((w) => w && !LIVE_WORDS.has(w)),
    words = normalize(text).split(" ");
  return wanted.every((t) => words.some((w) => (t.length < 3 ? w === t : w.startsWith(t))));
}

/** Today's registrations and queue per clinic, live from SIMRS: how many wait, the number being served, quota left. */
export function getClinicQueue(
  ctx: AssistantContext,
  { query, limit = 10 }: { query?: string; limit?: number },
): { clinics: ClinicQueue[] } | ToolError {
  if (!ctx.live) return NO_LIVE;
  ctx.liveUsed = true;
  const n = Math.min(Math.max(1, Math.round(limit)), 30);
  // By the clinic's name or its place on the map ("anak" finds Poliklinik Anak), else by a doctor there.
  const text = (c: ClinicLive) => `${c.name} ${linked(ctx, clinicKey(c.code))?.name ?? ""}`;
  const everything = named(query, "");
  let found = ctx.live.clinics.filter((c) => named(query, text(c)));
  if (!found.length) found = ctx.live.clinics.filter((c) => c.doctors.some((d) => named(query, d.name)));
  return {
    clinics: found
      // Asked about no clinic in particular: the ones with patients today, busiest first.
      .filter((c) => !everything || c.registered > 0)
      .sort((a, b) => b.registered - a.registered)
      .slice(0, n)
      .map((c) => queueOf(ctx, c)),
  };
}

/** The registration counters' queue right now, live from SIMRS: tickets taken, the number called last, how many wait. */
export function getRegistrationQueue(ctx: AssistantContext, _input: object): RegistrationQueue | ToolError {
  if (!ctx.live) return NO_LIVE;
  if (!ctx.live.counter) return { error: "This hospital's system doesn't report the registration counters' queue. Say so; don't guess." };
  ctx.liveUsed = true;
  return counterOf(ctx, ctx.live.counter);
}

/** Empty beds per ward and class right now, live from SIMRS. */
export function getBedAvailability(
  ctx: AssistantContext,
  { query, limit = 20 }: { query?: string; limit?: number },
): { wards: WardBeds[]; empty_in_all: number } | ToolError {
  if (!ctx.live) return NO_LIVE;
  ctx.liveUsed = true;
  const n = Math.min(Math.max(1, Math.round(limit)), 60);
  const text = (w: WardLive) => `${w.name} ${linked(ctx, wardKey(w.code))?.name ?? ""} ${w.classes.map((k) => k.name).join(" ")}`;
  const found = ctx.live.wards.filter((w) => named(query, text(w)));
  return {
    wards: found
      .sort((a, b) => b.empty - a.empty)
      .slice(0, n)
      .map((w) => bedsOf(ctx, w)),
    empty_in_all: found.reduce((sum, w) => sum + w.empty, 0),
  };
}

function schedule(ctx: AssistantContext, d: Doctor, place?: Place): DoctorSchedule {
  const s: DoctorSchedule = { name: d.name, hours: hoursLines(d.hours) };
  const specialty = specialtyOf(d);
  if (specialty) s.specialty = specialty;
  if (place) s.place = summary(ctx, place);
  const status = doctorStatus(d, ctx.now);
  if (status) {
    s.status = status.text;
    s.practising = status.practising;
    if (status.onLeave) s.on_leave = true;
  }
  const today = dateOf(ctx.now),
    leave = (d.leave ?? []).filter((l) => l.to >= today).map((l) => (l.from === l.to ? shortDate(l.from, "en") : `${shortDate(l.from, "en")} – ${shortDate(l.to, "en")}`));
  if (leave.length) s.leave = leave;
  if (d.code) s.from_simrs = true;
  const queue = doctorToday(ctx.live, d.code),
    begun = started(queue);
  if (status?.practising && queue && begun !== undefined) {
    s.seeing_patients = begun;
    s.seen_today = queue.registered - queue.waiting;
    ctx.liveUsed = true;
  }
  return s;
}

// Words in a question about a doctor that aren't part of their name or specialty.
const DOCTOR_WORDS = new Set(
  "dr drg dokter doktor doctor doctors sp spesialis specialist poli clinic klinik jadwal schedule praktik praktek kapan when hari ini today".split(
    " ",
  ),
);

/**
 * Doctors by name or specialty, e.g. "dr sari", "anak" or "penyakit dalam",
 * with where they practise, their hours and whether they are in now. Also
 * understands what search does ("children" finds the paediatrician).
 */
export function getDoctorSchedule(
  ctx: AssistantContext,
  { query, limit = 5 }: { query: string; limit?: number },
): { doctors: DoctorSchedule[] } | ToolError {
  const wanted = normalize(query)
    .split(" ")
    .filter((w) => w && !DOCTOR_WORDS.has(w));
  const all = ctx.places.flatMap((p) => (p.info?.doctors ?? []).map((d) => ({ p, d })));
  if (!all.length) return { error: "No doctors' schedules are on this map." };
  // A doctor is found by their name, specialty or the clinic they practise in ("poli paru").
  const wordsOf = (d: Doctor, p: Place) => normalize(`${d.name} ${specialtyOf(d) ?? ""} ${p.name}`).split(" ");
  // Words as written first, then allowing a typo: "gigi" is Poli Gigi, not Poli Gizi.
  const exact = (t: string, words: string[]) => words.some((w) => w.startsWith(t)),
    typo = (t: string, words: string[]) => exact(t, words) || (t.length >= 4 && words.some((w) => editDistance(t, w, 1) <= 1));
  const everyone = all.flatMap(({ d, p }) => wordsOf(d, p));
  function matching(fits: (t: string, words: string[]) => boolean) {
    // The rest of the question ("when does … see patients") is words no doctor has.
    const known = wanted.filter((t) => fits(t, everyone));
    return wanted.length && !known.length ? [] : all.filter(({ d, p }) => known.every((t) => fits(t, wordsOf(d, p))));
  }
  let found = matching(exact);
  if (!found.length) found = matching(typo);
  // Words search knows but the schedule doesn't use, e.g. "children" for "Anak".
  if (!found.length && wanted.length)
    found = search(ctx.places, query).flatMap(({ place, via }) =>
      (place.info?.doctors ?? []).filter((d) => via && (d.name === via || specialtyOf(d) === via)).map((d) => ({ p: place, d })),
    );
  const n = Math.min(Math.max(1, Math.round(limit)), 20);
  return { doctors: found.slice(0, n).map(({ p, d }) => schedule(ctx, d, p)) };
}

/**
 * The kinds of place `find_nearest` understands in this layout. A type is
 * matched by name ("Toilets"), then by what people call it ("wc", "apotek").
 */
export const placeTypes = (ctx: AssistantContext) => shortcuts(ctx.places).map((s) => s.name);

function resolveType(ctx: AssistantContext, type: string): string | null {
  const types = placeTypes(ctx),
    wanted = normalize(type);
  const exact = types.find((t) => normalize(t) === wanted);
  if (exact) return exact;
  // Search understands synonyms and typos: take the type of the best match.
  const hit = search(
    ctx.places.filter((p) => types.includes(p.detail)),
    type,
  )[0];
  return hit?.place.detail ?? null;
}

/** The closest place of a kind, by walking distance from where the visitor is. */
export function findNearest(
  ctx: AssistantContext,
  { type, from_place_id }: { type: string; from_place_id?: string },
): { place: PlaceSummary; meters?: number; minutes?: number } | ToolError {
  const from = from_place_id === undefined ? null : byId(ctx, from_place_id);
  if (from === undefined) return unknown(from_place_id!);
  const resolved = resolveType(ctx, type);
  if (!resolved)
    return { error: `This map has no "${type}". Types on this map: ${placeTypes(ctx).join(", ") || "none"}.` };
  const place = nearestOfType(ctx.grid, ctx.places, resolved, from)!;
  const route = from && planRoute(ctx.grid, from, place);
  return route
    ? { place: summary(ctx, place), meters: route.meters, minutes: walkMinutes(route.meters) }
    : { place: summary(ctx, place) };
}

/** Walking directions between two places, step by step. */
export function getDirections(
  ctx: AssistantContext,
  { from_place_id, to_place_id }: { from_place_id: string; to_place_id: string },
): Directions | ToolError {
  const from = byId(ctx, from_place_id),
    to = byId(ctx, to_place_id);
  if (!from) return unknown(from_place_id);
  if (!to) return unknown(to_place_id);
  const route = planRoute(ctx.grid, from, to);
  if (!route) return { error: `There is no walking route from ${from.name} to ${to.name} on the map.` };
  return {
    from: summary(ctx, from),
    to: summary(ctx, to),
    meters: route.meters,
    minutes: walkMinutes(route.meters),
    steps: route.steps.map((s) => s.text),
  };
}

/**
 * The hospital's answers about what the question is about: registration,
 * BPJS and payment, visiting, facilities, contacts and the rest.
 */
export function searchHospitalInfo(
  ctx: AssistantContext,
  { query, limit = 3 }: { query: string; limit?: number },
): { results: { topic: string; question: string; answer: string }[] } {
  const n = Math.min(Math.max(1, Math.round(limit)), 10);
  return {
    results: faqMatches(ctx.faq ?? [], query, n).map((e) => ({
      topic: topics.find((t) => t.id === topicOf(e))!.name.id,
      question: e.question,
      answer: e.answer,
    })),
  };
}

/** A place, or a route when there is a start, for the app to show on the map. */
export function showOnMap(
  ctx: AssistantContext,
  { place_id, from_place_id }: { place_id: string; from_place_id?: string },
): { shown: string; show: MapSelection } | ToolError {
  const to = byId(ctx, place_id);
  if (!to) return unknown(place_id);
  if (from_place_id === undefined)
    return { shown: to.name, show: { kind: "place", to: to.id, link: `?to=${to.id}` } };
  const from = byId(ctx, from_place_id);
  if (!from) return unknown(from_place_id);
  const route = planRoute(ctx.grid, from, to);
  if (!route) return { error: `There is no walking route from ${from.name} to ${to.name} on the map.` };
  return {
    shown: `Route from ${from.name} to ${to.name}`,
    show: {
      kind: "route",
      from: from.id,
      to: to.id,
      link: `?from=${from.id}&to=${to.id}`,
      meters: route.meters,
      minutes: walkMinutes(route.meters),
    },
  };
}

type Schema = { type: "object"; properties: Record<string, object>; required: string[] };
export type ToolDefinition = { name: string; description: string; input_schema: Schema };

const id = (what: string) => ({ type: "string", description: `The ${what}'s id, from search_places or another tool.` });

/** Tool definitions in the shape the Claude API takes. */
export const toolDefinitions: ToolDefinition[] = [
  {
    name: "search_places",
    description:
      "Find rooms, buildings, landmarks and car parks on the hospital map by what the visitor calls them. " +
      "Understands English and Indonesian, synonyms (\"x-ray\" finds Radiology, \"apotek\" the Pharmacy), " +
      "doctors' names and typos. Returns the best matches with their ids and whether they are open now. " +
      "An empty result means the map has no such place.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the visitor is looking for, in their words." },
        limit: { type: "integer", description: "At most this many results (default 5, up to 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_place_details",
    description:
      "Everything the map knows about one place: what it is, its building, description, phone number, " +
      "opening or visiting hours, whether it is open right now, and the doctors who practise there.",
    input_schema: { type: "object", properties: { place_id: id("place") }, required: ["place_id"] },
  },
  {
    name: "search_hospital_info",
    description:
      "The hospital's own answers to general questions: registration (pendaftaran), BPJS and payment, visiting " +
      "hours and rules (jam besuk), facilities, services, contacts and phone numbers. Understands English and " +
      "Indonesian. Returns the best matching questions with the hospital's answers; an empty result means the " +
      "hospital hasn't written about it.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the visitor wants to know, in their words." },
        limit: { type: "integer", description: "At most this many answers (default 3, up to 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_doctor_schedule",
    description:
      "Doctors' practice schedules (jadwal praktik dokter): find doctors by name or by specialty (poli), " +
      'e.g. "dr Sari", "anak", "penyakit dalam" or "children", and get where they practise, their days and ' +
      "hours, whether they are practising now, and any leave (cuti). An empty query lists the doctors.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The doctor's name or the specialty, in the visitor's words." },
        limit: { type: "integer", description: "At most this many doctors (default 5, up to 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_clinic_queue",
    description:
      "Today's registrations and queue (antrean) per clinic (poli), live from the hospital's system (SIMRS): how many " +
      "registered, how many still wait, the queue number being served per doctor, and how much of a doctor's quota " +
      'is left. Give the clinic or doctor, e.g. "anak" or "dr Sari"; without a query it lists today\'s busiest clinics. ' +
      "No patient names. An error means the live figures aren't available.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The clinic or the doctor, in the visitor's words." },
        limit: { type: "integer", description: "At most this many clinics (default 10, up to 30)." },
      },
      required: [],
    },
  },
  {
    name: "get_registration_queue",
    description:
      "The queue at the registration counters (antrean loket pendaftaran / rekam medis) right now, live from the " +
      "hospital's system (SIMRS): queue tickets taken today, the number called last, how many still wait, and the " +
      "number each counter (loket) is serving. An error means the figures aren't available.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_bed_availability",
    description:
      "Empty beds (tempat tidur / kamar kosong) per inpatient ward and class right now, live from the hospital's " +
      'system (SIMRS). Give a ward or a class, e.g. "Melati", "ICU", "VIP" or "kelas 1"; without a query it lists ' +
      "every ward, the emptiest first. An error means the live figures aren't available.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The ward or class, in the visitor's words." },
        limit: { type: "integer", description: "At most this many wards (default 20, up to 60)." },
      },
      required: [],
    },
  },
  {
    name: "find_nearest",
    description:
      "The closest place of a kind, such as toilets, pharmacy, parking or café, by walking distance from " +
      "where the visitor is. Without a starting place it returns one of that kind with no distance. " +
      "If the kind isn't on the map, the error lists the kinds that are.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: 'The kind of place, e.g. "Toilets", "Pharmacy" or "Parking".' },
        from_place_id: id("visitor's current place"),
      },
      required: ["type"],
    },
  },
  {
    name: "get_directions",
    description:
      "Walking directions from one place to another: distance, walking time and the steps. " +
      "Ask where the visitor is if you don't know.",
    input_schema: {
      type: "object",
      properties: { from_place_id: id("starting place"), to_place_id: id("destination") },
      required: ["from_place_id", "to_place_id"],
    },
  },
  {
    name: "show_on_map",
    description:
      "Show a place on the visitor's map, or the route to it when you give a starting place. " +
      "Use it whenever you mention a place the visitor wants to go to.",
    input_schema: {
      type: "object",
      properties: {
        place_id: id("place"),
        from_place_id: id("starting place"),
        doctor_name: {
          type: "string",
          description: "When showing where a doctor practises, their name as get_doctor_schedule gave it, so the card shows their schedule.",
        },
      },
      required: ["place_id"],
    },
  },
];

const tools: Record<string, (ctx: AssistantContext, input: never) => object> = {
  search_places: searchPlaces,
  get_place_details: getPlaceDetails,
  get_doctor_schedule: getDoctorSchedule,
  get_clinic_queue: getClinicQueue,
  get_registration_queue: getRegistrationQueue,
  get_bed_availability: getBedAvailability,
  search_hospital_info: searchHospitalInfo,
  find_nearest: findNearest,
  get_directions: getDirections,
  show_on_map: showOnMap,
};

/** Checks input against a tool's schema: required fields, and strings and integers where expected. */
function invalid(def: ToolDefinition, input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The input must be an object.";
  const given = input as Record<string, unknown>;
  for (const key of def.input_schema.required)
    if (given[key] === undefined) return `"${key}" is required.`;
  for (const [key, value] of Object.entries(given)) {
    const prop = def.input_schema.properties[key] as { type: string } | undefined;
    if (!prop) return `Unknown input "${key}".`;
    if (prop.type === "string" && typeof value !== "string") return `"${key}" must be a string.`;
    if (prop.type === "integer" && !Number.isInteger(value)) return `"${key}" must be a whole number.`;
  }
  return null;
}

/** Run a tool by name, as the model called it. */
export function runTool(ctx: AssistantContext, name: string, input: unknown): object {
  const def = toolDefinitions.find((d) => d.name === name);
  if (!def) return { error: `There is no tool called "${name}".` };
  const problem = invalid(def, input);
  if (problem) return { error: problem };
  return tools[name](ctx, input as never);
}
