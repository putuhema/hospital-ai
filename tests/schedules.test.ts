import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedules, buildSnapshot, type Rows } from '../bridge/snapshot.ts';
import { parseSchedules, sameDoctor, scheduledDoctors, tidyName, withSchedules, type ClinicSchedule } from '../src/lib/model/schedules.ts';
import { doctorToday, parseSnapshot, started, type Live } from '../src/lib/model/live.ts';
import { parseDoctors } from '../src/lib/model/doctors.ts';
import { splitLayout, joinLayout } from '../src/lib/model/records.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { assistantContext, getDoctorSchedule, type AssistantContext } from '../src/lib/assistant/tools.ts';

// Khanza's jadwal as the bridge reads it: one row per doctor, clinic and day.
const jadwal: NonNullable<Rows['schedules']> = [
  ...['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'].map((hari_kerja) => ({
    kd_poli: 'INT', kd_dokter: 'D1', nm_dokter: 'dr. MALIK CANDRA Sp.PD', hari_kerja, open: '08:00', close: '12:00',
  })),
  { kd_poli: 'INT', kd_dokter: 'D1', nm_dokter: 'dr. MALIK CANDRA Sp.PD', hari_kerja: 'SABTU', open: '08:00', close: '10:00' },
  { kd_poli: 'INT', kd_dokter: 'D2', nm_dokter: 'dr. Idham Shadiq Kawu, Sp.,PD', hari_kerja: 'RABU', open: '13:00', close: '16:00' },
  { kd_poli: 'IGD', kd_dokter: 'D9', nm_dokter: 'dr. Jaga', hari_kerja: 'AKHAD', open: '08:00', close: '08:00' },
  // Rows SIMRS can't mean: skipped.
  { kd_poli: 'INT', kd_dokter: 'D3', nm_dokter: 'dr. X', hari_kerja: 'MINGGU', open: '08:00', close: '12:00' },
  { kd_poli: 'INT', kd_dokter: 'D3', nm_dokter: 'dr. X', hari_kerja: 'SENIN', open: '8:00', close: '12:00' },
];

