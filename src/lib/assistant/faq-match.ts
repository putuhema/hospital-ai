/**
 * Matching a visitor's question to the hospital's questions & answers, in
 * English or Indonesian: words that carry meaning, one vocabulary for both
 * languages, and broad words that need company. Used by the built-in replies,
 * the suggestions and the `search_hospital_info` tool.
 */
import { answered, type FaqEntry } from "../model/faq.ts";
import { DEFAULT_LANG, type Lang } from "../i18n/lang.ts";
import { normalize } from "../wayfinding/search.ts";

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
export const words = (text: string) =>
  normalize(text)
    .replace(/\bwi fi\b/g, "wifi")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => SAME[w] ?? (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * Words most hospital questions share: alone they don't say which question it
 * is ("Jam besuk?" is not answered by "Can children visit?"), so they need another.
 */
const BROAD = new Set(["visit", "hour", "patient", "pasien", "rumah", "sakit", "hospital", "room", "ruang"]);

/** How well an entry answers the question: its words in common, broad ones counting half. */
function score(entry: FaqEntry, asked: Set<string>) {
  return words(`${entry.question} ${entry.answer}`)
    .filter((w, i, all) => asked.has(w) && all.indexOf(w) === i)
    .reduce((n, w) => n + (BROAD.has(w) ? 0.5 : 1), 0);
}

/** The answered entries that match the question, best first; a question that only shares a broad word matches none. */
export function faqMatches(faq: FaqEntry[], question: string, limit = 3): FaqEntry[] {
  const asked = new Set(words(question));
  return answered(faq)
    .map((entry, i) => ({ entry, i, s: score(entry, asked), q: score({ ...entry, answer: "" }, asked) }))
    .filter((m) => m.s >= 1)
    // The question's own words first, then the answer's, then the hospital's order.
    .sort((a, b) => b.q - a.q || b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((m) => m.entry);
}

/** The hospital information entry the question is about, if any. */
export function faqFor(faq: FaqEntry[], question: string): FaqEntry | null {
  const asked = new Set(words(question));
  let best: FaqEntry | null = null,
    top = 0;
  for (const entry of answered(faq)) {
    const s = score({ ...entry, answer: "" }, asked);
    if (s > top) [best, top] = [entry, s];
  }
  return top >= 1 ? best : null;
}

