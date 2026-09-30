/**
 * The little formatting replies may use, shown as text: **bold** becomes a
 * bold run, "- " or "* " at the start of a line becomes a bullet, and the
 * other Markdown marks models add (headings, stray asterisks) are dropped.
 */
export type Run = { text: string; bold: boolean };

export function runs(text: string): Run[] {
  const tidy = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
  const out: Run[] = [];
  // An unclosed ** (still being written) stays plain until it closes.
  for (const [i, piece] of tidy.split(/\*\*(?=\S)(.+?)(?<=\S)\*\*/s).entries())
    if (piece) out.push({ text: i % 2 ? piece : piece.replace(/\*\*(?=\s|$)/g, ""), bold: i % 2 === 1 });
  return out;
}
