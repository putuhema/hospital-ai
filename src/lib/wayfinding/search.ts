import { categories } from "../model/categories.ts";
import type { Place } from "./routing.ts";
import { specialtyOf } from "../model/doctors.ts";

// Search the way visitors ask: "x-ray" finds Radiology, "blood test" the
// Laboratory, "dr sari" her clinic (from its doctors or other names), and
// "pharmcy" still finds the pharmacy.

/** Words that mean the same thing to a visitor, in English and Indonesian. */
const SYNONYMS: string[][] = [
  ["radiology", "radiologi", "x ray", "xray", "rontgen", "scan", "ct scan", "mri", "ultrasound", "usg", "imaging"],
  ["laboratory", "lab", "laboratorium", "blood test", "blood", "sample", "urine test", "cek darah", "tes darah"],
  ["toilets", "toilet", "wc", "restroom", "bathroom", "loo", "lavatory", "washroom", "kamar mandi", "kamar kecil"],
  ["pharmacy", "chemist", "drugstore", "medicine", "medication", "prescription", "drugs", "apotek", "apotik", "farmasi", "obat", "resep"],
  ["emergency", "a and e", "er", "casualty", "urgent care", "ugd", "igd", "gawat darurat", "darurat"],
  ["cashier", "kasir", "bayar", "pembayaran", "payment", "pay", "billing"],
  ["reception", "front desk", "registration", "check in", "admissions", "pendaftaran", "resepsionis", "loket"],
  ["operating theatre", "operating room", "surgery", "operation", "theatre", "kamar operasi", "bedah", "operasi"],
  ["waiting area", "waiting room", "ruang tunggu"],
  ["examination room", "exam", "consultation", "clinic", "outpatient", "doctor", "gp", "poli", "poliklinik", "dokter", "praktek"],
  ["patient room", "ward", "inpatient", "bed", "rawat inap", "bangsal", "kamar pasien"],
  ["nurse station", "nurse", "nurses", "perawat"],
  ["stairs", "stairs and lift", "staircase", "tangga"],
  ["maternity", "birth", "delivery", "obstetrics", "bersalin", "kebidanan"],
  ["paediatrics", "pediatrics", "children", "kids", "anak"],
  ["dental", "dentist", "gigi"],
  ["eye clinic", "eye", "ophthalmology", "mata"],
  ...categories.filter((c) => c.words.length).map((c) => [c.name.toLowerCase(), ...c.words]),
];

/** Lower case, no accents, "&" as "and", punctuation as spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const groups = SYNONYMS.map((g) => g.map(normalize));
/** Phrase → the groups it belongs to. */
const phrases = new Map<string, number[]>();
groups.forEach((g, i) => g.forEach((p) => phrases.set(p, [...(phrases.get(p) ?? []), i])));
const LONGEST = Math.max(...[...phrases.keys()].map((p) => p.split(" ").length));

/** Edits (insert, delete, change, swap neighbours) between two words, or max + 1 once over max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [],
    prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Typos allowed in a word of this length. */
const slack = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);
const plural = (a: string, b: string) => a === b || a + "s" === b || a === b + "s";

type Token = { text: string; groups?: number[] };

/** Query words, with known phrases ("blood test", or a misspelt "radiolgy") joined into one. */
function tokens(query: string): Token[] {
  const words = normalize(query).split(" ").filter(Boolean),
    out: Token[] = [];
  for (let i = 0; i < words.length; ) {
    let found: Token | null = null;
    for (let n = Math.min(LONGEST, words.length - i); n > 0 && !found; n--) {
      const text = words.slice(i, i + n).join(" ");
      const exact = phrases.get(text);
      if (exact) found = { text, groups: exact };
      else if (n === 1 && text.length >= 5)
        for (const [p, g] of phrases)
          if (!p.includes(" ") && editDistance(text, p, slack(text.length)) <= slack(text.length)) {
            found = { text, groups: g };
            break;
          }
      if (found) i += n;
    }
    if (!found) out.push({ text: words[i++] });
    else out.push(found);
  }
  // Words that describe any place ("tempat sholat", "the café") don't have to match, when others do.
  const meaningful = out.filter((t) => t.groups || !FILLER.has(t.text));
  return meaningful.length ? meaningful : out;
}

const FILLER = new Set(
  "tempat lokasi area ruang ruangan bagian yang untuk buat di ke dan the a an place area location room for to".split(" "),
);

type Field = { text: string; words: string[]; weight: number; keyword?: string };
const cache = new WeakMap<Place, Field[]>();
function fields(p: Place): Field[] {
  let list = cache.get(p);
  if (list) return list;
  const field = (text: string | undefined, weight: number, keyword?: string): Field[] => {
    const t = normalize(text ?? "");
    return t ? [{ text: ` ${t} `, words: t.split(" "), weight, keyword }] : [];
  };
  list = [
    ...field(p.name, 10),
    ...(p.info?.keywords ?? []).flatMap((k) => field(k, 8, k)),
    // Doctors who practise here: "dr sari" or "poli anak" finds their clinic.
    ...(p.info?.doctors ?? []).flatMap((d) => [...field(d.name, 8, d.name), ...field(specialtyOf(d), 6, specialtyOf(d))]),
    ...field(p.detail, 6),
    ...field(p.building, 3),
    ...field(p.info?.description, 2),
  ];
  cache.set(p, list);
  return list;
}

/** How well one query token matches a field, 0 – 1. */
function quality(token: Token, f: Field, last: boolean): number {
  if (token.groups) {
    const hit = token.groups.some((g) => groups[g].some((phrase) => f.text.includes(` ${phrase} `)));
    if (hit) return f.text.includes(` ${token.text} `) ? 1 : 0.85;
  }
  const w = token.text;
  let best = 0;
  for (const word of f.words) {
    if (plural(w, word)) return 1;
    if (word.startsWith(w)) best = Math.max(best, last || w.length >= 3 ? 0.8 : 0.5);
    else if (best < 0.55) {
      const allowed = slack(w.length);
      if (allowed && editDistance(w, word, allowed) <= allowed) best = 0.55;
      // Still typing the last word: compare with the start of longer words.
      else if (last && w.length >= 5 && word.length > w.length && editDistance(w, word.slice(0, w.length), 1) <= 1)
        best = Math.max(best, 0.45);
    }
  }
  return best;
}

export type Match = {
  place: Place;
  score: number;
  /** The other name that matched, e.g. a doctor's name, to show with the result. */
  via?: string;
};

const order: Record<Place["kind"], number> = { room: 0, landmark: 0, area: 0, building: 1, listed: 2 };

/** Places matching every word of the query, best first. */
export function search(list: Place[], query: string): Match[] {
  const q = tokens(query);
  if (!q.length)
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).map((place) => ({ place, score: 0 }));
  const whole = normalize(query),
    out: Match[] = [];
  for (const place of list) {
    let score = 0,
      via: string | undefined;
    for (const [i, token] of q.entries()) {
      let best = 0,
        from: Field | undefined;
      for (const f of fields(place)) {
        const s = quality(token, f, i === q.length - 1) * f.weight;
        if (s > best) [best, from] = [s, f];
      }
      if (!best) {
        score = 0;
        break;
      }
      score += best;
      if (from?.keyword) via ??= from.keyword;
    }
    if (!score) continue;
    const name = normalize(place.name);
    if (name === whole) score += 10;
    else if (name.startsWith(whole)) score += 6;
    out.push({ place, score, via });
  }
  return out.sort(
    (a, b) =>
      b.score - a.score || order[a.place.kind] - order[b.place.kind] || a.place.name.localeCompare(b.place.name),
  );
}
