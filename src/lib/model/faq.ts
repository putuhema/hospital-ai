/**
 * Hospital information: general questions the map can't answer (visiting
 * rules, BPJS and payment, registration, the emergency number), grouped
 * into topics and saved with the hospital.
 */
import type { Lang } from "../i18n/lang.ts";

export type TopicId = "pendaftaran" | "bpjs" | "besuk" | "fasilitas" | "layanan" | "kontak" | "lainnya";
export type FaqEntry = { question: string; answer: string; topic?: TopicId };

export const MAX_FAQ = 120;
export const MAX_QUESTION = 200;
export const MAX_ANSWER = 2000;

/**
 * The topics, in the order visitors see them, with questions most hospitals
 * are asked offered as a start. The questions are in Indonesian, like what
 * visitors read; the assistant also answers English questions from them.
 */
export const topics: { id: TopicId; name: Record<Lang, string>; starters: string[] }[] = [
  {
    id: "pendaftaran",
    name: { id: "Pendaftaran", en: "Registration" },
    starters: [
      "Bagaimana cara mendaftar sebagai pasien?",
      "Dokumen apa saja yang perlu dibawa?",
      "Bisakah mendaftar secara online?",
    ],
  },
  {
    id: "bpjs",
    name: { id: "BPJS & pembayaran", en: "BPJS & payment" },
    starters: [
      "Apakah menerima BPJS, dan bagaimana cara membayar?",
      "Bagaimana alur rujukan BPJS?",
      "Asuransi swasta apa saja yang diterima?",
    ],
  },
  {
    id: "besuk",
    name: { id: "Jam besuk", en: "Visiting" },
    starters: ["Kapan jam besuk dan apa aturannya?", "Bolehkah anak-anak ikut menjenguk?"],
  },
  {
    id: "fasilitas",
    name: { id: "Fasilitas", en: "Facilities" },
    starters: ["Apakah ada Wi-Fi untuk pengunjung?", "Apakah tersedia kursi roda?", "Berapa tarif parkir?"],
  },
  {
    id: "layanan",
    name: { id: "Layanan", en: "Services" },
    starters: ["Layanan apa saja yang buka 24 jam?", "Apakah ada layanan ambulans?", "Apakah ada medical check-up?"],
  },
  {
    id: "kontak",
    name: { id: "Kontak", en: "Contact" },
    starters: ["Berapa nomor darurat rumah sakit?", "Berapa nomor telepon informasi?"],
  },
  { id: "lainnya", name: { id: "Lainnya", en: "Other" }, starters: [] },
];

/** Ready-to-customize Indonesian draft answers for each starter question so admins never start from scratch. */
export const starterAnswers: Record<string, string> = {
  "Bagaimana cara mendaftar sebagai pasien?":
    "Ambil nomor antrean pendaftaran di lobi utama, lalu menuju loket pendaftaran dengan membawa KTP dan kartu BPJS/asuransi (jika ada).",
  "Dokumen apa saja yang perlu dibawa?":
    "Bawa KTP/KK asli, kartu BPJS Kesehatan atau asuransi lain, serta surat rujukan dari faskes tingkat pertama (untuk pasien BPJS rawat jalan).",
  "Bisakah mendaftar secara online?":
    "Ya, pasien lama dan pasien BPJS dapat mendaftar secara online melalui aplikasi Mobile JKN sebelum datang ke rumah sakit.",
  "Apakah menerima BPJS, dan bagaimana cara membayar?":
    "Ya, rumah sakit menerima BPJS Kesehatan serta pembayaran umum (tunai, QRIS, dan transfer/kartu debit) di bagian kasir.",
  "Bagaimana alur rujukan BPJS?":
    "Bawa surat rujukan aktif dari Puskesmas atau klinik faskes 1, KTP, dan kartu BPJS ke loket pendaftaran untuk pencetakan SEP sebelum menuju poliklinik.",
  "Asuransi swasta apa saja yang diterima?":
    "Silakan konfirmasi kartu asuransi swasta Anda di loket pendaftaran atau bagian informasi untuk pengecekan penjaminan.",
  "Kapan jam besuk dan apa aturannya?":
    "Jam besuk umumnya pagi (10.00–12.00) dan sore (16.00–19.00). Mohon menjaga ketenangan, mencuci tangan, dan membatasi maksimal 2 pengunjung per pasien.",
  "Bolehkah anak-anak ikut menjenguk?":
    "Demi kesehatan anak, anak di bawah usia 12 tahun tidak disarankan masuk ke ruang rawat inap, terutama ruang ICU dan isolasi.",
  "Apakah ada Wi-Fi untuk pengunjung?":
    "Wi-Fi tersedia di area lobi dan ruang tunggu utama. Silakan tanyakan nama jaringan kepada petugas informasi.",
  "Apakah tersedia kursi roda?":
    "Ya, kursi roda tersedia gratis bagi pasien yang membutuhkan. Silakan minta bantuan petugas keamanan atau bagian pendaftaran di pintu masuk.",
  "Berapa tarif parkir?":
    "Area parkir motor dan mobil tersedia di halaman rumah sakit. Tarif parkir mengikuti ketentuan retribusi setempat.",
  "Layanan apa saja yang buka 24 jam?":
    "IGD (Instalasi Gawat Darurat), Farmasi IGD, Laboratorium, dan Radiologi darurat melayani pasien selama 24 jam setiap hari.",
  "Apakah ada layanan ambulans?":
    "Ya, layanan ambulans tersedia 24 jam untuk keadaan darurat dan rujukan. Hubungi petugas IGD atau nomor darurat rumah sakit.",
  "Apakah ada medical check-up?":
    "Ya, layanan Medical Check-Up (MCU) tersedia pada hari kerja. Silakan mendaftar di loket pendaftaran pada pagi hari.",
  "Berapa nomor darurat rumah sakit?":
    "Untuk keadaan darurat, segera menuju IGD atau hubungi nomor darurat 118 / nomor IGD rumah sakit.",
  "Berapa nomor telepon informasi?":
    "Silakan hubungi bagian informasi rumah sakit atau datang langsung ke meja informasi di lobi utama.",
};

const TOPIC_IDS = new Set<string>(topics.map((t) => t.id));

/** A question's topic; ones saved before there were topics go by their starter question. */
export const topicOf = (entry: FaqEntry): TopicId =>
  entry.topic ?? topics.find((t) => t.starters.includes(entry.question))?.id ?? "lainnya";

/** Questions grouped by topic, in topic order, leaving out empty topics. */
export const byTopic = (faq: FaqEntry[]) =>
  topics
    .map((topic) => ({ topic, entries: faq.filter((e) => topicOf(e) === topic.id) }))
    .filter((g) => g.entries.length);

/** Validates stored questions; drops blank ones, trims the rest and gives each a topic. */
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
        e.answer.length > MAX_ANSWER ||
        (e.topic !== undefined && !TOPIC_IDS.has(e.topic)),
    )
  )
    throw Error("Invalid hospital information");
  return list
    .map((e) => {
      const entry = { question: e.question.trim(), answer: e.answer.trim() };
      return { ...entry, topic: topicOf({ ...entry, topic: e.topic }) };
    })
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
