import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyZai, withoutNoteMention } from '../src/lib/server/assistant-zai.ts';
import { resolveLlmConfig } from '../src/lib/server/llm-config.ts';
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

test('a tool call written out as a note is not shown to the visitor', async () => {
  const { client } = fakeZai([
    { text: `Jam pendaftaran belum tersedia.\n\n[show_on_map: place ${pharmacy.id}]\n\nSilakan tanya bagian informasi.` },
  ]);
  assert.equal(text(await run(client, [user('pendaftaran jam berapa?')])), 'Jam pendaftaran belum tersedia.\n\nSilakan tanya bagian informasi.');
});

test('a reply that comes with note_missing_info is shown, kept for the hospital, and not asked again', async () => {
  const { client, requests } = fakeZai([
    { calls: [{ name: 'search_hospital_info', args: JSON.stringify({ query: 'jam besuk' }) }] },
    {
      text: 'Maaf, jam besuk belum tersedia. Silakan tanya bagian informasi.',
      calls: [{ name: 'note_missing_info', args: JSON.stringify({ topic: 'besuk', subject: 'Jam Besuk' }) }],
    },
  ]);
  const local = { ...ctx };
  const out: ReplyEvent[] = [];
  for await (const e of replyZai(client, 'glm-5', { title: 'RS Uji', faq: [], ctx: local, messages: [user('jam besuk kapan?')], context: { lang: 'id' }, signal: new AbortController().signal }))
    out.push(e);
  assert.equal(text(out), 'Maaf, jam besuk belum tersedia. Silakan tanya bagian informasi.');
  assert.deepEqual(local.missing, { topic: 'besuk', subject: 'jam besuk' });
  assert.equal(requests.length, 2);
  assert.ok(!out.some((e) => e.type === 'status' && e.tool === 'note_missing_info'));
});

test('saying the question was noted for the hospital is taken out of the reply', () => {
  assert.equal(
    withoutNoteMention('Maaf, informasi cuci darah belum tersedia. Saya sudah mencatat ini agar rumah sakit dapat menambahkannya.\n\nSilakan tanya bagian informasi.'),
    'Maaf, informasi cuci darah belum tersedia.\n\nSilakan tanya bagian informasi.',
  );
  assert.equal(withoutNoteMention("Sorry, that isn't listed. I've noted it for the hospital. Ask at the desk."), "Sorry, that isn't listed. Ask at the desk.");
  assert.equal(withoutNoteMention('Pendaftaran pasien baru buka pukul 08.00.'), 'Pendaftaran pasien baru buka pukul 08.00.');
});

test('LLM_* env vars configure any OpenAI-compatible provider, Anthropic, or legacy Z.ai cleanly', async () => {
  const openrouter = resolveLlmConfig({
    LLM_PROVIDER: 'openrouter',
    LLM_MODEL: 'google/gemini-2.5-flash',
    LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_API_KEY: 'sk-or-test',
  });
  assert.deepEqual(openrouter, {
    kind: 'openai',
    provider: 'openrouter',
    apiKey: 'sk-or-test',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    disableThinking: false,
  });

  // Non-GLM OpenAI-compatible models must NOT receive Z.ai's `thinking` field.
  const { client, requests } = fakeZai([{ text: 'Halo!' }]);
  const out: ReplyEvent[] = [];
  for await (const e of replyZai(
    client,
    'gpt-4o-mini',
    { title: 'RS Uji', faq: [], ctx, messages: [user('halo')], context: { lang: 'id' }, signal: new AbortController().signal },
    { disableThinking: false },
  ))
    out.push(e);
  assert.equal(text(out), 'Halo!');
  assert.equal('thinking' in requests[0], false);

  const claude = resolveLlmConfig({
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'claude-sonnet-4-5',
    LLM_API_KEY: 'sk-ant-test',
  });
  assert.equal(claude?.kind, 'anthropic');
  assert.equal(claude?.model, 'claude-sonnet-4-5');

  const ollama = resolveLlmConfig({
    LLM_PROVIDER: 'ollama',
    LLM_MODEL: 'qwen2.5:14b',
    LLM_BASE_URL: 'http://localhost:11434/v1',
  });
  assert.equal(ollama?.kind, 'openai');
  assert.equal(ollama?.apiKey, 'local');

  const legacyZai = resolveLlmConfig({ ZAI_API_KEY: 'zai-key' });
  assert.equal(legacyZai?.kind, 'openai');
  assert.equal(legacyZai?.kind === 'openai' && legacyZai.disableThinking, true);
});

test('a reply written after a lookup streams out word by word, with its card, in one more request', async () => {
  const { client, requests } = fakeZai([
    { calls: [{ name: 'search_places', args: JSON.stringify({ query: 'apotek' }) }] },
    { text: 'Apotek ada di Pharmacy & lab, buka sampai jam 16.00.', calls: [{ name: 'show_on_map', args: JSON.stringify({ place_id: pharmacy.id }) }] },
  ]);
  const events = await run(client, [user('Di mana apotek?')]);
  assert.equal(text(events), 'Apotek ada di Pharmacy & lab, buka sampai jam 16.00.');
  // Several text events, not one at the end: the words show as they are written.
  assert.ok(events.filter((e) => e.type === 'text').length > 3);
  assert.equal(events.filter((e) => e.type === 'card').length, 1);
  assert.equal(requests.length, 2);
});

test('after a reply the visitor has read, a further lookup is not made and nothing is answered twice', async () => {
  const { client, requests } = fakeZai([
    { calls: [{ name: 'search_hospital_info', args: JSON.stringify({ query: 'jam besuk' }) }] },
    {
      text: 'Maaf, jam besuk belum ada dalam informasi rumah sakit. Silakan tanyakan di bagian informasi.',
      calls: [
        { name: 'note_missing_info', args: JSON.stringify({ topic: 'besuk', subject: 'jam besuk' }) },
        { name: 'search_places', args: JSON.stringify({ query: 'bagian informasi' }) },
      ],
    },
    { text: 'Maaf, informasi jam besuk belum tersedia.' },
  ]);
  const local = { ...ctx };
  const out: ReplyEvent[] = [];
  for await (const e of replyZai(client, 'glm-5', { title: 'RS Uji', faq: [], ctx: local, messages: [user('jam besuk?')], context: { lang: 'id' }, signal: new AbortController().signal }))
    out.push(e);
  assert.equal(text(out), 'Maaf, jam besuk belum ada dalam informasi rumah sakit. Silakan tanyakan di bagian informasi.');
  assert.equal(requests.length, 2);
  // The note for the hospital still runs.
  assert.deepEqual(local.missing, { topic: 'besuk', subject: 'jam besuk' });
});

test('a first answer longer than a sentence streams before the model has finished', async () => {
  const { client } = fakeZai([
    { text: 'Segera ke IGD sekarang. Mintalah bantuan petugas mana pun di jalan.', calls: [{ name: 'show_on_map', args: JSON.stringify({ place_id: pharmacy.id }) }] },
  ]);
  const events = await run(client, [user('ayah saya pingsan')]);
  assert.equal(text(events), 'Segera ke IGD sekarang. Mintalah bantuan petugas mana pun di jalan.');
  assert.ok(events.filter((e) => e.type === 'text').length > 3);
});
