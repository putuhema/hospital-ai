/**
 * The little formatting replies may use, shown as text: **bold** becomes a
 * bold run, "- " or "* " at the start of a line becomes a bullet, phone numbers
 * become tappable `tel:` links, and stray Markdown marks are dropped.
 */
export type Run = { text: string; bold: boolean; tel?: string };
export type TextBlock = { kind: "p"; runs: Run[] } | { kind: "ul"; items: Run[][] };

const PHONE_RE = /(?:\+62|0\d{2,3})[\s-]?\d{3,4}[\s-]?\d{3,5}/g;

function splitPhones(text: string, bold: boolean): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(PHONE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), bold });
    const raw = m[0];
    out.push({ text: raw, bold, tel: raw.replace(/[\s-]/g, "") });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold });
  return out;
}

export function runs(text: string): Run[] {
  const tidy = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
  const out: Run[] = [];
  // An unclosed ** (still being written) stays plain until it closes.
  for (const [i, piece] of tidy.split(/\*\*(?=\S)(.+?)(?<=\S)\*\*/s).entries()) {
    if (!piece) continue;
    const clean = i % 2 ? piece : piece.replace(/\*\*(?=\s|$)/g, "");
    out.push({ text: clean, bold: i % 2 === 1 });
  }
  return out;
}

/** Inline runs with clickable phone numbers for rich chat rendering. */
function richRuns(text: string): Run[] {
  const out: Run[] = [];
  for (const r of runs(text)) {
    for (const part of splitPhones(r.text, r.bold)) out.push(part);
  }
  return out;
}

/** Split a reply into clean paragraphs and bullet lists for easy mobile scanning. */
export function blocks(text: string): TextBlock[] {
  const cleaned = text.replace(/^#{1,6}\s+/gm, "").trim();
  if (!cleaned) return [];
  const out: TextBlock[] = [];
  const lines = cleaned.split(/\r?\n/);
  let list: Run[][] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push({ kind: "p", runs: richRuns(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push({ kind: "ul", items: list });
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = trimmed.match(/^(?:[-*•])\s+(.+)$/);
    if (bullet) {
      flushPara();
      list.push(richRuns(bullet[1]));
    } else {
      flushList();
      para.push(trimmed);
    }
  }
  flushPara();
  flushList();
  return out;
}
