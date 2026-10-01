/**
 * The chat's messages and how replies arrive. A reply is a stream of events —
 * text as it is written, and cards for places and routes — from a `Replier`.
 * Until the server route exists, `cannedReplier` answers from the same tools
 * the assistant will use and from the hospital information, so the chat can
 * be built and tried with real answers.
 */
import { answered, answerParts, topicOf, type FaqEntry } from "../model/faq.ts";
import { hoursLines, hoursStatus } from "../model/place-info.ts";
import { doctorStatus } from "../model/doctors.ts";
import { DEFAULT_LANG, type Lang } from "../i18n/lang.ts";
import { typeInline, typeName } from "../i18n/places.ts";
import { normalize } from "../wayfinding/search.ts";
import { faqFor, replyLang } from "./faq-match.ts";

export { replyLang };
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
  | { type: "card"; show: MapSelection; doctor?: string }
  /** What the assistant is doing while it looks something up: the tool it is using. */
  | { type: "status"; tool: string };
export type ChatPart = Exclude<ReplyEvent, { type: "status" }>;
export type ChatMessage = {
  role: "user" | "assistant";
  parts: ChatPart[];
  /** The tool the reply is waiting on, until its text starts. */
  status?: string;
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
  if (event.type === "status") return { ...message, status: event.tool };
  const { status: _, ...rest } = message,
    last = rest.parts.at(-1);
  if (event.type === "text" && last?.type === "text")
    return { ...rest, parts: [...rest.parts.slice(0, -1), { type: "text", text: last.text + event.text }] };
  return { ...rest, parts: [...rest.parts, event] };
}

/**
 * The next thing to show from the events that have arrived, taking it off
 * `queue`. Text comes out a few characters at a time, more when a lot is
 * waiting, so an answer that arrives all at once still reads as it is written
 * and never falls far behind; cards and statuses come out whole, in order.
 */
export function nextReveal(queue: ReplyEvent[]): ReplyEvent | undefined {
  const first = queue[0];
  if (!first || first.type !== "text") return queue.shift();
  const waiting = queue.reduce((n, e) => n + (e.type === "text" ? e.text.length : 0), 0),
    budget = Math.min(48, Math.max(3, Math.ceil(waiting / 24)));
  let text = "";
  while (queue[0]?.type === "text" && text.length < budget) {
    const head = queue[0] as { type: "text"; text: string },
      take = head.text.slice(0, budget - text.length);
    text += take;
    if (take.length === head.text.length) queue.shift();
    else queue[0] = { type: "text", text: head.text.slice(take.length) };
  }
  return { type: "text", text };
}

