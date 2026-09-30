import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyZai } from '../src/lib/server/assistant-zai.ts';
import { assistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import type { ChatMessage, ReplyEvent } from '../src/lib/assistant/chat.ts';

const ctx = assistantContext(parseLayout(JSON.stringify({ pieces: starterPieces })), new Date('2026-09-28T10:00:00'));
const pharmacy = ctx.places.find((p) => p.name === 'Pharmacy')!;

type Turn = { text?: string; calls?: { name: string; args: string }[]; finish?: string };
/** A stand-in for Z.ai's streamed chat completions, with tool calls split into pieces as the API sends them. */
function fakeZai(script: Turn[]) {
  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        async create(params: any) {
          requests.push(structuredClone(params));
          const turn = script.shift()!;
          const chunks: any[] = [];
          for (const word of (turn.text ?? '').split(/(?<= )/).filter(Boolean)) chunks.push({ choices: [{ delta: { content: word } }] });
          (turn.calls ?? []).forEach((c, index) => {
            const half = Math.ceil(c.args.length / 2);
            chunks.push({ choices: [{ delta: { tool_calls: [{ index, id: `call_${requests.length}_${index}`, function: { name: c.name, arguments: c.args.slice(0, half) } }] } }] });
            chunks.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: c.args.slice(half) } }] } }] });
          });
          chunks.push({ choices: [{ delta: {}, finish_reason: turn.finish ?? (turn.calls ? 'tool_calls' : 'stop') }] });
          return { async *[Symbol.asyncIterator]() { yield* chunks; } };
        },
      },
    },
  };
  return { client: client as any, requests };
}
async function run(client: any, messages: ChatMessage[]) {
  const out: ReplyEvent[] = [];
  for await (const e of replyZai(client, 'glm-5', { title: 'RS Uji', faq: [], ctx, messages, context: { lang: 'id' }, signal: new AbortController().signal }))
    out.push(e);
  return out;
}
const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] });
const text = (events: ReplyEvent[]) => events.map((e) => (e.type === 'text' ? e.text : '')).join('');

test('GLM calls the tools with arguments sent in pieces, then answers with a card', async () => {
  const { client, requests } = fakeZai([
    { calls: [{ name: 'search_places', args: JSON.stringify({ query: 'apotek' }) }] },
    { calls: [{ name: 'show_on_map', args: JSON.stringify({ place_id: pharmacy.id }) }] },
    { text: 'Apotek ada di Pharmacy & lab.' },
  ]);
  const events = await run(client, [user('Di mana apotek?')]);
  assert.equal(text(events), 'Apotek ada di Pharmacy & lab.');
  assert.deepEqual(events.filter((e) => e.type === 'card').map((e) => e.type === 'card' && e.show.to), [pharmacy.id]);
  const last = requests.at(-1);
  assert.equal(last.model, 'glm-5');
  assert.equal(last.messages[0].role, 'system');
  assert.match(last.messages[0].content, /RS Uji/);
  // The time and place follow the question, so the instructions before it stay cached.
  assert.equal(requests[0].messages.length, 3);
  assert.deepEqual(requests[0].messages.map((m: any) => m.role), ['system', 'user', 'system']);
  assert.match(requests[0].messages[2].content, /Now at the hospital/);
  assert.doesNotMatch(last.messages[0].content, /Now at the hospital/);
  // While GLM reads what it found, the chat says what it looked up.
  assert.deepEqual(events.filter((e) => e.type === 'status').map((e) => e.type === 'status' && e.tool), ['search_places', 'show_on_map']);
  assert.deepEqual(last.thinking, { type: 'disabled' });
  assert.ok(last.tools.every((t: any) => t.type === 'function' && t.function.parameters.type === 'object'));
  // The search went back to the model as a tool message for its call.
  const found = last.messages.find((m: any) => m.role === 'tool');
  assert.equal(found.tool_call_id, 'call_1_0');
  assert.ok(JSON.parse(found.content).results.some((r: any) => r.id === pharmacy.id));
  assert.equal(last.messages.filter((m: any) => m.role === 'assistant')[0].tool_calls[0].function.name, 'search_places');
});

test('arguments that are not JSON go back as an error, not run', async () => {
  const { client, requests } = fakeZai([{ calls: [{ name: 'show_on_map', args: '{"place_id": ' }] }, { text: 'Maaf.' }]);
  const events = await run(client, [user('apotek')]);
  assert.equal(events.filter((e) => e.type === 'card').length, 0);
  assert.match(requests[1].messages.at(-1).content, /not valid JSON/);
});

test("Z.ai's content filter ends the reply with an apology", async () => {
  const { client } = fakeZai([{ finish: 'sensitive' }]);
  assert.match(text(await run(client, [user('…')])), /^Maaf/);
});

test('an answer written alongside show_on_map is not asked for again', async () => {
  const { client, requests } = fakeZai([
    { text: 'Apotek ada di Pharmacy & lab.', calls: [{ name: 'show_on_map', args: JSON.stringify({ place_id: pharmacy.id }) }] },
    { text: 'Apotek ada di Pharmacy & lab.' },
  ]);
  const events = await run(client, [user('apotek')]);
  assert.equal(requests.length, 1);
  assert.equal(text(events), 'Apotek ada di Pharmacy & lab.');
  assert.equal(events.filter((e) => e.type === 'card').length, 1);
});

test('text that only announces a lookup is dropped, and not kept in the conversation', async () => {
  const { client, requests } = fakeZai([
    { text: 'Saya cari apoteknya untuk Anda.', calls: [{ name: 'search_places', args: JSON.stringify({ query: 'apotek' }) }] },
    { text: 'Apotek ada di Pharmacy & lab.' },
  ]);
  const events = await run(client, [user('apotek')]);
  assert.equal(text(events), 'Apotek ada di Pharmacy & lab.');
  assert.equal(requests[1].messages.find((m: any) => m.role === 'assistant').content, null);
});
