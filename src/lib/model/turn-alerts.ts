/**
 * Queue alerts: a visitor who follows their number can ask to be told, even
 * with the phone in their pocket, when it is close ("soon": three or fewer
 * before them) and when it is called ("now"). The phone subscribes to Web
 * Push; each time SIMRS reports, the server works out each followed number's
 * turn (live.ts `turnOf`) and sends what is due, each step once.
 */
import type { Lang } from "../i18n/lang.ts";
import type { Ticket, Turn } from "./live.ts";

export type AlertStep = "soon" | "now";

/** How many numbers before theirs count as close. */
export const SOON = 3;

/** What to send for this turn, given what was sent already; null when nothing is due. */
export function dueStep(turn: Turn, sent: readonly AlertStep[]): AlertStep | null {
  if (turn.state === "now") return sent.includes("now") ? null : "now";
  if (turn.state === "waiting" && turn.ahead <= SOON && !sent.includes("soon") && !sent.includes("now")) return "soon";
  return null;
}

/** Nothing more will be sent for it: called already, or no longer in the queue. */
export const finished = (turn: Turn, sent: readonly AlertStep[]) =>
  turn.state === "passed" || (sent.includes("now") && turn.state !== "now");

const no = (n: number) => String(n).padStart(3, "0");

/** The notification, in the visitor's language. */
export function alertMessage(step: AlertStep, ticket: Ticket, turn: Turn, lang: Lang): { title: string; body: string } {
  const where = ticket.label ?? (lang === "en" ? "Registration counters" : "Loket pendaftaran");
  const number = no(ticket.number);
  if (step === "now") {
    const counter = turn.state === "now" && turn.counter;
    return lang === "en"
      ? { title: `It's your turn: ${number}`, body: counter ? `Go to counter ${counter} now. ${where}` : `Your number is being called. ${where}` }
      : { title: `Giliran Anda: ${number}`, body: counter ? `Silakan ke loket ${counter} sekarang. ${where}` : `Nomor Anda sedang dipanggil. ${where}` };
  }
  const ahead = turn.state === "waiting" ? turn.ahead : SOON;
  return lang === "en"
    ? { title: ahead ? `${ahead} more before ${number}` : `You're next: ${number}`, body: `Head back now so you don't miss it. ${where}` }
    : { title: ahead ? `${ahead} lagi sebelum ${number}` : `Berikutnya nomor Anda: ${number}`, body: `Kembali sekarang agar tidak terlewat. ${where}` };
}

/** A ticket as the browser sent it, checked; null when it isn't one. */
export function parseTicket(value: unknown): Ticket | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!Number.isInteger(t.number) || (t.number as number) <= 0 || (t.number as number) >= 100_000) return null;
  if (!text(t.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(t.day as string)) return null;
  const base = {
    number: t.number as number,
    day: t.day as string,
    ...(text(t.place, 120) && { place: t.place as string }),
    ...(text(t.label, 160) && { label: t.label as string }),
  };
  if (t.kind === "loket") return { ...base, kind: "loket" };
  if (t.kind === "poli" && text(t.clinic, 40) && text(t.doctor, 40))
    return { ...base, kind: "poli", clinic: t.clinic as string, doctor: t.doctor as string };
  return null;
}
