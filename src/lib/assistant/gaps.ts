/**
 * Questions AIRMA couldn't answer, so the hospital knows what to add. When
 * the assistant finds nothing in its tools or the hospital information, it
 * calls `note_missing_info` with a short subject ("jam besuk", "atm"); the
 * server keeps the visitor's question under that subject, counted. Nothing
 * says who asked, long numbers (phone, BPJS, NIK) are blanked, and a subject
 * is forgotten 90 days after it was last asked.
 */
import { topics, type TopicId } from "../model/faq.ts";

/** What the assistant noted: what it was about and which topic would hold the answer. */
export type MissingInfo = { topic: TopicId; subject: string };

/** A subject as the editor sees it. */
export type Gap = {
  subject: string;
  topic: TopicId;
  count: number;
  /** The latest distinct questions, newest first. */
  questions: string[];
  firstAt: number;
  lastAt: number;
  /** When an editor marked it answered; asked again after that, it opens anew. */
  doneAt?: number;
};

export const GAP_SAMPLES = 5;
export const GAP_DAYS = 90;
export const MAX_SUBJECT = 60;
export const MAX_GAP_QUESTION = 200;

/** Words that say nothing about what was missing ("layanan cuci darah" is "cuci darah"). */
const FILLER = new Set(["layanan", "pengunjung", "informasi", "info", "tentang", "untuk", "di", "yang", "rumah", "sakit", "rs", "rsud", "ada", "apa", "dan"]);

/** The subject, tidied (lowercase, without filler words), or null when there is nothing in it. */
export function subjectOf(subject: string): string | null {
  const words = subject
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w));
  const s = (kept.length ? kept : words).join(" ").slice(0, MAX_SUBJECT).trim();
  return s || null;
}

/**
 * Whether two tidied subjects are about the same thing: the same words in any
 * order ("cuci darah hemodialisis", "hemodialisis cuci darah"), or one holding
 * every word of the other ("wifi", "password wifi") when those words aren't tiny.
 */
export function sameSubject(a: string, b: string): boolean {
  const [x, y] = [new Set(a.split(" ")), new Set(b.split(" "))];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (![...small].every((w) => big.has(w))) return false;
  return small.size === big.size || [...small].every((w) => w.length >= 4);
}

/** The topic the assistant gave, if it is one; "lainnya" otherwise. */
export const topicNamed = (topic: unknown): TopicId =>
  topics.some((t) => t.id === topic) ? (topic as TopicId) : "lainnya";

/** The question as kept: one line, long numbers (phone, BPJS, NIK, medical record) blanked, not too long. */
export function scrub(question: string): string {
  const one = question
    .replace(/\+?\d[\d\s.-]{4,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "…" : m))
    .replace(/\s+/g, " ")
    .trim();
  return one.length > MAX_GAP_QUESTION ? one.slice(0, MAX_GAP_QUESTION - 1).trimEnd() + "…" : one;
}

/** The subject after one more question about it. `row` is what was kept, or null for a new subject. */
export function withQuestion(row: Gap | null, note: MissingInfo & { question: string }, now: number): Gap {
  const question = scrub(note.question);
  // Marked answered and asked again: the answer didn't help, so it starts over.
  const fresh = !row || row.doneAt !== undefined;
  const before = fresh ? [] : row.questions;
  const same = (q: string) => q.toLowerCase() === question.toLowerCase();
  return {
    // The shorter wording names the group: "wifi" rather than "password wifi".
    subject: shorter(row?.subject, subjectOf(note.subject) ?? "lainnya"),
    topic: note.topic,
    count: fresh ? 1 : row.count + 1,
    questions: question ? [question, ...before.filter((q) => !same(q))].slice(0, GAP_SAMPLES) : before,
    firstAt: fresh ? now : row.firstAt,
    lastAt: now,
  };
}

const shorter = (a: string | undefined, b: string) => (a === undefined || b.length < a.length ? b : a);

/** Most asked first; among equals, the most recent. */
export const byNeed = (a: Gap, b: Gap) => b.count - a.count || b.lastAt - a.lastAt;

/** "today 14.20", "yesterday", "3 days ago", "12 Oct": when it was last asked. */
export function asked(at: number, now: number): string {
  const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86_400_000);
  const days = day(now) - day(at);
  const time = new Date(at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return `today ${time}`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** How many subjects the weekly email lists. */
export const DIGEST_TOP = 5;

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The weekly email to the hospital's staff: the most asked subjects AIRMA
 * couldn't answer in the last week, with a link to answer them. Null when
 * there were none.
 */
export function digest(hospital: string, gaps: Gap[], editorUrl: string, now: number): { subject: string; text: string; html: string } | null {
  const week = gaps.filter((g) => g.doneAt === undefined && g.lastAt > now - 7 * 86_400_000).sort(byNeed);
  if (!week.length) return null;
  const top = week.slice(0, DIGEST_TOP),
    more = week.length - top.length;
  const subject = `AIRMA: ${week.length} pertanyaan belum terjawab minggu ini — ${hospital}`;
  const line = (g: Gap) => `${g.count}× ${g.subject}${g.questions[0] ? ` — “${g.questions[0]}”` : ""}`;
  const text = [
    `Pengunjung ${hospital} menanyakan hal-hal ini, tetapi AIRMA belum punya jawabannya:`,
    "",
    ...top.map((g, i) => `${i + 1}. ${line(g)}`),
    ...(more ? ["", `…dan ${more} lainnya.`] : []),
    "",
    `Tulis jawabannya di ${editorUrl} — AIRMA langsung memakainya.`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;color:#1f3a2b;max-width:560px">
<p>Pengunjung <b>${escape(hospital)}</b> menanyakan hal-hal ini, tetapi AIRMA belum punya jawabannya:</p>
<ol>${top
    .map(
      (g) =>
        `<li style="margin-bottom:8px"><b>${escape(g.subject)}</b> <span style="color:#7b8c70">· ${g.count}×</span>${
          g.questions[0] ? `<br><span style="color:#4b5d47">“${escape(g.questions[0])}”</span>` : ""
        }</li>`,
    )
    .join("")}</ol>
${more ? `<p style="color:#7b8c70">…dan ${more} lainnya.</p>` : ""}
<p><a href="${escape(editorUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2d4a38;color:white;text-decoration:none">Tulis jawabannya</a></p>
<p style="color:#7b8c70;font-size:12px">AIRMA langsung memakai jawaban yang Anda tulis. Pertanyaan disimpan tanpa identitas pengunjung.</p>
</div>`;
  return { subject, text, html };
}