test('the bridge turns Khanza\'s jadwal into each doctor\'s hours, days with the same hours together', () => {
  const schedules = buildSchedules(jadwal);
  assert.deepEqual(schedules, [
    { code: 'IGD', doctors: [{ code: 'D9', name: 'dr. Jaga', hours: [{ days: [0], open: '08:00', close: '08:00' }] }] },
    {
      code: 'INT',
      doctors: [
        { code: 'D2', name: 'dr. Idham Shadiq Kawu, Sp.,PD', hours: [{ days: [3], open: '13:00', close: '16:00' }] },
        {
          code: 'D1',
          name: 'dr. MALIK CANDRA Sp.PD',
          hours: [
            { days: [1, 2, 3, 4, 5], open: '08:00', close: '12:00' },
            { days: [6], open: '08:00', close: '10:00' },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(parseSchedules(schedules), schedules);
  const snapshot = buildSnapshot({ clinics: [], registrations: [], quotas: [], serving: [], beds: [], schedules: jadwal });
  assert.deepEqual(parseSnapshot(snapshot).schedules, schedules);
  // An older bridge sends none.
  assert.equal(parseSnapshot({ clinics: [], wards: [] }).schedules, undefined);
  for (const bad of [{}, [{ code: 'A', doctors: [{ code: 'D', name: 'x', hours: [{ days: [9], open: '08:00', close: '09:00' }] }] }], [{ code: 'A', doctors: [] }, { code: 'A', doctors: [] }]])
    assert.throws(() => parseSchedules(bad), /Invalid schedules/);
});

test('names typed in capitals read normally, and the same doctor is recognised however the name is written', () => {
  assert.equal(tidyName('dr. KEVIN CHERLIE, Sp.A'), 'dr. Kevin Cherlie, Sp.A');
  assert.equal(tidyName('drg. DESI SAFITRIA AZIS,M.Kes'), 'drg. Desi Safitria Azis,M.Kes');
  assert.equal(tidyName('dr. Malik  Candra Sp.PD'), 'dr. Malik Candra Sp.PD');
  assert.ok(sameDoctor('drg. Desi Safitria Aziz, M.kes', 'drg. DESI SAFITRIA AZIS,M.Kes'));
  assert.ok(sameDoctor('dr. Kevin Cherlie, Sp.A', 'dr. KEVIN CHERLIE, Sp.A'));
  assert.ok(!sameDoctor('drg. Rizki Amaliyah', 'drg. Masita'));
  assert.ok(!sameDoctor('dr.', 'dr. Masita'));
});

test('a place linked to a SIMRS clinic lists SIMRS\'s doctors, keeping the editor\'s spelling, specialty and leave', () => {
  const schedules = buildSchedules(jadwal);
  const typed = [
    { name: 'dr. Malik Candra, Sp.PD', specialty: 'Penyakit Dalam', hours: [{ days: [1], open: '07:00', close: '09:00' }], leave: [{ from: '2026-11-20', to: '2026-11-21' }] },
    { name: 'dr. Gone', hours: [{ days: [1], open: '08:00', close: '09:00' }] },
  ];
  assert.deepEqual(scheduledDoctors(['poli:INT', 'ward:W1'], schedules, typed), [
    { code: 'D2', name: 'dr. Idham Shadiq Kawu, Sp.,PD', hours: [{ days: [3], open: '13:00', close: '16:00' }] },
    {
      code: 'D1',
      name: 'dr. Malik Candra, Sp.PD',
      specialty: 'Penyakit Dalam',
      leave: [{ from: '2026-11-20', to: '2026-11-21' }],
      hours: [
        { days: [1, 2, 3, 4, 5], open: '08:00', close: '12:00' },
        { days: [6], open: '08:00', close: '10:00' },
      ],
    },
  ]);
  assert.equal(scheduledDoctors(['poli:NONE'], schedules, typed), undefined);
  assert.equal(scheduledDoctors(undefined, schedules), undefined);
  // The doctor's SIMRS code survives the checks the map runs on the layout.
  assert.equal(parseDoctors(scheduledDoctors(['poli:INT'], schedules))![0].code, 'D2');
  assert.throws(() => parseDoctors([{ name: 'x', hours: [], code: 5 }]), /Invalid doctors/);
});

// The starter campus: one room linked to the SIMRS clinic, one typed by hand.
const pieces = structuredClone(starterPieces);
const rooms = pieces.flatMap((p) => p.roomAssets ?? []);
rooms[0].name = 'Poli Interna';
rooms[0].info = { simrs: ['poli:INT'], doctors: [{ name: 'dr. Malik Candra, Sp.PD', hours: [{ days: [1], open: '07:00', close: '09:00' }] }] };
rooms[1].name = 'Poli Mata';
rooms[1].info = { doctors: [{ name: 'dr. Mata', hours: [{ days: [2], open: '09:00', close: '11:00' }] }] };
const layout = parseLayout(JSON.stringify({ pieces }));

test('visitors get SIMRS\'s schedules for linked clinics and the typed ones elsewhere', () => {
  const records = splitLayout(layout);
  const visitors = parseLayout(JSON.stringify(joinLayout(withSchedules(records, buildSchedules(jadwal)))));
  const room = (name: string) => visitors.pieces.flatMap((p) => p.roomAssets ?? []).find((r) => r.name === name)!;
  assert.deepEqual(room('Poli Interna').info!.doctors!.map((d) => [d.name, d.code, d.hours.length]), [
    ['dr. Idham Shadiq Kawu, Sp.,PD', 'D2', 1],
    ['dr. Malik Candra, Sp.PD', 'D1', 2],
  ]);
  assert.deepEqual(room('Poli Mata').info!.doctors!.map((d) => d.name), ['dr. Mata']);
  // Nothing from SIMRS: the typed doctors as they are.
  assert.equal(withSchedules(records, []), records);
});

test('while a doctor practises, the assistant says whether they have started on today\'s patients', () => {
  const visitors = parseLayout(JSON.stringify(joinLayout(withSchedules(splitLayout(layout), buildSchedules(jadwal)))));
  const queue = (registered: number, waiting: number, serving?: string): Live => ({
    clinics: [{ code: 'INT', name: 'Poliklinik Penyakit Dalam', registered, waiting, doctors: [{ code: 'D1', name: 'dr. MALIK CANDRA Sp.PD', registered, waiting, ...(serving && { serving }) }] }],
    wards: [],
    at: Date.now(),
  });
  // 2026-09-28 is a Monday: dr. Malik practises 08:00–12:00.
  const ctx = (live: Live | null, time = '10:00'): AssistantContext => ({ ...assistantContext(visitors, new Date(`2026-09-28T${time}:00`)), live });
  const malik = (c: AssistantContext) => (getDoctorSchedule(c, { query: 'malik' }) as { doctors: Record<string, unknown>[] }).doctors[0];

  let c = ctx(queue(5, 2, '004'));
  assert.deepEqual([malik(c).practising, malik(c).seeing_patients, malik(c).seen_today, malik(c).from_simrs, c.liveUsed], [true, true, 3, true, true]);
  c = ctx(queue(5, 5));
  assert.deepEqual([malik(c).seeing_patients, malik(c).seen_today], [false, 0]);
  // Nobody registered, the bridge silent, or outside practice hours: nothing said.
  for (const quiet of [ctx(queue(0, 0)), ctx(null), ctx(queue(5, 5), '14:00')]) {
    assert.equal(malik(quiet).seeing_patients, undefined);
    assert.equal(quiet.liveUsed, undefined);
  }
  assert.equal(started(doctorToday(queue(1, 1, '001'), 'D1')), true);
  assert.equal(doctorToday(queue(1, 1), undefined), undefined);
});
