import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cannedAnswer, type ReplyEvent } from '../src/lib/assistant/chat.ts';
import { assistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';

// 2026-09-28 is a Monday.
const pieces = structuredClone(starterPieces);
pieces.find((p) => p.name === 'Outpatient clinic')!.roomAssets![0].info = {
  doctors: [
    { name: 'dr. Sari Wijaya, Sp.A', specialty: 'Anak', hours: [{ days: [1, 3], open: '08:00', close: '12:00' }],
      leave: [{ from: '2026-09-30', to: '2026-10-02' }] },
    { name: 'dr. Budi Santoso, Sp.PD', specialty: 'Penyakit Dalam', hours: [{ days: [2, 4], open: '13:00', close: '16:00' }] },
  ],
};
const layout = parseLayout(JSON.stringify({ pieces }));
const ctx = (when: string) => assistantContext(layout, new Date(when));
const text = (events: ReplyEvent[]) => events.filter((e) => e.type === 'text').map((e) => e.text).join('');
const cards = (events: ReplyEvent[]) => events.filter((e) => e.type === 'card');

test('"Kapan dr. Sari praktik?" gets her schedule, today\'s status and where', () => {
  const reply = cannedAnswer(ctx('2026-09-28T09:00:00'), [], 'Kapan dr. Sari praktik?');
  assert.equal(text(reply), 'dr. Sari Wijaya, Sp.A (Anak) praktik di Exam room 1, Outpatient clinic: Sen, Rab 08.00–12.00. Praktik, sampai 12.00.');
  assert.equal(cards(reply).length, 1);
  // On leave: says when she's back (Monday, five days on).
  assert.match(text(cannedAnswer(ctx('2026-09-30T09:00:00'), [], 'jadwal dr sari')), /Cuti, praktik lagi Sen 08\.00\.$/);
});

test('by specialty, in English, and a doctor who isn\'t on the schedule', () => {
  assert.match(text(cannedAnswer(ctx('2026-09-28T09:00:00'), [], 'jadwal dokter penyakit dalam')), /^dr\. Budi Santoso, Sp\.PD \(Penyakit Dalam\) praktik di/);
  assert.equal(
    text(cannedAnswer(ctx('2026-09-28T09:00:00'), [], 'When does dr Budi see patients?')),
    'dr. Budi Santoso, Sp.PD (Penyakit Dalam) practises at Exam room 1, Outpatient clinic: Tue, Thu 13:00–16:00. Not practising today, from tomorrow 13:00.',
  );
  assert.match(text(cannedAnswer(ctx('2026-09-28T09:00:00'), [], 'jadwal dr Andi')), /tidak menemukan dokter itu/);
});

test('by the clinic they practise in, when the specialty is not written out', () => {
  const clinics = structuredClone(starterPieces);
  const rooms = clinics.find((p) => p.name === 'Outpatient clinic')!.roomAssets!;
  rooms[0].name = 'Poli Paru';
  rooms[0].info = { doctors: [{ name: 'dr. Nur Zam Zam, Sp.P', hours: [{ days: [1], open: '08:00', close: '12:00' }] }] };
  const at = assistantContext(parseLayout(JSON.stringify({ pieces: clinics })), new Date('2026-09-28T09:00:00'));
  assert.match(text(cannedAnswer(at, [], 'dokter poli paru')), /^dr\. Nur Zam Zam, Sp\.P praktik di Poli Paru/);
  assert.match(text(cannedAnswer(at, [], 'jadwal dokter paru')), /^dr\. Nur Zam Zam/);
  // A word as written beats a near-miss: "gigi" is the dental clinic, not "Gizi".
  rooms[1].name = 'Poli Gizi';
  rooms[1].info = { doctors: [{ name: 'dr. Nur Fitriana, Sp.GK', hours: [{ days: [1], open: '08:00', close: '12:00' }] }] };
  const lab = clinics.find((p) => p.name === 'Pharmacy & lab')!.roomAssets![0];
  lab.name = 'Poli Gigi';
  lab.info = { doctors: [{ name: 'drg. Masita', hours: [{ days: [1], open: '08:00', close: '12:00' }] }] };
  const both = assistantContext(parseLayout(JSON.stringify({ pieces: clinics })), new Date('2026-09-28T09:00:00'));
  assert.match(text(cannedAnswer(both, [], 'dokter gigi')), /^drg\. Masita/);
  assert.match(text(cannedAnswer(both, [], 'dokter gizi')), /^dr\. Nur Fitriana/);
});
