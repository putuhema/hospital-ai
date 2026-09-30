import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, decide, MINUTE, rules, windowOf } from '../src/lib/assistant/limits.ts';

/** Counts questions the way the Convex mutation does, in memory. */
function counter(perDay?: number) {
  const counts = new Map<string, number>();
  return (visitor: string, now: number) => {
    const checks = rules(visitor, perDay).map((rule) => {
      const { start, end } = windowOf(rule, now);
      return { rule, end, key: `${rule.key}@${start}`, count: counts.get(`${rule.key}@${start}`) ?? 0 };
    });
    const verdict = decide(checks, now);
    if (verdict.ok) for (const c of checks) counts.set(c.key, c.count + 1);
    return verdict;
  };
}
const t0 = Date.UTC(2026, 8, 30, 3, 0, 0);

test('a visitor gets 6 questions a minute, then waits for the next minute', () => {
  const take = counter();
  for (let i = 0; i < 6; i++) assert.equal(take('a', t0 + i * 1000).ok, true);
  const seventh = take('a', t0 + 10_000);
  assert.deepEqual(seventh, { ok: false, retryAfterMs: MINUTE - 10_000, everyone: false });
  // Someone else isn't affected, and the next minute is fine again.
  assert.equal(take('b', t0 + 10_000).ok, true);
  assert.equal(take('a', t0 + MINUTE).ok, true);
});

test('a visitor gets 60 questions a day', () => {
  const take = counter();
  for (let i = 0; i < 60; i++) assert.equal(take('a', t0 + i * MINUTE).ok, true, `question ${i + 1}`);
  const over = take('a', t0 + 60 * MINUTE);
  assert.equal(over.ok, false);
  assert.ok(!over.ok && over.retryAfterMs > MINUTE && !over.everyone);
});

test('the whole hospital has a daily limit, and a refused question is not counted', () => {
  const take = counter(3);
  assert.equal(take('a', t0).ok, true);
  assert.equal(take('b', t0).ok, true);
  assert.equal(take('c', t0).ok, true);
  const busy = take('d', t0);
  assert.ok(!busy.ok && busy.everyone);
  assert.equal(take('d', t0 + DAY).ok, true);
});
