import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cannedAnswer,
  cannedReplier,
  messageText,
  replyLang,
  suggestions,
  withEvent,
  type ChatMessage,
  type ReplyEvent,
} from '../src/lib/assistant/chat.ts';
import { assistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { parseNetwork } from '../src/lib/wayfinding/navigation.ts';

const pieces = structuredClone(starterPieces);
pieces.find((p) => p.name === 'Pharmacy & lab')!.roomAssets![0].info = {
  hours: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '16:00' }],
};
const network = parseNetwork({ nodes: [{ id: 'p', name: 'Visitor car park', x: 12, y: 18, category: 'parking' }], edges: [] }, 24, 20);
const layout = parseLayout(JSON.stringify({ pieces, network }));
// 2026-09-28 is a Monday.
const ctx = assistantContext(layout, new Date('2026-09-28T10:00:00'));
const idOf = (name: string) => ctx.places.find((p) => p.name === name)!.id;
const faq = [
  { question: 'What are the visiting rules?', answer: 'Two visitors per bed, 16:00–20:00.' },
  { question: 'What is the emergency number?', answer: 'Call 118.' },
  { question: 'Parking fee?', answer: '' },
];
const text = (events: ReplyEvent[]) => events.filter((e) => e.type === 'text').map((e) => e.text).join('');
const cards = (events: ReplyEvent[]) => events.flatMap((e) => (e.type === 'card' ? [e.show] : []));

test('suggested questions come from what this map has', () => {
  assert.deepEqual(suggestions(ctx, faq, 'en'), ['Where is the pharmacy?', 'Visiting hours?', 'Nearest parking']);
  assert.deepEqual(suggestions(ctx, [], 'en'), ['Where is the pharmacy?', 'Nearest parking']);
  const empty = assistantContext(parseLayout(JSON.stringify({ pieces: [] })), new Date());
  assert.deepEqual(suggestions(empty, faq.slice(1), 'en'), ['What is the emergency number?']);
  // Indonesian first: the map's default.
  assert.deepEqual(suggestions(ctx, faq), ['Di mana apotek?', 'Jam besuk?', 'Parkir terdekat']);
  assert.deepEqual(suggestions(ctx, [{ question: 'Jam besuk pasien?', answer: '16.00–20.00' }], 'id')[1], 'Jam besuk?');
});

test('"where is" finds the place, says if it is open and shows it on the map', () => {
  const reply = cannedAnswer(ctx, faq, 'Where is the pharmacy?');
  assert.equal(text(reply), 'Pharmacy is in Pharmacy & lab. Open now, until 16:00.');
  assert.deepEqual(cards(reply), [{ kind: 'place', to: idOf('Pharmacy'), link: `?to=${idOf('Pharmacy')}` }]);
  // With a start, the card is the route.
  const route = cards(cannedAnswer(ctx, faq, 'di mana apotek', { from: idOf('Main reception') }))[0];
  assert.equal(route.kind, 'route');
  // "Where is the emergency…" is about a place, not the emergency number.
  assert.doesNotMatch(text(cannedAnswer(ctx, faq, 'Where is the emergency department?')), /118/);
});

test('questions the map can\'t answer come from the hospital information', () => {
  assert.equal(text(cannedAnswer(ctx, faq, 'Visiting hours?')), 'Two visitors per bed, 16:00–20:00.');
  assert.equal(text(cannedAnswer(ctx, faq, 'emergency number')), 'Call 118.');
  assert.deepEqual(cards(cannedAnswer(ctx, faq, 'Visiting hours?')), []);
});

test('"nearest" walks from where the visitor is', () => {
  const reply = cannedAnswer(ctx, faq, 'Nearest toilets', { from: idOf('Room 1') });
  assert.match(text(reply), /^Nearest toilets: Toilets in West patient ward, about \d+ min walk\.$/);
  assert.equal(cards(reply)[0].kind, 'route');
  assert.match(text(cannedAnswer(ctx, faq, 'Nearest parking')), /Visitor car park on the map\. Set where you are/);
});

