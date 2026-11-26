import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mood, Mouth, REST, moodOf, visemeOf, visemeOfChunk } from '../src/lib/assistant/mascot.ts';

const idle = { busy: false, speaking: false, lookingUp: false, failed: false, justAnswered: false, hearing: false };

test('letters map to the five mouth shapes', () => {
  assert.equal(visemeOf('a'), Mouth.AA);
  assert.equal(visemeOf('E'), Mouth.EE);
  assert.equal(visemeOf('i'), Mouth.EE);
  assert.equal(visemeOf('f'), Mouth.FF);
  assert.equal(visemeOf('v'), Mouth.FF);
  assert.equal(visemeOf('m'), Mouth.MM);
  assert.equal(visemeOf('b'), Mouth.MM);
  assert.equal(visemeOf('o'), Mouth.OO);
  assert.equal(visemeOf('u'), Mouth.OO);
  assert.equal(visemeOf(' '), null);
  assert.equal(visemeOf('.'), null);
});

test('a chunk shows its most open sound, and silence closes the mouth', () => {
  assert.equal(visemeOfChunk('mba'), Mouth.AA);
  assert.equal(visemeOfChunk('fu'), Mouth.OO);
  assert.equal(visemeOfChunk('ff'), Mouth.FF);
  assert.equal(visemeOfChunk('  , '), REST);
});

test('the mood follows the chat', () => {
  assert.equal(moodOf(idle), Mood.neutral);
  assert.equal(moodOf({ ...idle, hearing: true }), Mood.listening);
  assert.equal(moodOf({ ...idle, busy: true }), Mood.thinking);
  assert.equal(moodOf({ ...idle, busy: true, lookingUp: true }), Mood.processing);
  assert.equal(moodOf({ ...idle, busy: true, speaking: true }), Mood.neutral);
  assert.equal(moodOf({ ...idle, justAnswered: true }), Mood.success);
  assert.equal(moodOf({ ...idle, failed: true }), Mood.confused);
  // Typing a new question after a failure: she listens.
  assert.equal(moodOf({ ...idle, failed: true, hearing: true }), Mood.listening);
});
