import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCounter, buildSnapshot, type Rows } from '../bridge/snapshot.ts';
import { fresh, liveFor, parseLinks, parseSnapshot, quotaLeft, STALE_MS, type Live } from '../src/lib/model/live.ts';
import { parseInfo } from '../src/lib/model/place-info.ts';
import { assistantContext, getBedAvailability, getClinicQueue, getPlaceDetails, getRegistrationQueue, runTool, type AssistantContext } from '../src/lib/assistant/tools.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';

// As the database driver returns them: sums as text.
const rows: Rows = {
  clinics: [
    { kd_poli: 'ANA', nm_poli: 'Poliklinik Anak' },
    { kd_poli: 'INT', nm_poli: 'Poliklinik Penyakit Dalam' },
  ],
  registrations: [
    { kd_poli: 'ANA', nm_poli: 'Poliklinik Anak', kd_dokter: 'D1', nm_dokter: 'dr. Sari, Sp.A', registered: 12, waiting: '5' },
    { kd_poli: 'ANA', nm_poli: 'Poliklinik Anak', kd_dokter: 'D2', nm_dokter: 'dr. Budi, Sp.A', registered: 3, waiting: '3' },
    // A clinic no longer in use that still got a patient is listed.
    { kd_poli: 'IGD', nm_poli: 'IGD', kd_dokter: 'D9', nm_dokter: 'dr. Jaga', registered: 4, waiting: '0' },
  ],
  quotas: [
    { kd_poli: 'ANA', kd_dokter: 'D1', nm_dokter: 'dr. Sari, Sp.A', kuota: '20' },
    { kd_poli: 'INT', kd_dokter: 'D3', nm_dokter: 'dr. Malik, Sp.PD', kuota: '40' },
    { kd_poli: 'OLD', kd_dokter: 'D4', nm_dokter: 'dr. Lama', kuota: '10' },
  ],
  serving: [
    { kd_poli: 'ANA', kd_dokter: 'D1', no_reg: '007' },
    { kd_poli: 'INT', kd_dokter: 'D8', no_reg: '001' },
  ],
  beds: [
    { kd_bangsal: 'MLT', nm_bangsal: 'Melati', kelas: 'Kelas VIP', beds: 2, empty: '0' },
    { kd_bangsal: 'MLT', nm_bangsal: 'Melati', kelas: 'Kelas 1', beds: 6, empty: '2' },
    { kd_bangsal: 'ICU', nm_bangsal: 'ICU', kelas: 'Kelas 3', beds: 4, empty: '0' },
  ],
};
const snapshot = buildSnapshot(rows);

test('the bridge turns SIMRS rows into queues per clinic and beds per ward', () => {
  assert.deepEqual(snapshot.clinics.map((c) => c.code), ['IGD', 'ANA', 'INT']);
  assert.deepEqual(snapshot.clinics[1], {
    code: 'ANA',
    name: 'Poliklinik Anak',
    registered: 15,
    waiting: 8,
    doctors: [
      { code: 'D2', name: 'dr. Budi, Sp.A', registered: 3, waiting: 3 },
      { code: 'D1', name: 'dr. Sari, Sp.A', registered: 12, waiting: 5, quota: 20, serving: '007' },
    ],
  });
  // A doctor practising today is listed before anyone registers; a called number without a registration is not.
  assert.deepEqual(snapshot.clinics[2].doctors, [{ code: 'D3', name: 'dr. Malik, Sp.PD', registered: 0, waiting: 0, quota: 40 }]);
  assert.deepEqual(snapshot.wards, [
    { code: 'ICU', name: 'ICU', beds: 4, empty: 0, classes: [{ name: 'Kelas 3', beds: 4, empty: 0 }] },
    {
      code: 'MLT',
      name: 'Melati',
      beds: 8,
      empty: 2,
      classes: [
        { name: 'Kelas 1', beds: 6, empty: 2 },
        { name: 'Kelas VIP', beds: 2, empty: 0 },
      ],
    },
  ]);
  assert.equal(quotaLeft(snapshot.clinics[1].doctors[1]), 8);
  assert.equal(quotaLeft(snapshot.clinics[1].doctors[0]), undefined);
});

