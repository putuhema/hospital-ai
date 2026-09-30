import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantContext,
  findNearest,
  getDirections,
  getDoctorSchedule,
  type DoctorSchedule,
  getPlaceDetails,
  placeTypes,
  runTool,
  searchPlaces,
  showOnMap,
  toolDefinitions,
  type AssistantContext,
} from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';

// The starter campus, with visitor info on the pharmacy and a second toilet block.
const pieces = structuredClone(starterPieces);
const lab = pieces.find((p) => p.name === 'Pharmacy & lab')!;
lab.roomAssets![0].info = {
  description: 'Prescriptions from all clinics',
  phone: '+62 361 123 456',
  hours: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '16:00' }],
  keywords: ['Apotek Sehat'],
};
lab.roomAssets!.push({ id: 99, type: 'toilet', name: 'Back toilets', x: 0, y: 0, w: 1, h: 1, door: 'south' });
const layout = parseLayout(JSON.stringify({ pieces }));
// 2026-09-28 is a Monday.
const at = (time: string) => new Date(`2026-09-28T${time}:00`);
const ctx: AssistantContext = assistantContext(layout, at('10:00'));
const idOf = (name: string) => ctx.places.find((p) => p.name === name)!.id;

test('search_places finds places by what people call them, with open-now', () => {
  const result = searchPlaces(ctx, { query: 'apotek sehat' });
  assert.ok('results' in result);
  assert.deepEqual(result.results[0], {
    id: idOf('Pharmacy'),
    name: 'Pharmacy',
    type: 'Pharmacy',
    building: 'Pharmacy & lab',
    status: 'Open now · until 16:00',
    open: true,
    matched: 'Apotek Sehat',
  });
  assert.equal((searchPlaces(ctx, { query: 'obat' }) as { results: { name: string }[] }).results[0].name, 'Pharmacy');
  assert.equal((searchPlaces(ctx, { query: 'blood test' }) as { results: { name: string }[] }).results[0].name, 'Laboratory');
  assert.deepEqual(searchPlaces(ctx, { query: 'helipad' }), { results: [] });
  assert.equal((searchPlaces(ctx, { query: 'room', limit: 2 }) as { results: unknown[] }).results.length, 2);
  assert.deepEqual(searchPlaces(ctx, { query: '  ?! ' }), { error: 'The query is empty.' });
});

test('get_place_details gives the visitor info, and whether it is open at the hospital\'s time', () => {
  assert.deepEqual(getPlaceDetails(ctx, { place_id: idOf('Pharmacy') }), {
    id: idOf('Pharmacy'),
    name: 'Pharmacy',
    type: 'Pharmacy',
    building: 'Pharmacy & lab',
    status: 'Open now · until 16:00',
    open: true,
    description: 'Prescriptions from all clinics',
    phone: '+62 361 123 456',
    hours: ['Mon–Fri 08:00–16:00'],
    other_names: ['Apotek Sehat'],
  });
  const evening = { ...ctx, now: at('18:30') };
  assert.equal((getPlaceDetails(evening, { place_id: idOf('Pharmacy') }) as { status: string }).status, 'Closed · opens tomorrow 08:00');
  // No hours set: no status, rather than a guess.
  assert.deepEqual(getPlaceDetails(ctx, { place_id: idOf('Laboratory') }), {
    id: idOf('Laboratory'), name: 'Laboratory', type: 'Laboratory', building: 'Pharmacy & lab',
  });
  assert.match((getPlaceDetails(ctx, { place_id: 'r:0:0' }) as { error: string }).error, /no place with id "r:0:0"/);
});

test('find_nearest picks the shortest walk, and understands what the kind is called', () => {
  const fromLab = findNearest(ctx, { type: 'Toilets', from_place_id: idOf('Laboratory') });
  assert.ok('place' in fromLab);
  assert.equal(fromLab.place.name, 'Back toilets');
  const fromWard = findNearest(ctx, { type: 'wc', from_place_id: idOf('Room 1') });
  assert.ok('place' in fromWard && fromWard.place.name === 'Toilets');
  assert.ok(fromWard.meters! > 0 && fromWard.minutes! >= 1);
  // Without a start there is a place of that kind but no distance.
  const anywhere = findNearest(ctx, { type: 'pharmacy' });
  assert.deepEqual(Object.keys(anywhere), ['place']);
  const missing = findNearest(ctx, { type: 'helipad' }) as { error: string };
  assert.match(missing.error, /no "helipad"/);
  assert.match(missing.error, /Toilets/, 'lists the kinds there are');
  assert.ok(placeTypes(ctx).includes('Pharmacy'));
  assert.ok('error' in findNearest(ctx, { type: 'Toilets', from_place_id: 'nowhere' }));
});

