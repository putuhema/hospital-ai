import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asked, byNeed, digest, GAP_SAMPLES, sameSubject, scrub, subjectOf, topicNamed, withQuestion, type Gap } from '../src/lib/assistant/gaps.ts';
import { assistantContext, runTool } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';

const T = Date.parse('2026-11-17T10:00:00');

test('subjects are tidied, and an unknown topic becomes "lainnya"', () => {
  assert.equal(subjectOf('  Jam   BESUK '), 'jam besuk');
  assert.equal(subjectOf('   '), null);
  assert.equal(subjectOf('Layanan cuci darah'), 'cuci darah');
  assert.equal(subjectOf('password wifi pengunjung'), 'password wifi');
  assert.equal(subjectOf('layanan'), 'layanan');
  assert.equal(subjectOf('x'.repeat(100))!.length, 60);
  assert.equal(topicNamed('bpjs'), 'bpjs');
  assert.equal(topicNamed('parkir'), 'lainnya');
});

test('questions are kept on one line, without long numbers', () => {
  assert.equal(scrub('No BPJS saya 0001234567890,\n bisa dipakai?'), 'No BPJS saya …, bisa dipakai?');
  assert.equal(scrub('telp 0812-3456-7890 ya'), 'telp … ya');
  assert.equal(scrub('kamar 12 lantai 2, jam 10.30'), 'kamar 12 lantai 2, jam 10.30');
  assert.equal(scrub('a'.repeat(300)).length, 200);
});

test('questions are counted per subject, the latest distinct ones kept', () => {
  let gap = withQuestion(null, { topic: 'besuk', subject: 'Jam besuk', question: 'Jam besuk kapan?' }, T);
  assert.deepEqual(gap, { subject: 'jam besuk', topic: 'besuk', count: 1, questions: ['Jam besuk kapan?'], firstAt: T, lastAt: T });
  gap = withQuestion(gap, { topic: 'besuk', subject: 'jam besuk', question: 'jam besuk kapan?' }, T + 1);
  assert.equal(gap.count, 2);
  assert.deepEqual(gap.questions, ['jam besuk kapan?']);
  for (let i = 0; i < 10; i++) gap = withQuestion(gap, { topic: 'besuk', subject: 'jam besuk', question: `tanya ${i}` }, T + 2 + i);
  assert.equal(gap.count, 12);
  assert.equal(gap.questions.length, GAP_SAMPLES);
  assert.equal(gap.questions[0], 'tanya 9');
  assert.equal(gap.firstAt, T);
});

test('asked again after it was marked done, a subject starts over', () => {
  const done: Gap = { subject: 'atm', topic: 'fasilitas', count: 7, questions: ['ada atm?'], firstAt: T, lastAt: T, doneAt: T + 10 };
  const again = withQuestion(done, { topic: 'fasilitas', subject: 'atm', question: 'ATM di mana?' }, T + 20);
  assert.deepEqual(again, { subject: 'atm', topic: 'fasilitas', count: 1, questions: ['ATM di mana?'], firstAt: T + 20, lastAt: T + 20 });
});

test('most asked first, then most recent', () => {
  const g = (subject: string, count: number, lastAt: number): Gap => ({ subject, topic: 'lainnya', count, questions: [], firstAt: 0, lastAt });
  assert.deepEqual([g('a', 1, 5), g('b', 3, 1), g('c', 1, 9)].sort(byNeed).map((x) => x.subject), ['b', 'c', 'a']);
});

test('when it was last asked reads plainly', () => {
  const now = Date.parse('2026-11-17T15:00:00');
  assert.match(asked(Date.parse('2026-11-17T09:05:00'), now), /^today 09.05$/);
  assert.equal(asked(Date.parse('2026-11-16T22:00:00'), now), 'yesterday');
  assert.equal(asked(Date.parse('2026-11-14T10:00:00'), now), '3 days ago');
  assert.equal(asked(Date.parse('2026-10-12T10:00:00'), now), '12 Oct');
});

