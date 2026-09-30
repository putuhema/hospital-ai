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
import { dateOf, doctorStatus, shortDate, type Doctor } from "../model/doctors.ts";
import { shortcuts } from "../wayfinding/shortcuts.ts";

/** What the tools know: the published map and the time at the hospital. */
export type AssistantContext = {
  places: Place[];
  grid: NavGrid;
  /** The hospital's local time: its day, hours and minutes are read for open-now. */
  now: Date;
};

/** The context for a layout (as `parseLayout` returns it) at a moment. */
export function assistantContext(
  layout: { pieces: Piece[]; network: WalkingNetwork; grid: { width: number; height: number } },
  now: Date,
): AssistantContext {
  return {
    places: places(layout.pieces, layout.network),
    grid: buildGrid(layout.pieces, layout.grid.width, layout.grid.height),
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
  return d;
}

function schedule(ctx: AssistantContext, d: Doctor, place?: Place): DoctorSchedule {
  const s: DoctorSchedule = { name: d.name, hours: hoursLines(d.hours) };
  if (d.specialty) s.specialty = d.specialty;
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
  const wordsOf = (d: Doctor) => normalize(`${d.name} ${d.specialty ?? ""}`).split(" ");
  const fits = (t: string, words: string[]) =>
    words.some((w) => w.startsWith(t) || (t.length >= 4 && editDistance(t, w, 1) <= 1));
  // The rest of the question ("when does … see patients") is words no doctor has.
  const everyone = all.flatMap(({ d }) => wordsOf(d)),
    known = wanted.filter((t) => fits(t, everyone));
  let found = wanted.length && !known.length ? [] : all.filter(({ d }) => known.every((t) => fits(t, wordsOf(d))));
  // Words search knows but the schedule doesn't use, e.g. "children" for "Anak".
  if (!found.length && wanted.length)
    found = search(ctx.places, query).flatMap(({ place, via }) =>
      (place.info?.doctors ?? []).filter((d) => via && (d.name === via || d.specialty === via)).map((d) => ({ p: place, d })),
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
      properties: { place_id: id("place"), from_place_id: id("starting place") },
      required: ["place_id"],
    },
  },
];

const tools: Record<string, (ctx: AssistantContext, input: never) => object> = {
  search_places: searchPlaces,
  get_place_details: getPlaceDetails,
  get_doctor_schedule: getDoctorSchedule,
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