test('get_directions walks from one place to another', () => {
  const d = getDirections(ctx, { from_place_id: idOf('Main reception'), to_place_id: idOf('Pharmacy') });
  assert.ok('steps' in d);
  assert.equal(d.from.name, 'Main reception');
  assert.equal(d.to.name, 'Pharmacy');
  assert.ok(d.meters > 10 && d.minutes >= 1);
  assert.match(d.steps[0], /^From Main reception/);
  assert.match(d.steps.at(-1)!, /Arrive at Pharmacy/);
  assert.ok('error' in getDirections(ctx, { from_place_id: 'x', to_place_id: idOf('Pharmacy') }));
});

test('show_on_map returns a place or a route in the map\'s own link format', () => {
  const pharmacy = idOf('Pharmacy'), reception = idOf('Main reception');
  assert.deepEqual(showOnMap(ctx, { place_id: pharmacy }), {
    shown: 'Pharmacy',
    show: { kind: 'place', to: pharmacy, link: `?to=${pharmacy}` },
  });
  const route = showOnMap(ctx, { place_id: pharmacy, from_place_id: reception });
  const walk = getDirections(ctx, { from_place_id: reception, to_place_id: pharmacy }) as { meters: number; minutes: number };
  assert.deepEqual(route, {
    shown: 'Route from Main reception to Pharmacy',
    show: { kind: 'route', from: reception, to: pharmacy, link: `?from=${reception}&to=${pharmacy}`, meters: walk.meters, minutes: walk.minutes },
  });
  assert.ok('error' in showOnMap(ctx, { place_id: 'b:404' }));
});

test('runTool checks the input against the tool definitions', () => {
  assert.deepEqual(toolDefinitions.map((t) => t.name), ['search_places', 'get_place_details', 'get_doctor_schedule', 'find_nearest', 'get_directions', 'show_on_map']);
  assert.ok('results' in runTool(ctx, 'search_places', { query: 'pharmacy' }));
  assert.deepEqual(runTool(ctx, 'book_appointment', {}), { error: 'There is no tool called "book_appointment".' });
  assert.deepEqual(runTool(ctx, 'search_places', {}), { error: '"query" is required.' });
  assert.deepEqual(runTool(ctx, 'search_places', { query: 5 }), { error: '"query" must be a string.' });
  assert.deepEqual(runTool(ctx, 'search_places', { query: 'lab', limit: 1.5 }), { error: '"limit" must be a whole number.' });
  assert.deepEqual(runTool(ctx, 'get_place_details', { place_id: 'b:1', extra: true }), { error: 'Unknown input "extra".' });
  assert.deepEqual(runTool(ctx, 'show_on_map', null), { error: 'The input must be an object.' });
  // Every result survives a round trip through JSON, as it will to the model.
  const result = runTool(ctx, 'get_directions', { from_place_id: idOf('Room 1'), to_place_id: idOf('Laboratory') });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('get_doctor_schedule finds doctors by name or specialty, with today\'s status and leave', () => {
  const withDoctors = structuredClone(pieces);
  withDoctors.find((p) => p.name === 'Outpatient clinic')!.roomAssets![0].info = {
    doctors: [
      { name: 'dr. Sari Wijaya, Sp.A', specialty: 'Anak', hours: [{ days: [1, 3], open: '08:00', close: '12:00' }],
        leave: [{ from: '2026-09-30', to: '2026-10-02' }] },
      { name: 'dr. Budi Santoso, Sp.PD', specialty: 'Penyakit Dalam', hours: [{ days: [2, 4], open: '13:00', close: '16:00' }] },
    ],
  };
  const c = assistantContext(parseLayout(JSON.stringify({ pieces: withDoctors })), at('10:00'));
  const find = (query: string) => (getDoctorSchedule(c, { query }) as { doctors: DoctorSchedule[] }).doctors;
  const [sari] = find('Kapan dr Sari praktik?');
  assert.deepEqual(sari, {
    name: 'dr. Sari Wijaya, Sp.A',
    specialty: 'Anak',
    place: { id: sari.place!.id, name: 'Exam room 1', type: 'Examination room', building: 'Outpatient clinic' },
    hours: ['Mon, Wed 08:00–12:00'],
    status: 'Practising · until 12:00',
    practising: true,
    leave: ['30 Sep – 2 Oct'],
  });
  assert.deepEqual(find('poli anak').map((d) => d.name), ['dr. Sari Wijaya, Sp.A']);
  assert.deepEqual(find('penyakit dalam').map((d) => d.name), ['dr. Budi Santoso, Sp.PD']);
  assert.deepEqual(find('children').map((d) => d.name), ['dr. Sari Wijaya, Sp.A'], 'what search knows: children = anak');
  assert.deepEqual(find('budy').map((d) => d.name), ['dr. Budi Santoso, Sp.PD'], 'a typo');
  assert.equal(find('dokter').length, 2, 'no name: all of them');
  assert.deepEqual(find('dr Andi'), []);
  // The place's details list its doctors too.
  const details = getPlaceDetails(c, { place_id: sari.place!.id }) as { doctors: DoctorSchedule[] };
  assert.equal(details.doctors.length, 2);
  assert.equal(details.doctors[0].place, undefined);
  assert.deepEqual(getDoctorSchedule(ctx, { query: 'dr Sari' }), { error: "No doctors' schedules are on this map." });
});
