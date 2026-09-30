import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctorStatus, parseDoctors, shortDate, type Doctor } from '../src/lib/model/doctors.ts';
import { parseInfo } from '../src/lib/model/place-info.ts';

// 2026-09-28 is a Monday.
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
const sari: Doctor = {
  name: 'dr. Sari Wijaya, Sp.A',
  specialty: 'Anak',
  hours: [
    { days: [1, 3], open: '08:00', close: '12:00' },
    { days: [5], open: '13:00', close: '16:00' },
  ],
  leave: [{ from: '2026-09-30', to: '2026-10-02' }],
};

test('practising now, and when a doctor is next in', () => {
  assert.deepEqual(doctorStatus(sari, at('2026-09-28', '09:00'), 'id'), {
    practising: true, onLeave: false, text: 'Praktik · sampai 12.00',
  });
  assert.equal(doctorStatus(sari, at('2026-09-28', '09:00'))!.text, 'Practising · until 12:00');
  assert.equal(doctorStatus(sari, at('2026-09-28', '07:00'), 'id')!.text, 'Tidak praktik · mulai 08.00');
  // Wednesday and Friday are on leave, so she's next in a week today: the date, not "Sen".
  assert.equal(doctorStatus(sari, at('2026-09-28', '13:00'), 'id')!.text, 'Tidak praktik · mulai 5 Okt 08.00');
  assert.equal(doctorStatus({ ...sari, leave: [] }, at('2026-09-28', '13:00'), 'id')!.text, 'Tidak praktik · mulai Rab 08.00');
});

test('on leave: says so, and when the doctor is back', () => {
  const s = doctorStatus(sari, at('2026-09-30', '09:00'), 'id')!;
  assert.deepEqual(s, { practising: false, onLeave: true, text: 'Cuti · praktik lagi Sen 08.00' });
  assert.equal(doctorStatus(sari, at('2026-09-30', '09:00'))!.text, 'On leave · back Mon 08:00');
  // A long leave: back more than a week away, so the date is given.
  const long = { ...sari, leave: [{ from: '2026-09-29', to: '2026-10-10' }] };
  assert.equal(doctorStatus(long, at('2026-09-30', '09:00'), 'id')!.text, 'Cuti · praktik lagi 12 Okt 08.00');
  // No practice for four weeks: the leave's end date.
  const away = { ...sari, leave: [{ from: '2026-09-01', to: '2026-12-31' }] };
  assert.equal(doctorStatus(away, at('2026-09-30', '09:00'), 'id')!.text, 'Cuti · sampai 31 Des');
  assert.equal(shortDate('2026-05-03', 'en'), '3 May');
});

test('schedules are validated and tidied', () => {
  assert.equal(parseDoctors(undefined), undefined);
  assert.equal(parseDoctors([{ name: '  ', hours: [] }]), undefined, 'unnamed doctors are dropped');
  const [d] = parseDoctors([{ name: ' dr. Budi ', specialty: ' ', hours: [{ days: [3, 1, 1], open: '08:00', close: '12:00' }], leave: [] }])!;
  assert.deepEqual(d, { name: 'dr. Budi', hours: [{ days: [1, 3], open: '08:00', close: '12:00' }] });
  for (const bad of [
    'x',
    [{ name: 5, hours: [] }],
    [{ name: 'A', hours: [{ days: [9], open: '08:00', close: '09:00' }] }],
    [{ name: 'A', hours: [], leave: [{ from: '2026-10-05', to: '2026-10-01' }] }],
    [{ name: 'A', hours: [], leave: [{ from: '5 Oct', to: '2026-10-01' }] }],
  ])
    assert.throws(() => parseDoctors(bad));
  // Stored with the place's visitor info.
  assert.equal(parseInfo({ doctors: [sari] })!.doctors![0].specialty, 'Anak');
  assert.throws(() => parseInfo({ doctors: [{ name: 'A' }] }));
});