test('note_missing_info notes what was missing for the server, and checks its input', () => {
  const ctx = assistantContext(parseLayout(JSON.stringify({ pieces: starterPieces })), new Date(T));
  assert.deepEqual(runTool(ctx, 'note_missing_info', { topic: 'bpjs', subject: ' Rujukan BPJS ' }), { noted: true });
  assert.deepEqual(ctx.missing, { topic: 'bpjs', subject: 'rujukan bpjs' });
  assert.deepEqual(runTool(ctx, 'note_missing_info', { topic: 'bpjs' }), { error: '"subject" is required.' });
  assert.ok('error' in runTool(ctx, 'note_missing_info', { topic: 'bpjs', subject: '  ' }));
});

test('the same thing worded another way is one subject, named by the shorter wording', () => {
  assert.ok(sameSubject('cuci darah hemodialisis', 'hemodialisis cuci darah'));
  assert.ok(sameSubject('wifi', 'password wifi'));
  assert.ok(!sameSubject('jam', 'jam besuk'));
  assert.ok(!sameSubject('jam besuk', 'jam pendaftaran'));
  const gap = withQuestion(
    withQuestion(null, { topic: 'fasilitas', subject: 'password wifi', question: 'password wifi?' }, T),
    { topic: 'fasilitas', subject: 'wifi', question: 'ada wifi?' },
    T + 1,
  );
  assert.equal(gap.subject, 'wifi');
  assert.equal(gap.count, 2);
});

test("the weekly email lists last week's most asked, and is skipped without any", () => {
  const now = T;
  const g = (subject: string, count: number, daysAgo: number, extra: Partial<Gap> = {}): Gap => ({
    subject, topic: 'lainnya', count, questions: [`soal ${subject}`], firstAt: 0, lastAt: now - daysAgo * 86_400_000, ...extra,
  });
  const gaps = [g('wifi', 3, 1), g('cuci darah', 9, 2), g('atm', 20, 10), g('kantin', 4, 1, { doneAt: now }), ...['a', 'b', 'c', 'd'].map((x) => g(x, 1, 1))];
  const mail = digest('RSUD Uji', gaps, 'https://airma.test/editor/info#unanswered', now)!;
  assert.equal(mail.subject, 'AIRMA: 6 pertanyaan belum terjawab minggu ini — RSUD Uji');
  assert.match(mail.text, /^1\. 9× cuci darah — “soal cuci darah”$/m);
  assert.match(mail.text, /^2\. 3× wifi/m);
  assert.match(mail.text, /…dan 1 lainnya\./);
  assert.doesNotMatch(mail.text, /atm|kantin/);
  assert.match(mail.html, /href="https:\/\/airma\.test\/editor\/info#unanswered"/);
  assert.equal(digest('RSUD Uji', [g('atm', 20, 10)], 'x', now), null);
  const html = digest('RS', [g('<b>', 1, 0)], 'x', now)!.html;
  assert.match(html, /<b>&lt;b&gt;<\/b>/);
  assert.doesNotMatch(html, /<b><b>/);
});

test('the IGD button finds the emergency department, a maternity one only when there is no other', async () => {
  const { emergencyPlace } = await import('../src/lib/wayfinding/shortcuts.ts');
  const pieces = structuredClone(starterPieces);
  const buildings = pieces.filter((p) => p.name.endsWith('patient ward'));
  buildings[0].name = 'IGD PONEK';
  buildings[1].name = 'IGD';
  const ctx = assistantContext(parseLayout(JSON.stringify({ pieces })), new Date(T));
  assert.equal(emergencyPlace(ctx.places, ctx.grid, null)?.name, 'IGD');
  const onlyPonek = ctx.places.filter((p) => p.name !== 'IGD');
  assert.equal(emergencyPlace(onlyPonek, ctx.grid, null)?.name, 'IGD PONEK');
  assert.equal(emergencyPlace([], ctx.grid, null), null);
});