test('the registration counters\' queue: tickets taken, the number called, and yesterday\'s numbers left out', () => {
  const tickets = [{ tickets: '36' }];
  const counters = [
    { loket: 1, antrian: 31 },
    { loket: 2, antrian: 30 },
    { loket: 3, antrian: 0 },
  ];
  assert.deepEqual(buildCounter({ tickets, counters, called: [{ last_number: 31 }] }), {
    tickets: 36,
    called: 31,
    waiting: 5,
    counters: [
      { no: 1, serving: 31 },
      { no: 2, serving: 30 },
    ],
  });
  // A Khanza without the "called last" table: the highest number a counter serves.
  assert.equal(buildCounter({ tickets, counters })!.called, 31);
  // The morning after: the counters still hold yesterday's numbers, beyond today's 4 tickets.
  assert.deepEqual(buildCounter({ tickets: [{ tickets: 4 }], counters, called: [{ last_number: 31 }] }), { tickets: 4, called: 0, waiting: 4, counters: [] });
  // No such queue in this SIMRS.
  assert.equal(buildCounter({}), undefined);
  assert.equal(buildSnapshot(rows).counter, undefined);
  const withCounter = buildSnapshot({ ...rows, tickets, counters });
  assert.deepEqual(parseSnapshot(withCounter), withCounter);
  assert.throws(() => parseSnapshot({ clinics: [], wards: [], counter: { tickets: 1, called: -1, waiting: 0, counters: [] } }), /Invalid snapshot/);
  assert.deepEqual(parseInfo({ simrs: ['loket'] }), { simrs: ['loket'] });
  const shown = liveFor(['loket'], { ...withCounter, at: 1 })!;
  assert.deepEqual([shown.counter?.waiting, shown.clinics.length], [5, 0]);
  assert.equal(liveFor(['loket'], { ...snapshot, at: 1 }), null);
});

test('what the bridge sends is checked before it is stored', () => {
  assert.deepEqual(parseSnapshot(snapshot), snapshot);
  assert.deepEqual(parseSnapshot({ clinics: [], wards: [] }), { clinics: [], wards: [] });
  const bad = [
    null,
    { clinics: [] },
    { clinics: [{ code: 'A', name: 'A', registered: -1, waiting: 0, doctors: [] }], wards: [] },
    { clinics: [{ code: 'A', name: 'A', registered: 1.5, waiting: 0, doctors: [] }], wards: [] },
    { clinics: [{ code: 'A', name: 'A', registered: 1, waiting: 0, doctors: [{ code: 'D', name: 'x'.repeat(101), registered: 0, waiting: 0 }] }], wards: [] },
    { clinics: [snapshot.clinics[0], snapshot.clinics[0]], wards: [] },
    { clinics: [], wards: [{ code: 'W', name: 'W', beds: 1, empty: 0, classes: [{ name: '', beds: 1, empty: 0 }] }] },
  ];
  for (const value of bad) assert.throws(() => parseSnapshot(value), /Invalid snapshot/);
});

test('a place shows the clinics and wards it is linked to, while the figures are recent', () => {
  const live: Live = { ...snapshot, at: 1_000_000 };
  assert.equal(fresh(live, live.at + STALE_MS - 1), live);
  assert.equal(fresh(live, live.at + STALE_MS), null);
  assert.equal(fresh(null, 0), null);
  const shown = liveFor(['ward:MLT', 'poli:ANA', 'poli:GONE'], live)!;
  assert.deepEqual([shown.clinics.map((c) => c.code), shown.wards.map((w) => w.code), shown.at], [['ANA'], ['MLT'], live.at]);
  assert.equal(liveFor(['poli:GONE'], live), null);
  assert.equal(liveFor(undefined, live), null);
  assert.equal(liveFor(['poli:ANA'], null), null);

  assert.deepEqual(parseInfo({ simrs: ['poli:ANA', 'poli:ANA', 'ward:MLT'] }), { simrs: ['poli:ANA', 'ward:MLT'] });
  assert.equal(parseInfo({ simrs: [] }), undefined);
  assert.throws(() => parseLinks(['room:1']), /Invalid SIMRS links/);
  assert.throws(() => parseInfo({ simrs: 'poli:ANA' }), /Invalid SIMRS links/);
});

