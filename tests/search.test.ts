import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, normalize, search } from '../src/lib/wayfinding/search.ts';
import { nearestOfType, buildGrid, places } from '../src/lib/wayfinding/routing.ts';
import { shortcuts } from '../src/lib/wayfinding/shortcuts.ts';
import { parseNetwork } from '../src/lib/wayfinding/navigation.ts';
import type { Place } from '../src/lib/wayfinding/routing.ts';

const at = { x: 1, y: 1 };
const list: Place[] = [
  { id: 'r:1', name: 'Imaging', kind: 'room', detail: 'Radiology', building: 'Main', point: at },
  { id: 'r:2', name: 'Lab 1', kind: 'room', detail: 'Laboratory', building: 'Main', point: at },
  { id: 'r:3', name: 'Pharmacy', kind: 'room', detail: 'Pharmacy', building: 'Main', point: at },
  { id: 'r:4', name: 'Room 12', kind: 'room', detail: 'Examination room', building: 'Clinic', point: at,
    info: { keywords: ['Dr. Sari Wijaya', 'Poli Anak'] } },
  { id: 'r:5', name: 'WC', kind: 'room', detail: 'Toilets', building: 'Main', point: at },
  { id: 'n:a', name: 'Visitor car park', kind: 'landmark', detail: 'Parking', category: 'parking', point: at },
  { id: 'n:b', name: 'Kopi corner', kind: 'landmark', detail: 'Café', category: 'cafe', point: at },
  { id: 'b:1', name: 'Main', kind: 'building', detail: 'Building', point: at },
];
const names = (q: string) => search(list, q).map((m) => m.place.name);

test('text is compared without case, accents or punctuation', () => {
  assert.equal(normalize('Café & X-Ray'), 'cafe and x ray');
  assert.equal(editDistance('pharmcy', 'pharmacy', 1), 1);
  assert.equal(editDistance('recpetion', 'reception', 2), 1, 'swapped letters count once');
  assert.equal(editDistance('lab', 'ward', 1), 2, 'stops early past the limit');
});

test('synonyms: what people say finds what the map calls it', () => {
  assert.equal(names('x-ray')[0], 'Imaging');
  assert.equal(names('xray')[0], 'Imaging');
  assert.equal(names('rontgen')[0], 'Imaging');
  assert.equal(names('blood test')[0], 'Lab 1');
  assert.equal(names('medicine')[0], 'Pharmacy');
  assert.equal(names('apotek')[0], 'Pharmacy');
  assert.equal(names('restroom')[0], 'WC');
  assert.equal(names('coffee')[0], 'Kopi corner');
  assert.equal(names('parkir')[0], 'Visitor car park');
});

test("other names find a place, and say which one matched", () => {
  const [hit] = search(list, 'dr sari');
  assert.equal(hit.place.name, 'Room 12');
  assert.equal(hit.via, 'Dr. Sari Wijaya');
  assert.equal(names('poli anak')[0], 'Room 12');
});

test('typos and half-typed words still find the place', () => {
  assert.equal(names('pharmcy')[0], 'Pharmacy');
  assert.equal(names('radiolgy')[0], 'Imaging');
  assert.equal(names('wijya')[0], 'Room 12');
  assert.equal(names('phar')[0], 'Pharmacy');
  assert.deepEqual(names('zzzz'), []);
});

test('the name itself ranks above a passing mention', () => {
  assert.equal(names('main')[0], 'Main', 'the building named Main, before rooms in it');
  assert.equal(names('pharmacy')[0], 'Pharmacy');
  assert.equal(names('').length, list.length);
});

test('landmarks keep their kind, and shortcuts offer the kinds on the map', () => {
  const network = parseNetwork({
    nodes: [
      { id: 'p', name: 'Car park', x: 1, y: 1, category: 'parking' },
      { id: 'o', name: 'Fountain', x: 2, y: 2, category: 'other' },
    ],
    edges: [],
  }, 10, 10);
  assert.equal(network.nodes[0].category, 'parking');
  assert.equal(network.nodes[1].category, undefined, '"other" is the default and not stored');
  assert.throws(() => parseNetwork({ nodes: [{ id: 'x', name: 'X', x: 1, y: 1, category: 'zoo' }], edges: [] }, 10, 10));
  const found = places([], network);
  assert.equal(found[0].detail, 'Parking');
  assert.equal(found[1].detail, 'Landmark');
  assert.deepEqual(shortcuts(found), [{ name: 'Parking', kind: 'landmark', category: 'parking' }]);
  assert.equal(nearestOfType(buildGrid([], 10, 10), found, 'Parking', null)?.name, 'Car park');
  assert.deepEqual(shortcuts(list).slice(0, 3).map((s) => s.name), ['Toilets', 'Café', 'Pharmacy']);
});

test('a clinic is found by its doctors and their specialties', () => {
  const clinic: Place = {
    id: 'r:9', name: 'Room 7', kind: 'room', detail: 'Examination room', building: 'Clinic', point: at,
    info: { doctors: [{ name: 'dr. Budi Santoso, Sp.PD', specialty: 'Penyakit Dalam', hours: [] }] },
  };
  const [hit] = search([...list, clinic], 'dr budi');
  assert.equal(hit.place.name, 'Room 7');
  assert.equal(hit.via, 'dr. Budi Santoso, Sp.PD');
  assert.equal(search([...list, clinic], 'penyakit dalam')[0].place.name, 'Room 7');
});