/** A message's text, without its cards. */
export const messageText = (m: ChatMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/**
 * Questions to start with, from what this hospital has: a place people look
 * for, something about the hospital (visiting hours, a clinic's doctors, one of
 * its own questions in the visitor's language) and the nearest something.
 * They change from day to day (by `ctx.now`), so regular visitors see more.
 */
export function suggestions(ctx: AssistantContext, faq: FaqEntry[], lang: Lang = DEFAULT_LANG): string[] {
  const types = placeTypes(ctx),
    day = Math.floor((ctx.now.getTime() - ctx.now.getTimezoneOffset() * 60_000) / 86_400_000),
    pick = <T>(list: T[], shift = 0): T | undefined => list[(day + shift) % list.length];
  const where = (type: string) => (lang === "id" ? `Di mana ${typeInline(type, lang)}?` : `Where is the ${typeInline(type, lang)}?`);
  const places = ["Pharmacy", "Emergency", "Laboratory", "Radiology", "Reception desk"].filter((t) => types.includes(t));
  const place = pick(places.length ? places : types.slice(0, 1));

  const about: string[] = [];
  // Only offered when it gets the visiting hours, not any question that mentions visitors.
  const visiting = lang === "id" ? "Jam besuk?" : "Visiting hours?";
  if (faqFor(faq, visiting)) about.push(visiting);
  const clinic = pick(ctx.places.filter((p) => p.info?.doctors?.length));
  if (clinic) about.push(lang === "id" ? `Jadwal dokter ${clinic.name}` : `Doctors at ${clinic.name}`);
  for (const e of answered(faq))
    if (replyLang(e.question, lang) === lang && !about.includes(e.question) && e !== faqFor(faq, visiting)) about.push(e.question);

  const near = ["Parking", "Toilets", "Café"].find((t) => types.includes(t));
  const out = [
    place && where(place),
    pick(about),
    near ? (lang === "id" ? `${typeName(near, lang)} terdekat` : `Nearest ${typeInline(near, lang)}`) : pick(about, 1),
  ];
  return [...new Set(out.filter((q): q is string => !!q))];
}

const WHERE = /\b(where|wheres|di ?mana|letak(nya)?|arah ke|jalan ke|how (do|can) i (get|go)|way to|find|cari|lokasi)\b/;
const NEAREST = /\b(nearest|closest|terdekat)\b/;
const FILLER =
  /\b(where|wheres|is|are|the|a|an|di ?mana|letak(nya)?|arah|jalan|ke|ada|how (do|can) i (get|go) to|way to|find|cari|lokasi|nearest|closest|terdekat|please|tolong|yang|mau|saya|dong)\b/g;

const SAY = {
  en: {
    where: (p: PlaceSummary) => (p.building ? `in ${p.building}` : "on the map"),
    isAt: (name: string, where: string) => `${name} is ${where}.`,
    nearest: (type: string, name: string, where: string, minutes?: number) =>
      `Nearest ${type}: ${name} ${where}${minutes ? `, about ${minutes} min walk` : ""}.`,
    setStart: " Tap “Set where you are” below to get the closest one.",
    unknown: (phone: string | null, examples: string[]) =>
      "Sorry, I couldn't find that. " +
      (phone ? `You can call the hospital on ${phone} or ask at the information desk.` : "Please ask at the information desk.") +
      (examples.length ? ` I can help with things like ${examples.map((q) => `“${q}”`).join(" or ")}.` : ""),
  },
  id: {
    where: (p: PlaceSummary) => (p.building ? `di ${p.building}` : "di peta"),
    isAt: (name: string, where: string) => `${name} ada ${where}.`,
    nearest: (type: string, name: string, where: string, minutes?: number) =>
      `${type} terdekat: ${name} ${where}${minutes ? `, sekitar ${minutes} menit jalan kaki` : ""}.`,
    setStart: " Ketuk “Atur lokasi Anda” di bawah untuk mencari yang paling dekat.",
    unknown: (phone: string | null, examples: string[]) =>
      "Maaf, saya tidak menemukannya. " +
      (phone ? `Anda bisa menghubungi rumah sakit di ${phone} atau tanya ke bagian informasi.` : "Silakan tanya ke bagian informasi.") +
      (examples.length ? ` Saya bisa membantu misalnya ${examples.map((q) => `“${q}”`).join(" atau ")}.` : ""),
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
  // No dead end: the hospital's number, and questions it can answer.
  return [{ type: "text", text: say.unknown(hospitalPhone(faq), suggestions(ctx, faq, lang).slice(0, 2)) }];
}

const CONTACT = /\b(nomor|number|telepon|telp|phone|kontak|contact|hubungi|call|darurat|emergency|igd|ugd|wa|whatsapp)\b/;

/** The hospital's phone number, from its contact answers, if it wrote one. */
export function hospitalPhone(faq: FaqEntry[]): string | null {
  const list = answered(faq).filter((e) => topicOf(e) === "kontak" || CONTACT.test(normalize(e.question)));
  const first = [...list.filter((e) => topicOf(e) === "kontak"), ...list];
  for (const e of first) {
    const tel = answerParts(e.answer).find((p) => p.tel);
    if (tel) return tel.text.trim();
  }
  return null;
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
      if (event.type !== "text") {
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
