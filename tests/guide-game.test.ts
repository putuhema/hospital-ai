import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetFor, newGame, rate, reward, tick, START_CLOCK, type Fare } from '../src/lib/scene/guide-game.ts';

const fare = (n = 0): Fare => ({
  who: { name: `Visitor ${n}`, look: 'elder' },
  from: { x: 10, z: 0 },
  to: { x: 40, z: 0, name: 'Farmasi' },
  budget: budgetFor(30),
});

test('find the lost visitor, lead them to the place, and the clock and score go up', () => {
  let n = 0;
  let { game } = tick(newGame(fare()), 1, { x: 0, z: 0 }, () => fare(++n));
  assert.equal(game.state, 'seeking');
  assert.equal(game.clock, START_CLOCK - 1);
  // Walking up to them: they follow.
  let out = tick(game, 0.1, { x: 9, z: 0.5 }, () => fare(++n));
  assert.equal(out.game.state, 'guiding');
  assert.deepEqual(out.events.map((e) => e.type), ['picked']);
  // Ten seconds on, at the pharmacy's door.
  game = tick(out.game, 10, { x: 25, z: 0 }, () => fare(++n)).game;
  out = tick(game, 0.1, { x: 38.5, z: 1 }, () => fare(++n));
  const done = out.events[0];
  assert.equal(done.type, 'delivered');
  assert.ok(done.type === 'delivered' && done.rating === 'good' && done.points > 100);
  assert.equal(out.game.delivered, 1);
  assert.equal(out.game.state, 'seeking');
  assert.equal(out.game.fare?.who.name, 'Visitor 1', 'the next one is waiting');
  assert.ok(out.game.clock > START_CLOCK - 12, 'time was added');
});

test('the game ends when the clock runs out, and stays ended', () => {
  const out = tick({ ...newGame(fare()), clock: 0.5 }, 1, { x: 0, z: 0 }, () => null);
  assert.equal(out.game.state, 'over');
  assert.deepEqual(out.events.map((e) => e.type), ['over']);
  assert.deepEqual(tick(out.game, 1, { x: 10, z: 0 }, () => null).events, []);
});

test('quick is rewarded: more time and points', () => {
  assert.equal(rate(5, 20), 'fast');
  assert.equal(rate(15, 20), 'good');
  assert.equal(rate(25, 20), 'slow');
  const fast = reward('fast', 5, 20), slow = reward('slow', 25, 20);
  assert.ok(fast.seconds > slow.seconds && fast.points > slow.points);
  assert.equal(slow.points, 100);
  assert.equal(budgetFor(50), 18);
});
