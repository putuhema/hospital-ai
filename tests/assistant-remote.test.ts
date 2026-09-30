import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverReplier } from '../src/lib/assistant/remote.ts';
import type { Replier, ReplyEvent } from '../src/lib/assistant/chat.ts';

const canned: Replier = async function* () { yield { type: 'text', text: 'canned' }; };
const ask = async (replier: Replier) => {
  const out: ReplyEvent[] = [];
  for await (const e of replier([{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], {}, new AbortController().signal)) out.push(e);
  return out;
};
const lines = (...events: object[]) => new Response(events.map((e) => JSON.stringify(e) + '\n').join(''));

test("the server's events arrive in order, split across chunks or not", async () => {
  let body: any;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return lines({ type: 'text', text: 'Apotek ' }, { type: 'text', text: 'di sini.' }, { type: 'card', show: { kind: 'place', to: 'b:1', link: '?to=b:1' } });
  }) as typeof fetch;
  const events = await ask(serverReplier(() => ({ slug: 'abc' }), canned));
  assert.equal(body.slug, 'abc');
  assert.deepEqual(events.map((e) => e.type), ['text', 'text', 'card']);
});

test('without an assistant on the server, the built-in replies answer from then on', async () => {
  let calls = 0;
  globalThis.fetch = (async () => (calls++, new Response('{}', { status: 503 }))) as typeof fetch;
  const replier = serverReplier(() => ({}), canned);
  assert.deepEqual(await ask(replier), [{ type: 'text', text: 'canned' }]);
  assert.deepEqual(await ask(replier), [{ type: 'text', text: 'canned' }]);
  assert.equal(calls, 1);
});

test('a failed reply is an error the chat shows', async () => {
  globalThis.fetch = (async () => lines({ type: 'text', text: 'Hal' }, { type: 'error' })) as typeof fetch;
  await assert.rejects(ask(serverReplier(() => ({}), canned)));
  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  await assert.rejects(ask(serverReplier(() => ({}), canned)));
});

test('over the question limit, that question gets the built-in reply, and the next one asks the server again', async () => {
  let calls = 0;
  globalThis.fetch = (async () => (calls++, new Response('{"error":"Too many questions."}', { status: 429 }))) as typeof fetch;
  const replier = serverReplier(() => ({}), canned);
  assert.deepEqual(await ask(replier), [{ type: 'text', text: 'canned' }]);
  await ask(replier);
  assert.equal(calls, 2);
});
