import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answered, answerParts, MAX_FAQ, parseFaq } from '../src/lib/model/faq.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { layoutJson, layoutSnapshot } from '../src/lib/editor/export.ts';
import { emptyNetwork } from '../src/lib/wayfinding/navigation.ts';

const visiting = { question: 'What are the visiting rules?', answer: 'Two visitors per bed, 16:00–20:00.' };

test('questions are tidied and blank ones dropped', () => {
  assert.deepEqual(parseFaq(undefined), []);
  assert.deepEqual(
    parseFaq([{ question: '  What are the visiting rules? ', answer: 'Two visitors per bed, 16:00–20:00.\n' }, { question: ' ', answer: '' }]),
    [visiting],
  );
  // A question still being written keeps its answer, and the other way round.
  const draft = [{ question: '', answer: 'Call 118' }];
  assert.deepEqual(parseFaq(draft), draft);
  // …but visitors only see answered questions.
  assert.deepEqual(answered([...draft, { question: 'Parking fee?', answer: '' }, visiting]), [visiting]);
});

test('invalid questions are rejected', () => {
  for (const bad of [null, {}, [null], [{ question: 1, answer: '' }], [{ question: 'Q' }], [{ question: 'Q', answer: 'x'.repeat(2001) }]])
    assert.throws(() => parseFaq(bad));
  assert.throws(() => parseFaq(Array.from({ length: MAX_FAQ + 1 }, () => visiting)));
});

test('hospital information is saved, exported and published with the map', () => {
  const project = { title: 'Greenfield Hospital', pieces: starterPieces, network: emptyNetwork(), width: 24, height: 20, faq: [visiting] };
  assert.deepEqual(parseLayout(layoutSnapshot(project)).faq, [visiting]);
  assert.deepEqual(parseLayout(layoutJson(project)).faq, [visiting]);
  // Layouts saved before there was hospital information.
  assert.deepEqual(parseLayout(JSON.stringify({ pieces: starterPieces })).faq, []);
  assert.throws(() => parseLayout(JSON.stringify({ pieces: starterPieces, faq: 'Call us' })));
});

test('phone numbers in answers can be called', () => {
  assert.deepEqual(answerParts('Call 118 or +62 361 123-456.'), [
    { text: 'Call ' },
    { text: '118', tel: '118' },
    { text: ' or ' },
    { text: '+62 361 123-456', tel: '+62361123456' },
    { text: '.' },
  ]);
  for (const text of ['Two visitors, 16:00–20:00', 'Mon–Fri 08:00-16:00', 'Fee Rp 50.000', 'Open 08.00 - 16.00'])
    assert.deepEqual(answerParts(text), [{ text }]);
});
