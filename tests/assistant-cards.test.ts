import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCard } from '../src/lib/assistant/cards.ts';
import { assistantContext, showOnMap, type MapSelection } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';

const pieces = structuredClone(starterPieces);
pieces.find((p) => p.name === 'Pharmacy & lab')!.roomAssets![1].info = {
  hours: [{ days: [1, 2, 3, 4, 5], open: '07:00', close: '16:00' }],
};
const layout = parseLayout(JSON.stringify({ pieces }));
// 2026-09-28 is a Monday.
const at = (time: string) => new Date(`2026-09-28T${time}:00`);
const ctx = assistantContext(layout, at('10:00'));
const idOf = (name: string) => ctx.places.find((p) => p.name === name)!.id;
const selection = (input: { place_id: string; from_place_id?: string }) =>
  (showOnMap(ctx, input) as { show: MapSelection }).show;

test('a place card names the place, says what it is and whether it is open', () => {
  const lab = idOf('Laboratory');
  const card = mapCard(selection({ place_id: lab }), ctx.places, at('10:00'))!;
  assert.equal(card.place.name, 'Laboratory');
  assert.equal(card.detail, 'Laboratory · Pharmacy & lab');
  assert.deepEqual(card.status, { open: true, text: 'Open now · until 16:00' });
  assert.equal(card.href, `?to=${lab}`);
  assert.equal(card.action, 'Show on map');
  // Open-now follows the visitor's clock, not when the assistant answered.
  assert.equal(mapCard(selection({ place_id: lab }), ctx.places, at('17:00'))!.status!.text, 'Closed · opens tomorrow 07:00');
  assert.equal(mapCard(selection({ place_id: idOf('Pharmacy') }), ctx.places, at('10:00'))!.status, null);
});

test('a route card says where from and how long the walk is', () => {
  const from = idOf('Main reception'), to = idOf('Laboratory');
  const shown = selection({ place_id: to, from_place_id: from });
  const card = mapCard(shown, ctx.places, at('10:00'))!;
  assert.equal(card.detail, `From Main reception · ${shown.kind === 'route' && shown.minutes} min walk`);
  assert.equal(card.href, `?from=${from}&to=${to}`);
  assert.equal(card.action, 'Show route');
});

test('a card for a place that has since been removed from the map is empty', () => {
  const shown = selection({ place_id: idOf('Laboratory'), from_place_id: idOf('Main reception') });
  const without = (name: string) => ctx.places.filter((p) => p.name !== name);
  assert.equal(mapCard(shown, without('Laboratory'), at('10:00')), null);
  assert.equal(mapCard(shown, without('Main reception'), at('10:00')), null);
});

test('cards speak Indonesian on an Indonesian map', () => {
  const lab = idOf('Laboratory'), from = idOf('Main reception');
  const card = mapCard(selection({ place_id: lab }), ctx.places, at('10:00'), 'id')!;
  assert.equal(card.detail, 'Laboratorium · Pharmacy & lab');
  assert.equal(card.status!.text, 'Buka · sampai 16.00');
  assert.equal(card.action, 'Lihat di peta');
  const shown = selection({ place_id: lab, from_place_id: from });
  const route = mapCard(shown, ctx.places, at('10:00'), 'id')!;
  assert.equal(route.detail, `Dari Main reception · ${shown.kind === 'route' && shown.minutes} menit jalan kaki`);
  assert.equal(route.action, 'Lihat rute');
});

test("a card about a doctor shows their schedule and whether they are practising", () => {
  const withDoctor = structuredClone(pieces);
  withDoctor.find((p) => p.name === 'Pharmacy & lab')!.roomAssets![1].info!.doctors = [
    { name: 'dr. Sari', hours: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '12:00' }] },
  ];
  const places = assistantContext(parseLayout(JSON.stringify({ pieces: withDoctor })), at('10:00')).places;
  const show = selection({ place_id: idOf('Laboratory') });
  const card = mapCard(show, places, at('10:00'), 'id', 'dr. Sari')!;
  assert.equal(card.schedule, 'Sen–Jum 08.00–12.00');
  assert.deepEqual(card.status, { open: true, text: 'Praktik · sampai 12.00' });
  // Without the doctor, the card keeps the place's opening hours.
  assert.equal(mapCard(show, places, at('10:00'), 'id')!.schedule, undefined);
});
