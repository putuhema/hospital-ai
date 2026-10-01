/**
 * Doctors' practice schedules (jadwal praktik dokter) at a clinic or room:
 * who practises there, their specialty (poli), their hours, and when they
 * are on leave (cuti). Visitors see whether a doctor is practising now.
 */
import type { Lang } from "../i18n/lang.ts";
import { clock, DAY, DAYS, minutes, tidyHours, validHours, type Hours } from "./hours.ts";

/** Days away, both ends included; dates are "YYYY-MM-DD" at the hospital. */
export type Leave = { from: string; to: string };
export type Doctor = {
  name: string;
  /** e.g. "Anak" (paediatrics) or "Penyakit Dalam". */
  specialty?: string;
  hours: Hours[];
  leave?: Leave[];
};

export const MAX_DOCTORS = 60;

/** Specialist titles (Sp.A, Sp.OG, SpB…) and what visitors call the specialty. */
const TITLES: Record<string, string> = {
  a: "Anak",
  og: "Kandungan & Kebidanan",
  pd: "Penyakit Dalam",
  p: "Paru",
  b: "Bedah",
  gk: "Gizi Klinik",
  rad: "Radiologi",
  jp: "Jantung",
  m: "Mata",
  tht: "THT",
  kk: "Kulit & Kelamin",
  dv: "Kulit & Kelamin",
  dve: "Kulit & Kelamin",
  n: "Saraf",
  s: "Saraf",
  kj: "Jiwa",
  ot: "Ortopedi",
  u: "Urologi",
  an: "Anestesi",
  pk: "Patologi Klinik",
  kfr: "Rehabilitasi Medik",
};

/** The specialty as written, or else read from the title in the name ("dr. Sari, Sp.A" → "Anak", "drg." → "Gigi"). */
export function specialtyOf(doctor: Doctor): string | undefined {
  if (doctor.specialty) return doctor.specialty;
  const name = ` ${doctor.name.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  const title = name.match(/ sp ?([a-z]+) /)?.[1];
  if (title && TITLES[title]) return TITLES[title];
  if (name.includes(" drg ")) return "Gigi";
  return undefined;
}
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Validates stored doctors; drops unnamed ones and tidies the rest. */
export function parseDoctors(value: unknown): Doctor[] | undefined {
  if (value === undefined) return undefined;
  const list = value as Doctor[];
  const text = (s: unknown, max: number) => typeof s === "string" && s.length <= max;
  if (
    !Array.isArray(list) ||
    list.length > MAX_DOCTORS ||
    list.some(
      (d) =>
        !d ||
        !text(d.name, 100) ||
        (d.specialty !== undefined && !text(d.specialty, 100)) ||
        !validHours(d.hours) ||
        (d.leave !== undefined &&
          (!Array.isArray(d.leave) ||
            d.leave.length > 20 ||
            d.leave.some((l) => !l || !DATE.test(l.from) || !DATE.test(l.to) || l.to < l.from))),
    )
  )
    throw Error("Invalid doctors");
  const doctors = list
    .filter((d) => d.name.trim())
    .map((d) => {
      const doctor: Doctor = { name: d.name.trim(), hours: tidyHours(d.hours) };
      if (d.specialty?.trim()) doctor.specialty = d.specialty.trim();
      if (d.leave?.length) doctor.leave = [...d.leave].sort((a, b) => a.from.localeCompare(b.from));
      return doctor;
    });
  return doctors.length ? doctors : undefined;
}

/** The date at `now`, as leave is stored. */
export const dateOf = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The leave covering a date, if any. */
export const leaveOn = (doctor: Doctor, date: string) =>
  doctor.leave?.find((l) => l.from <= date && date <= l.to) ?? null;

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
};
/** "3 Oct" / "3 Okt" for a stored date. */
export const shortDate = (date: string, lang: Lang) =>
  `${Number(date.slice(8))} ${MONTHS[lang][Number(date.slice(5, 7)) - 1]}`;

const WORDS = {
  en: {
    in: "Practising", later: "Not in yet", done: "Practice hours are over", off: "Not practising today",
    leave: "On leave", until: "until", from: "from", back: "back", tomorrow: "tomorrow", none: "No practice hours",
  },
  id: {
    in: "Praktik", later: "Belum praktik", done: "Jam praktik sudah habis", off: "Tidak praktik hari ini",
    leave: "Cuti", until: "sampai", from: "mulai", back: "praktik lagi", tomorrow: "besok", none: "Belum ada jadwal praktik",
  },
};

export type DoctorStatus = {
  /** Seeing patients right now. */
  practising: boolean;
  /** On leave today. */
  onLeave: boolean;
  /** e.g. "Praktik · sampai 14.00", "Jam praktik sudah habis · mulai besok 08.00", "Cuti · praktik lagi Sen 08.00". */
  text: string;
};

/**
 * Whether a doctor is practising at `now` (the hospital's local time), and
 * when that changes. Days on leave are skipped, so "next" is when they are
 * really back.
 */
export function doctorStatus(doctor: Doctor, now: Date, lang: Lang = "en"): DoctorStatus | null {
  if (!doctor.hours.length) return null;
  const w = WORDS[lang],
    at = now.getHours() * 60 + now.getMinutes(),
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    leave = leaveOn(doctor, dateOf(now));
  // Practice periods over the next four weeks, in minutes from today's midnight.
  const periods: [number, number][] = [];
  for (let d = 0; d < 28; d++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    if (leaveOn(doctor, dateOf(day))) continue;
    for (const h of doctor.hours)
      if (h.days.includes(day.getDay())) {
        const start = d * DAY + minutes(h.open);
        let end = d * DAY + minutes(h.close);
        if (end <= start) end += DAY;
        periods.push([start, end]);
      }
  }
  periods.sort((a, b) => a[0] - b[0]);
  const current = periods.find(([s, e]) => s <= at && at < e);
  if (current) return { practising: true, onLeave: false, text: `${w.in} · ${w.until} ${clock(current[1], lang)}` };
  const next = periods.find(([s]) => s > at)?.[0];
  if (next === undefined)
    return {
      practising: false,
      onLeave: !!leave,
      text: leave ? `${w.leave} · ${w.until} ${shortDate(leave.to, lang)}` : w.none,
    };
  const days = Math.floor(next / DAY),
    day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days),
    when =
      days === 0 ? "" : days === 1 ? `${w.tomorrow} ` : days < 7 ? `${DAYS[lang][day.getDay()]} ` : `${shortDate(dateOf(day), lang)} `;
  if (leave) return { practising: false, onLeave: true, text: `${w.leave} · ${w.back} ${when}${clock(next, lang)}` };
  // Later today; done for today; or no practice today at all.
  const why = days === 0 ? w.later : periods.some(([s]) => s < DAY && s <= at) ? w.done : w.off;
  return { practising: false, onLeave: false, text: `${why} · ${w.from} ${when}${clock(next, lang)}` };
}
