import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, hoursLines, hoursStatus, parseInfo } from '../src/lib/model/place-info.ts';

// 2026-09-28 is a Monday.
const at = (day: number, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(2026, 8, 27 + day, h, m);
};
const weekdays = { hours: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' }] };

test('opening hours say whether it is open and when that changes', () => {
  assert.deepEqual(hoursStatus(weekdays, at(1, '09:30')), { open: true, text: 'Open now · until 17:00' });
  assert.deepEqual(hoursStatus(weekdays, at(1, '07:00')), { open: false, text: 'Closed · opens 08:00' });
  assert.deepEqual(hoursStatus(weekdays, at(1, '17:00')), { open: false, text: 'Closed · opens tomorrow 08:00' });
  assert.deepEqual(hoursStatus(weekdays, at(5, '18:00')), { open: false, text: 'Closed · opens Mon 08:00' });
  assert.equal(hoursStatus({}, at(1, '09:00')), null);
});

test('visiting hours, overnight and round-the-clock', () => {
  const ward = { visiting: true, hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '14:00', close: '20:00' }] };
  assert.equal(hoursStatus(ward, at(3, '15:00'))!.text, 'Visiting now · until 20:00');
  assert.equal(hoursStatus(ward, at(3, '21:00'))!.text, 'No visiting now · from tomorrow 14:00');
  const late = { hours: [{ days: [6], open: '22:00', close: '02:00' }] };
  assert.equal(hoursStatus(late, at(7, '01:00'))!.text, 'Open now · until 02:00');
  const always = { hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] };
  assert.equal(hoursStatus(always, at(2, '03:00'))!.text, 'Open now · 24 hours');
});

test('hours read naturally', () => {
  assert.equal(dayRange([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(dayRange([6, 0]), 'Sat, Sun');
  assert.equal(dayRange([5, 6, 0]), 'Fri–Sun');
  assert.equal(dayRange([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.deepEqual(hoursLines([{ days: [1, 3], open: '00:00', close: '00:00' }]), ['Mon, Wed 24 hours']);
});

test('details are validated and tidied', () => {
  assert.deepEqual(parseInfo({ description: '  Ward ', phone: '', visiting: false }), { description: 'Ward' });
  assert.equal(parseInfo({}), undefined);
  assert.throws(() => parseInfo({ hours: [{ days: [7], open: '08:00', close: '17:00' }] }));
  assert.throws(() => parseInfo({ hours: [{ days: [1], open: '8am', close: '17:00' }] }));
});

test('buildings, rooms and landmarks keep their details through save and search', async () => {
  const { parseLayout, starterPieces } = await import('../src/lib/model/layout.ts');
  const { places } = await import('../src/lib/wayfinding/routing.ts');
  const hours = [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' }];
  const building = starterPieces.find((p) => p.roomAssets?.length)!;
  const pieces = starterPieces.map((p) =>
    p === building
      ? { ...p, info: { phone: '123', hours }, roomAssets: p.roomAssets!.map((r, i) => (i ? r : { ...r, info: { visiting: true, hours } })) }
      : p,
  );
  const network = { nodes: [{ id: 'c', name: 'Café', x: 1, y: 1, info: { description: 'Coffee and snacks' } }], edges: [] };
  const result = parseLayout(JSON.stringify({ pieces, network }));
  const list = places(result.pieces, result.network);
  assert.deepEqual(list.find((p) => p.id === `b:${building.id}`)!.info, { phone: '123', hours });
  assert.equal(list.find((p) => p.id === `r:${building.id}:${building.roomAssets![0].id}`)!.info!.visiting, true);
  assert.equal(list.find((p) => p.id === 'n:c')!.info!.description, 'Coffee and snacks');
  assert.throws(() => parseLayout(JSON.stringify({ pieces: [{ ...building, info: { phone: 5 } }] })));
});
