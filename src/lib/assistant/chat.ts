/**
 * The chat's messages and how replies arrive. A reply is a stream of events —
 * text as it is written, and cards for places and routes — from a `Replier`.
 * Until the server route exists, `cannedReplier` answers from the same tools
 * the assistant will use and from the hospital information, so the chat can
 * be built and tried with real answers.
 */
import { answered, type FaqEntry } from "../model/faq.ts";
import { hoursLines, hoursStatus } from "../model/place-info.ts";
import { doctorStatus } from "../model/doctors.ts";
import { DEFAULT_LANG, type Lang } from "../i18n/lang.ts";
import { typeInline, typeName } from "../i18n/places.ts";
import { normalize } from "../wayfinding/search.ts";
import {
  findNearest,
  getDoctorSchedule,
  placeTypes,
  searchPlaces,
  showOnMap,
  type AssistantContext,
  type MapSelection,
  type PlaceSummary,
} from "./tools.ts";

export type ReplyEvent =
  | { type: "text"; text: string }
  /** `doctor`: the card is about this doctor, who practises at the place; it shows their schedule. */
  | { type: "card"; show: MapSelection; doctor?: string };
export type ChatPart = ReplyEvent;
export type ChatMessage = {
  role: "user" | "assistant";
  parts: ChatPart[];
  /** The reply stopped with a problem, e.g. no connection; the chat says so in the visitor's language. */
  error?: "failed";
};
/**
 * What the app knows about the visitor: where they are, as a place id, and
 * the language the map is in (replies follow the visitor's own words first).
 */
export type ReplyContext = { from?: string; lang?: Lang };
export type Replier = (
  messages: ChatMessage[],
  context: ReplyContext,
  signal: AbortSignal,
) => AsyncIterable<ReplyEvent>;

/** A message with an event added; text runs on in the text part it continues. */
export function withEvent(message: ChatMessage, event: ReplyEvent): ChatMessage {
  const last = message.parts.at(-1);
  if (event.type === "text" && last?.type === "text")
    return { ...message, parts: [...message.parts.slice(0, -1), { type: "text", text: last.text + event.text }] };
  return { ...message, parts: [...message.parts, event] };
}

