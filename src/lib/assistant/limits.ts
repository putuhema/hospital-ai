/**
 * How many questions the assistant answers, so a visitor (or someone
 * scripting the chat) can't run up the model bill. Counted in fixed windows:
 * per visitor a minute and a day, and for the whole hospital a day.
 */
export const MINUTE = 60_000,
  DAY = 24 * 60 * MINUTE;

export type Rule = { key: string; ms: number; max: number };

/** The rules for a visitor, `visitor` being an anonymous id (a hash of their address). */
export const rules = (visitor: string, perDay = 1000): Rule[] => [
  { key: `visitor:${visitor}:minute`, ms: MINUTE, max: 6 },
  { key: `visitor:${visitor}:day`, ms: DAY, max: 60 },
  { key: "all:day", ms: DAY, max: perDay },
];

/** The window a rule is counting at `now`: when it started and when it ends. */
export const windowOf = (rule: Rule, now: number) => {
  const start = Math.floor(now / rule.ms) * rule.ms;
  return { start, end: start + rule.ms };
};

/**
 * Whether one more question fits, given how many each rule has counted in
 * its current window; if not, how long until it does.
 */
export function decide(
  checks: { rule: Rule; count: number; end: number }[],
  now: number,
): { ok: true } | { ok: false; retryAfterMs: number; everyone: boolean } {
  const full = checks.filter((c) => c.count >= c.rule.max);
  if (!full.length) return { ok: true };
  return {
    ok: false,
    retryAfterMs: Math.max(...full.map((c) => c.end - now)),
    everyone: full.some((c) => c.rule.key.startsWith("all:")),
  };
}
