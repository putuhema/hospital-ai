import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, type Rows } from '../bridge/snapshot.ts';
import { parseSnapshot, turnOf, type Live, type Ticket } from '../src/lib/model/live.ts';

const base: Rows = {
  clinics: [{ kd_poli: 'INT', nm_poli: 'Poliklinik Penyakit Dalam' }],
  registrations: [{ kd_poli: 'INT', nm_poli: 'Poliklinik Penyakit Dalam', kd_dokter: 'D1', nm_dokter: 'dr. Malik', registered: 12, waiting: '4' }],
  quotas: [],
  serving: [{ kd_poli: 'INT', kd_dokter: 'D1', no_reg: '006' }],
  beds: [],
};

test('the bridge sends the numbers still waiting per doctor, numbers only', () => {
  const snapshot = buildSnapshot({
    ...base,
    waiting: [
      { kd_poli: 'INT', kd_dokter: 'D1', no_reg: '012' },
      { kd_poli: 'INT', kd_dokter: 'D1', no_reg: '006' },
      { kd_poli: 'INT', kd_dokter: 'D1', no_reg: '009' },
      { kd_poli: 'INT', kd_dokter: 'D1', no_reg: '009' },
      // Another doctor nobody registered with today, and a number SIMRS can't mean: left out.
      { kd_poli: 'INT', kd_dokter: 'D2', no_reg: '001' },
      { kd_poli: 'INT', kd_dokter: 'D1', no_reg: 'abc' },
    ],
  });
  assert.deepEqual(snapshot.clinics[0].doctors[0].waitingNos, [6, 9, 12]);
  assert.deepEqual(parseSnapshot(snapshot).clinics[0].doctors[0].waitingNos, [6, 9, 12]);
  // An older bridge sends none.
  assert.equal(buildSnapshot(base).clinics[0].doctors[0].waitingNos, undefined);
  assert.throws(() => parseSnapshot({ ...snapshot, clinics: [{ ...snapshot.clinics[0], doctors: [{ ...snapshot.clinics[0].doctors[0], waitingNos: [-1] }] }] }), /Invalid snapshot/);
});

const live: Live = {
  at: 0,
  wards: [],
  clinics: [{ code: 'INT', name: 'Poliklinik Penyakit Dalam', registered: 12, waiting: 3, doctors: [{ code: 'D1', name: 'dr. Malik', registered: 12, waiting: 3, serving: '006', waitingNos: [6, 9, 12] }] }],
  counter: { tickets: 40, called: 31, waiting: 9, counters: [{ no: 1, serving: 31 }, { no: 2, serving: 30 }] },
};
const poli = (number: number, doctor = 'D1'): Ticket => ({ kind: 'poli', clinic: 'INT', doctor, number, day: '2026-11-12' });
const loket = (number: number): Ticket => ({ kind: 'loket', number, day: '2026-11-12' });

test('at a clinic: the numbers still waiting before yours, your turn, or already called', () => {
  assert.deepEqual(turnOf(poli(12), live), { state: 'waiting', ahead: 2, serving: 6 });
  assert.deepEqual(turnOf(poli(9), live), { state: 'waiting', ahead: 1, serving: 6 });
  assert.deepEqual(turnOf(poli(6), live), { state: 'now' });
  // Seen already (below the number called), or not waiting under this doctor.
  assert.deepEqual(turnOf(poli(3), live), { state: 'passed' });
  assert.deepEqual(turnOf(poli(10), live), { state: 'missing' });
  assert.deepEqual(turnOf(poli(9, 'D9'), live), { state: 'unknown' });
  assert.deepEqual(turnOf(poli(9), null), { state: 'unknown' });
  // Without the waiting numbers: counted from the number called.
  const older: Live = { ...live, clinics: [{ ...live.clinics[0], doctors: [{ ...live.clinics[0].doctors[0], waitingNos: undefined }] }] };
  assert.deepEqual(turnOf(poli(10), older), { state: 'waiting', ahead: 3, serving: 6 });
});

test('at the registration counters: numbers between the one called and yours, and which counter calls you', () => {
  assert.deepEqual(turnOf(loket(35), live), { state: 'waiting', ahead: 3, serving: 31 });
  assert.deepEqual(turnOf(loket(32), live), { state: 'waiting', ahead: 0, serving: 31 });
  assert.deepEqual(turnOf(loket(30), live), { state: 'now', counter: 2 });
  assert.deepEqual(turnOf(loket(12), live), { state: 'passed' });
  // A ticket not printed yet today.
  assert.deepEqual(turnOf(loket(41), live), { state: 'unknown' });
  assert.deepEqual(turnOf(loket(5), { ...live, counter: { tickets: 9, called: 0, waiting: 9, counters: [] } }), { state: 'waiting', ahead: 4 });
  assert.deepEqual(turnOf(loket(5), { ...live, counter: undefined }), { state: 'unknown' });
});