test('anything else is sent to the information desk, never guessed', () => {
  for (const q of ['Can I book a doctor?', 'where is the helipad'])
    assert.match(text(cannedAnswer(ctx, faq, q)), /information desk/);
  for (const q of ['Di mana helipad?', ''])
    assert.match(text(cannedAnswer(ctx, faq, q)), /bagian informasi/);
});

test('replies stream a word at a time and can be stopped', async () => {
  const replier = cannedReplier(() => ({ ctx, faq }), { wordMs: 0, thinkMs: 0 });
  const history: ChatMessage[] = [{ role: 'user', parts: [{ type: 'text', text: 'Where is the laboratory?' }] }];
  let message: ChatMessage = { role: 'assistant', parts: [] }, events = 0;
  for await (const e of replier(history, {}, new AbortController().signal)) {
    message = withEvent(message, e);
    events++;
  }
  assert.equal(messageText(message), 'Laboratory is in Pharmacy & lab.');
  assert.deepEqual(message.parts.map((p) => p.type), ['text', 'card'], 'words join into one text part');
  assert.ok(events > 3, 'written out in pieces');
  const stop = new AbortController();
  let seen = 0;
  for await (const _ of replier(history, {}, stop.signal)) if (++seen === 2) stop.abort();
  assert.equal(seen, 2);
});

test('replies are in the language of the question, Indonesian when it can\'t tell', () => {
  assert.equal(replyLang('Di mana apotek?'), 'id');
  assert.equal(replyLang('Where is the pharmacy?'), 'en');
  assert.equal(replyLang('toilet terdekat'), 'id');
  assert.equal(replyLang('Nearest toilets'), 'en');
  assert.equal(replyLang('apotek'), 'id', 'one word: the map\'s language');
  assert.equal(replyLang('apotek', 'en'), 'en');
});

test('Indonesian questions get Indonesian answers from the same map', () => {
  assert.equal(text(cannedAnswer(ctx, faq, 'Di mana apotek?')), 'Pharmacy ada di Pharmacy & lab. Buka, sampai 16.00.');
  const near = text(cannedAnswer(ctx, faq, 'toilet terdekat', { from: idOf('Room 1') }));
  assert.match(near, /^Toilet terdekat: Toilets di West patient ward, sekitar \d+ menit jalan kaki\.$/);
  assert.match(text(cannedAnswer(ctx, faq, 'parkir terdekat')), /Parkir terdekat: Visitor car park di peta\. Tentukan posisi Anda/);
  // The hospital information answers across languages.
  const idFaq = [{ question: 'Kapan jam besuk?', answer: 'Pukul 16.00–20.00, dua orang per pasien.' }];
  assert.equal(text(cannedAnswer(ctx, idFaq, 'Visiting hours?')), idFaq[0].answer);
  assert.equal(text(cannedAnswer(ctx, faq, 'jam besuk')), 'Two visitors per bed, 16:00–20:00.');
});

test("the editor's Indonesian starter topics answer questions in either language", async () => {
  const { faqTopics } = await import('../src/lib/model/faq.ts');
  const answers = ['Pukul 16.00–20.00.', 'Ya, BPJS diterima di loket kasir.', 'Daftar di loket pendaftaran.', 'Hubungi 118.'];
  const hospital = faqTopics.map((t, i) => ({ question: t.question, answer: answers[i] }));
  const ask = (q: string) => text(cannedAnswer(ctx, hospital, q));
  assert.equal(ask('Jam besuk?'), answers[0]);
  assert.equal(ask('Visiting hours?'), answers[0]);
  assert.equal(ask('Bisa pakai BPJS?'), answers[1]);
  assert.equal(ask('How do I pay?'), answers[1]);
  assert.equal(ask('Cara daftar pasien baru?'), answers[2]);
  assert.equal(ask('emergency number'), answers[3]);
});