/** A message's text, without its cards. */
export const messageText = (m: ChatMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/** Questions to start with, from what this map has: a place, the hospital information, the nearest something. */
export function suggestions(ctx: AssistantContext, faq: FaqEntry[], lang: Lang = DEFAULT_LANG): string[] {
  const types = placeTypes(ctx),
    out: string[] = [];
  const place = ["Pharmacy", "Emergency", "Laboratory", "Radiology", "Reception desk"].find((t) => types.includes(t)) ?? types[0];
  if (place) out.push(lang === "id" ? `Di mana ${typeInline(place, lang)}?` : `Where is the ${typeInline(place, lang)}?`);
  const questions = answered(faq);
  // Only offered when it gets the visiting hours, not any question that mentions visitors.
  const visiting = lang === "id" ? "Jam besuk?" : "Visiting hours?";
  if (faqFor(faq, visiting)) out.push(visiting);
  else if (questions[0]) out.push(questions[0].question);
  const near = ["Parking", "Toilets", "Café"].find((t) => types.includes(t));
  if (near) out.push(lang === "id" ? `${typeName(near, lang)} terdekat` : `Nearest ${typeInline(near, lang)}`);
  return out;
}

// Words that tell the two languages apart, for replying in the visitor's own.
const ENGLISH = new Set(
  "where what whats how is are the a an nearest closest hours can i do does my to of and visiting which when number there please need find get".split(" "),
);
const INDONESIAN = new Set(
  "di mana dimana apa yang jam ke terdekat bisa saya ada berapa kapan apakah bagaimana untuk dan tidak besuk letak mau tolong cari dong nya".split(" "),
);

/** The language to answer in: the one the question is written in, or the map's when it can't tell. */
export function replyLang(question: string, fallback: Lang = DEFAULT_LANG): Lang {
  let en = 0,
    id = 0;
  for (const w of normalize(question).split(" ")) {
    if (ENGLISH.has(w)) en++;
    if (INDONESIAN.has(w)) id++;
  }
  return en > id ? "en" : id > en ? "id" : fallback;
}

const STOP = new Set(
  (
    "a an the is are was be to of in on at for and or do does can i you we my me it its what whats when how where wheres which who please there here any with this that " +
    "apa yang di ke dan untuk saya bisa ada bagaimana berapa kapan dengan dari ini itu mana apakah anda kami boleh"
  ).split(" "),
);
// The same idea in either language, so an English question finds an Indonesian answer and back.
const SAME: Record<string, string> = {
  // Indonesian verbs take prefixes (me-, ber-, pe-…), so the common forms are listed.
  besuk: "visit", jenguk: "visit", menjenguk: "visit", berkunjung: "visit", kunjungan: "visit",
  visiting: "visit", visitor: "visit", pengunjung: "visit",
  bayar: "pay", membayar: "pay", pembayaran: "pay", payment: "pay", biaya: "pay", cost: "pay", price: "pay", harga: "pay",
  daftar: "register", mendaftar: "register", pendaftaran: "register", registration: "register",
  darurat: "emergency", gawat: "emergency", ugd: "emergency", igd: "emergency",
  parkir: "park", parking: "park", jam: "hour", hours: "hour", waktu: "hour", time: "hour", times: "hour",
  anak: "child", children: "child", kids: "child", kid: "child",
  rule: "hour", rules: "hour", aturan: "hour", peraturan: "hour", nomor: "number", telepon: "phone",
  dokter: "doctor", jadwal: "schedule", asuransi: "insurance", fasilitas: "facility", facilities: "facility",
};
/** Words that carry meaning, singular, in one vocabulary. */
const words = (text: string) =>
  normalize(text)
    .replace(/\bwi fi\b/g, "wifi")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => SAME[w] ?? (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

const WHERE = /\b(where|wheres|di ?mana|letak(nya)?|arah ke|jalan ke|how (do|can) i (get|go)|way to|find|cari|lokasi)\b/;
const NEAREST = /\b(nearest|closest|terdekat)\b/;
const FILLER =
  /\b(where|wheres|is|are|the|a|an|di ?mana|letak(nya)?|arah|jalan|ke|ada|how (do|can) i (get|go) to|way to|find|cari|lokasi|nearest|closest|terdekat|please|tolong|yang|mau|saya|dong)\b/g;

/**
 * Words most hospital questions share: alone they don't say which question it
 * is ("Jam besuk?" is not answered by "Can children visit?"), so they need another.
 */
const BROAD = new Set(["visit", "hour", "patient", "pasien", "rumah", "sakit", "hospital", "room", "ruang"]);

/** The hospital information entry the question is about, if any. */
function faqFor(faq: FaqEntry[], question: string): FaqEntry | null {
  const asked = new Set(words(question));
  let best: FaqEntry | null = null,
    score = 0;
  for (const entry of answered(faq)) {
    const s = words(entry.question)
      .filter((w) => asked.has(w))
      .reduce((n, w) => n + (BROAD.has(w) ? 0.5 : 1), 0);
    if (s > score) [best, score] = [entry, s];
  }
  return score >= 1 ? best : null;
}

const SAY = {
  en: {
    where: (p: PlaceSummary) => (p.building ? `in ${p.building}` : "on the map"),
    isAt: (name: string, where: string) => `${name} is ${where}.`,
    nearest: (type: string, name: string, where: string, minutes?: number) =>
      `Nearest ${type}: ${name} ${where}${minutes ? `, about ${minutes} min walk` : ""}.`,
    setStart: " Set where you are on the map to get the closest one.",
    unknown:
      "Sorry, I couldn't find that. I can show you places on the map and answer the hospital's common questions. For anything else, please ask at the information desk.",
  },
  id: {
    where: (p: PlaceSummary) => (p.building ? `di ${p.building}` : "di peta"),
    isAt: (name: string, where: string) => `${name} ada ${where}.`,
    nearest: (type: string, name: string, where: string, minutes?: number) =>
      `${type} terdekat: ${name} ${where}${minutes ? `, sekitar ${minutes} menit jalan kaki` : ""}.`,
    setStart: " Tentukan posisi Anda di peta untuk mencari yang paling dekat.",
    unknown:
      "Maaf, saya tidak menemukannya. Saya bisa menunjukkan tempat di peta dan menjawab pertanyaan umum tentang rumah sakit. Untuk hal lain, silakan tanya ke bagian informasi.",
  },
};

const DOCTOR = /\b(dr|drg|dokter|doktor|doctor|jadwal|praktik|praktek|spesialis|specialist|schedule)\b/;

/** Doctors the question is about, in the reply's language, with a card for where the first one practises. */
function doctorAnswer(ctx: AssistantContext, question: string, lang: Lang, from?: string): ReplyEvent[] | null {
  const found = getDoctorSchedule(ctx, { query: question, limit: 3 });
  if (!("doctors" in found)) return null;
  if (!found.doctors.length)
    return [
      {
        type: "text",
        text:
          lang === "id"
            ? "Saya tidak menemukan dokter itu di jadwal praktik. Silakan tanya ke bagian informasi."
            : "I couldn't find that doctor in the practice schedules. Please ask at the information desk.",
      },
    ];
  const lines = found.doctors.map((s) => {
    const place = ctx.places.find((p) => p.id === s.place!.id)!,
      doctor = place.info!.doctors!.find((d) => d.name === s.name)!,
      where = place.building ? `${place.name}, ${place.building}` : place.name,
      hours = hoursLines(doctor.hours, lang).join("; "),
      status = doctorStatus(doctor, ctx.now, lang)?.text.replace(" · ", ", ");
    const who = `${doctor.name}${doctor.specialty ? ` (${doctor.specialty})` : ""}`;
    return (
      (lang === "id" ? `${who} praktik di ${where}` : `${who} practises at ${where}`) +
      (hours ? `: ${hours}.` : ".") +
      (status ? ` ${status}.` : "")
    );
  });
  const first = found.doctors[0];
  return [{ type: "text", text: lines.join("\n") }, ...card(ctx, first.place!.id, from, first.name)];
}

/** Open-now in the reply's language, e.g. " Buka, sampai 16.00." */
function status(ctx: AssistantContext, id: string, lang: Lang) {
  const info = ctx.places.find((p) => p.id === id)?.info,
    s = info && hoursStatus(info, ctx.now, lang);
  return s ? ` ${s.text.replace(" · ", ", ")}.` : "";
}
function card(ctx: AssistantContext, place: string, from?: string, doctor?: string): ReplyEvent[] {
  const shown = showOnMap(ctx, { place_id: place, ...(from && from !== place && { from_place_id: from }) });
  return "show" in shown ? [{ type: "card", show: shown.show, ...(doctor && { doctor }) }] : [];
}

/** An answer from the map and the hospital information, without a model. */
export function cannedAnswer(
  ctx: AssistantContext,
  faq: FaqEntry[],
  question: string,
  { from, lang: mapLang = DEFAULT_LANG }: ReplyContext = {},
): ReplyEvent[] {
  const lang = replyLang(question, mapLang),
    say = SAY[lang];
  const q = normalize(question),
    subject = q.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (NEAREST.test(q) && subject) {
    const found = findNearest(ctx, { type: subject, ...(from && { from_place_id: from }) });
    if ("place" in found) {
      const p = found.place,
        type = lang === "id" ? typeName(p.type, lang) : typeInline(p.type, lang);
      return [
        {
          type: "text",
          text: say.nearest(type, p.name, say.where(p), found.minutes) + status(ctx, p.id, lang) + (from ? "" : say.setStart),
        },
        ...card(ctx, p.id, from),
      ];
    }
  }
  if (DOCTOR.test(q)) {
    const reply = doctorAnswer(ctx, question, lang, from);
    if (reply) return reply;
  }
  const entry = WHERE.test(q) ? null : faqFor(faq, question);
  if (entry) return [{ type: "text", text: entry.answer }];
  const hits = subject ? searchPlaces(ctx, { query: subject, limit: 3 }) : null;
  if (hits && "results" in hits && hits.results.length) {
    const [p] = hits.results;
    return [{ type: "text", text: say.isAt(p.name, say.where(p)) + status(ctx, p.id, lang) }, ...card(ctx, p.id, from)];
  }
  return [{ type: "text", text: say.unknown }];
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (!ms || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Canned replies, written out a word at a time like a model's. */
export function cannedReplier(
  context: () => { ctx: AssistantContext; faq: FaqEntry[] },
  { wordMs = 30, thinkMs = 400 } = {},
): Replier {
  return async function* (messages, reply, signal) {
    const question = messages.findLast((m) => m.role === "user");
    const { ctx, faq } = context();
    const events = cannedAnswer({ ...ctx, now: new Date() }, faq, question ? messageText(question) : "", reply);
    await pause(thinkMs, signal);
    for (const event of events) {
      if (signal.aborted) return;
      if (event.type === "card") {
        yield event;
        continue;
      }
      for (const word of event.text.match(/\S+\s*/g) ?? []) {
        if (signal.aborted) return;
        yield { type: "text", text: word };
        await pause(wordMs, signal);
      }
    }
  };
}
