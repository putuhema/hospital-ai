import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertMessage, dueStep, finished, parseTicket } from '../src/lib/model/turn-alerts.ts';
import type { Ticket } from '../src/lib/model/live.ts';

const ticket: Ticket = { kind: 'poli', clinic: 'INT', doctor: 'D1', number: 12, day: '2026-11-17', label: 'Poli Penyakit Dalam · dr. Malik' };

test('an alert when three or fewer are before them, and when it is their turn, each once', () => {
  assert.equal(dueStep({ state: 'waiting', ahead: 5 }, []), null);
  assert.equal(dueStep({ state: 'waiting', ahead: 3 }, []), 'soon');
  assert.equal(dueStep({ state: 'waiting', ahead: 1 }, ['soon']), null);
  assert.equal(dueStep({ state: 'now' }, ['soon']), 'now');
  assert.equal(dueStep({ state: 'now' }, []), 'now');
  assert.equal(dueStep({ state: 'now' }, ['soon', 'now']), null);
  assert.equal(dueStep({ state: 'unknown' }, []), null);
});

test('an alert is over once the number was called and moved on', () => {
  assert.ok(finished({ state: 'passed' }, []));
  assert.ok(finished({ state: 'missing' }, ['now']));
  assert.ok(!finished({ state: 'now' }, ['now']));
  assert.ok(!finished({ state: 'missing' }, ['soon']));
});

test('the notification says how many are left, or where to go, in their language', () => {
  assert.deepEqual(alertMessage('soon', ticket, { state: 'waiting', ahead: 2 }, 'id'), {
    title: '2 lagi sebelum 012',
    body: 'Kembali sekarang agar tidak terlewat. Poli Penyakit Dalam · dr. Malik',
  });
  assert.equal(alertMessage('soon', ticket, { state: 'waiting', ahead: 0 }, 'id').title, 'Berikutnya nomor Anda: 012');
  const loket: Ticket = { kind: 'loket', number: 7, day: '2026-11-17' };
  assert.deepEqual(alertMessage('now', loket, { state: 'now', counter: 2 }, 'id'), {
    title: 'Giliran Anda: 007',
    body: 'Silakan ke loket 2 sekarang. Loket pendaftaran',
  });
  assert.equal(alertMessage('now', loket, { state: 'now' }, 'en').title, "It's your turn: 007");
});

test('only a real ticket is accepted from the browser', () => {
  assert.deepEqual(parseTicket(ticket), ticket);
  assert.deepEqual(parseTicket({ kind: 'loket', number: 7, day: '2026-11-17', extra: 'x' }), { kind: 'loket', number: 7, day: '2026-11-17' });
  assert.equal(parseTicket({ kind: 'loket', number: 0, day: '2026-11-17' }), null);
  assert.equal(parseTicket({ kind: 'loket', number: 7, day: 'today' }), null);
  assert.equal(parseTicket({ kind: 'poli', number: 7, day: '2026-11-17', clinic: 'INT' }), null);
  assert.equal(parseTicket('7'), null);
});
