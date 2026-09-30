import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history, reply, situation, systemPrompt, hospitalNow } from '../src/lib/server/assistant.ts';
import { assistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import type { ChatMessage, ReplyEvent } from '../src/lib/assistant/chat.ts';

const layout = parseLayout(JSON.stringify({ pieces: starterPieces }));
// 2026-09-28 is a Monday.
const ctx = assistantContext(layout, new Date('2026-09-28T10:00:00'));
const pharmacy = ctx.places.find((p) => p.name === 'Pharmacy')!;
const faq = [{ question: 'Jam besuk?', answer: '16.00–20.00', topic: 'besuk' as const }, { question: 'Draft', answer: '' }];

/** A stand-in for the Claude client: each call streams the next scripted message. */
function fakeClient(script: { text?: string; tools?: { name: string; input: object }[]; stop?: string }[]) {
  const requests: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: any) {
          requests.push(structuredClone(params));
          const turn = script.shift()!;
          const content: any[] = [];
          if (turn.text) content.push({ type: 'text', text: turn.text });
          (turn.tools ?? []).forEach((t, i) => content.push({ type: 'tool_use', id: `t${requests.length}-${i}`, name: t.name, input: t.input }));
          const events = turn.text ? turn.text.split(/(?<= )/).map((text) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })) : [];
          return {
            async *[Symbol.asyncIterator]() { yield* events; },
            finalMessage: async () => ({ content, stop_reason: turn.stop ?? (turn.tools ? 'tool_use' : 'end_turn') }),
          };
        },
      },
    },
  };
  return { client: client as any, requests };
}
const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] });
async function collect(gen: AsyncGenerator<ReplyEvent>) {
  const out: ReplyEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const run = (client: any, messages: ChatMessage[], from?: string) =>
  collect(reply(client, { title: 'RS Uji', faq, ctx, messages, context: { lang: 'id', ...(from && { from }) }, signal: new AbortController().signal }));

test('the assistant calls the tools, then answers, and a place it shows becomes a card', async () => {
  const { client, requests } = fakeClient([
    { tools: [{ name: 'search_places', input: { query: 'apotek' } }] },
    { tools: [{ name: 'show_on_map', input: { place_id: pharmacy.id } }] },
    { text: 'Apotek ada di Pharmacy & lab.' },
  ]);
  const events = await run(client, [user('Di mana apotek?')]);
  assert.deepEqual(events.filter((e) => e.type === 'card').map((e) => e.type === 'card' && e.show.to), [pharmacy.id]);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.type === 'text' && e.text).join(''), 'Apotek ada di Pharmacy & lab.');
  // Each round sends back what the tools found.
  const last = requests.at(-1);
  const results = last.messages.filter((m: any) => m.role === 'user' && Array.isArray(m.content)).flatMap((m: any) => m.content);
  assert.equal(results.length, 2);
  assert.ok(JSON.parse(results[0].content).results.some((r: any) => r.id === pharmacy.id));
  // The model and settings the app relies on.
  assert.equal(last.model, 'claude-opus-5-5');
  assert.equal(last.fallbacks, 'default');
  assert.ok(last.tools.every((t: any) => t.eager_input_streaming));
  assert.equal(last.system[0].cache_control.type, 'ephemeral');
});

test('a tool error goes back to the model, and a place is shown once', async () => {
  const { client, requests } = fakeClient([
    { tools: [{ name: 'show_on_map', input: { place_id: 'nope' } }, { name: 'show_on_map', input: { place_id: pharmacy.id, doctor_name: 'dr. Sari' } }] },
    { tools: [{ name: 'show_on_map', input: { place_id: pharmacy.id } }] },
    { text: 'Di sini.' },
  ]);
  const events = await run(client, [user('apotek')]);
  const cards = events.filter((e) => e.type === 'card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type === 'card' && cards[0].doctor, 'dr. Sari');
  const firstResults = requests[1].messages.at(-1).content;
  assert.equal(firstResults[0].is_error, true);
});

test('a refusal ends the reply with an apology instead of silence', async () => {
  const { client } = fakeClient([{ stop: 'refusal' }]);
  const events = await run(client, [user('…')]);
  assert.match(events.map((e) => (e.type === 'text' ? e.text : '')).join(''), /^Maaf/);
});

test('the conversation keeps what was shown, and the situation comes after the question', async () => {
  const messages: ChatMessage[] = [
    { role: 'assistant', parts: [{ type: 'text', text: 'Halo!' }] },
    user('Di mana apotek?'),
    { role: 'assistant', parts: [{ type: 'text', text: 'Di Pharmacy & lab.' }, { type: 'card', show: { kind: 'place', to: pharmacy.id, link: `?to=${pharmacy.id}` } }] },
    user('rute ke sana'),
  ];
  const h = history(messages, ctx);
  assert.equal(h[0].role, 'user');
  assert.match(h[1].content as string, new RegExp(`\\[shown on the map: Pharmacy, .*place id ${pharmacy.id.replace(/[:]/g, '\\:')}\\]`));
  const { client, requests } = fakeClient([{ text: 'Oke.' }]);
  await run(client, messages, pharmacy.id);
  const sent = requests[0].messages;
  assert.equal(sent.at(-1).role, 'system');
  assert.match(sent.at(-1).content, /The visitor is at Pharmacy/);
  assert.match(sent.at(-1).content, /Senin, 28 September 2026/);
});

test('the system prompt holds the answered hospital information and the kinds of place', () => {
  const s = systemPrompt('RS Uji', faq, ctx);
  assert.match(s, /RS Uji/);
  assert.match(s, /\[Jam besuk\] T: Jam besuk\?\nJ: 16\.00–20\.00/);
  assert.doesNotMatch(s, /Draft/);
  assert.match(s, /Pharmacy/);
  assert.match(situation(ctx, { lang: 'en' }), /hasn't said where they are.*English/);
});

test("the hospital's own time zone", () => {
  const wita = hospitalNow('Asia/Makassar'), jakarta = hospitalNow('Asia/Jakarta');
  assert.equal(Math.round((wita.getTime() - jakarta.getTime()) / 3_600_000), 1);
});

test('long hospital information is sent as its questions, for search_hospital_info to answer', async () => {
  const { MAX_INFO } = await import('../src/lib/server/assistant.ts');
  const long = Array.from({ length: 80 }, (_, i) => ({ question: `Pertanyaan nomor ${i}?`, answer: 'Jawaban panjang. '.repeat(12), topic: 'lainnya' as const }));
  const s = systemPrompt('RS Uji', long, ctx);
  assert.ok(long.map((e) => e.answer).join('').length > MAX_INFO);
  assert.match(s, /search_hospital_info before you reply/);
  assert.match(s, /\[Lainnya\] Pertanyaan nomor 79\?/);
  assert.doesNotMatch(s, /Jawaban panjang/);
});