// The starter campus with a room linked to the children's clinic and one to the Melati ward.
const pieces = structuredClone(starterPieces);
const rooms = pieces.flatMap((p) => p.roomAssets ?? []);
rooms[0].name = 'Poli Anak';
rooms[0].info = { simrs: ['poli:ANA'] };
rooms[1].name = 'Ruang Melati';
rooms[1].info = { simrs: ['ward:MLT'] };
const layout = parseLayout(JSON.stringify({ pieces }));
const context = (live: Live | null): AssistantContext => ({ ...assistantContext(layout, new Date('2026-09-28T10:00:00')), live });
const idOf = (ctx: AssistantContext, name: string) => ctx.places.find((p) => p.name === name)!.id;

test('the assistant reads the queue and the beds, and such answers are marked as live', () => {
  const ctx = context({ ...snapshot, at: Date.now() });
  const queue = getClinicQueue(ctx, { query: 'antrian poli anak' });
  assert.ok('clinics' in queue);
  assert.equal(queue.clinics.length, 1);
  assert.equal(queue.clinics[0].place?.name, 'Poli Anak');
  assert.deepEqual(queue.clinics[0].doctors[1], {
    name: 'dr. Sari, Sp.A',
    registered_today: 12,
    waiting: 5,
    now_serving: '007',
    quota: 20,
    quota_left: 8,
  });
  assert.equal(ctx.liveUsed, true);
  // By a doctor's name, and without a query the clinics with patients, busiest first.
  assert.deepEqual((getClinicQueue(ctx, { query: 'dr malik' }) as { clinics: { clinic: string }[] }).clinics.map((c) => c.clinic), ['Poliklinik Penyakit Dalam']);
  assert.deepEqual((runTool(ctx, 'get_clinic_queue', {}) as { clinics: { clinic: string }[] }).clinics.map((c) => c.clinic), ['Poliklinik Anak', 'IGD']);
  assert.deepEqual((getClinicQueue(ctx, { query: 'jantung' }) as { clinics: unknown[] }).clinics, []);

  const beds = getBedAvailability(ctx, { query: 'kamar kosong kelas 1' });
  assert.ok('wards' in beds);
  assert.deepEqual([beds.wards.map((w) => w.ward), beds.empty_in_all, beds.wards[0].place?.name], [['Melati'], 2, 'Ruang Melati']);
  assert.deepEqual((getBedAvailability(ctx, {}) as { wards: { ward: string }[] }).wards.map((w) => w.ward), ['Melati', 'ICU']);

  const details = getPlaceDetails(ctx, { place_id: idOf(ctx, 'Poli Anak') });
  assert.ok('queue_today' in details);
  assert.deepEqual([details.queue_today![0].registered_today, details.queue_today![0].waiting], [15, 8]);
  assert.equal((getPlaceDetails(ctx, { place_id: idOf(ctx, 'Ruang Melati') }) as { beds_now: { empty: number }[] }).beds_now[0].empty, 2);
});

test('the assistant reads the registration counters\' queue', () => {
  const counter = { tickets: 36, called: 31, waiting: 5, counters: [{ no: 1, serving: 31 }] };
  const ctx = context({ ...snapshot, counter, at: Date.now() });
  assert.deepEqual(getRegistrationQueue(ctx, {}), { tickets_taken_today: 36, waiting: 5, last_called: '031', counters: [{ counter: 1, serving: '031' }] });
  assert.equal(ctx.liveUsed, true);
  assert.match((runTool(context({ ...snapshot, at: Date.now() }), 'get_registration_queue', {}) as { error: string }).error, /doesn't report/);
  assert.match((getRegistrationQueue(context(null), {}) as { error: string }).error, /aren't available/);
});

test('without the bridge the assistant says the figures are unavailable, and other answers stay cacheable', () => {
  const ctx = context(null);
  assert.match((getClinicQueue(ctx, { query: 'anak' }) as { error: string }).error, /aren't available/);
  assert.match((getBedAvailability(ctx, {}) as { error: string }).error, /aren't available/);
  const details = getPlaceDetails(ctx, { place_id: idOf(ctx, 'Poli Anak') });
  assert.ok(!('queue_today' in details));
  assert.equal(ctx.liveUsed, undefined);
});
