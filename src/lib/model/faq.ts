/**
 * Hospital information: general questions the map can't answer (visiting
 * rules, BPJS and payment, registration, the emergency number), published
 * with the map.
 */
export type FaqEntry = { question: string; answer: string };

export const MAX_FAQ = 50;
export const MAX_QUESTION = 200;
export const MAX_ANSWER = 2000;

/**
 * Topics most hospitals are asked about, offered as a start. In Indonesian,
 * like what visitors read; the assistant also answers English questions from them.
 */
export const faqTopics: { label: string; question: string }[] = [
  { label: "Jam besuk", question: "Kapan jam besuk dan apa aturannya?" },
  { label: "BPJS & pembayaran", question: "Apakah menerima BPJS, dan bagaimana cara membayar?" },
  { label: "Pendaftaran", question: "Bagaimana cara mendaftar sebagai pasien?" },
  { label: "Nomor darurat", question: "Berapa nomor darurat rumah sakit?" },
];

/** Validates stored questions; drops blank ones and trims the rest. */
export function parseFaq(value: unknown): FaqEntry[] {
  if (value === undefined) return [];
  const list = value as FaqEntry[];
  if (
    !Array.isArray(list) ||
    list.length > MAX_FAQ ||
    list.some(
      (e) =>
        !e ||
        typeof e.question !== "string" ||
        typeof e.answer !== "string" ||
        e.question.length > MAX_QUESTION ||
        e.answer.length > MAX_ANSWER,
    )
  )
    throw Error("Invalid hospital information");
  return list
    .map((e) => ({ question: e.question.trim(), answer: e.answer.trim() }))
    .filter((e) => e.question || e.answer);
}

/** What visitors see: questions still being written stay in the editor. */
export const answered = (faq: FaqEntry[]) => faq.filter((e) => e.question && e.answer);

/**
 * An answer split so phone numbers (three or more digits, e.g. "118" or
 * "+62 361 123 456") can be tapped to call. Times and prices such as
 * "08:00-16:00" or "Rp 50.000" stay text.
 */
export function answerParts(answer: string): { text: string; tel?: string }[] {
  const parts: { text: string; tel?: string }[] = [];
  let last = 0;
  for (const m of answer.matchAll(/(?<![\w:.])\+?\(?\d[\d\s()-]*\d(?![:.]\d)/g)) {
    const tel = m[0].replace(/[^\d+]/g, "");
    if (tel.replace("+", "").length < 3) continue;
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ text: m[0], tel });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
}
