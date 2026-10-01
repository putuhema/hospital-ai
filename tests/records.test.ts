import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinLayout, splitLayout, stableJson } from '../src/lib/model/records.ts';
import { withDoctors, withInfo, clinics } from '../src/lib/editor/hospital-info.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { layoutSnapshot } from '../src/lib/editor/export.ts';

const sari = { name: 'dr. Sari Wijaya', specialty: 'Anak', hours: [{ days: [1, 3], open: '08:00', close: '12:00' }] };
const budi = { name: 'dr. Budi', hours: [{ days: [2], open: '13:00', close: '16:00' }], leave: [{ from: '2026-10-01', to: '2026-10-03' }] };

function hospital() {
  const room = clinics(starterPieces).find((p) => p.kind === 'room')!;
  const building = clinics(starterPieces).find((p) => p.kind === 'building')!;
  let { pieces, network } = withInfo(starterPieces, { nodes: [{ id: 'w1', name: 'Masjid', x: 1, y: 1 }], edges: [] }, room.id, withDoctors({ phone: '0361 123' }, [sari, budi]));
  ({ pieces, network } = withInfo(pieces, network, building.id, { description: 'Poliklinik', hours: [{ days: [1, 2, 3, 4, 5], open: '07:00', close: '14:00' }] }));
  ({ pieces, network } = withInfo(pieces, network, 'n:w1', { keywords: ['musala'] }));
  const faq = [
    { question: 'Jam besuk?', answer: '10.00–12.00', topic: 'besuk' as const },
    { question: 'BPJS?', answer: 'Bawa kartu', topic: 'bpjs' as const },
  ];
  return parseLayout(layoutSnapshot({ title: 'RS Sanglah', greenery: 0.5, pieces, network, faq, width: 24, height: 20 }));
}

test('a hospital is stored as site, buildings, places, doctors and questions', () => {
  const r = splitLayout(hospital());
  assert.equal(r.site.title, 'RS Sanglah');
  assert.equal(r.site.greenery, 0.5);
  assert.equal(r.buildings.length, starterPieces.length);
  assert.ok(r.buildings.every((b) => !('info' in b.piece) && (b.piece.roomAssets ?? []).every((room) => !('info' in room))));
  assert.ok(r.site.network.nodes.every((n) => !('info' in n)));
  assert.deepEqual(r.doctors.map((d) => [d.name, d.order]), [['dr. Sari Wijaya', 0], ['dr. Budi', 1]]);
  assert.equal(r.places.length, 3);
  assert.ok(r.places.every((p) => !('doctors' in p.info)));
  assert.deepEqual(r.faq.map((e) => e.topic), ['besuk', 'bpjs']);
});

test('the stored rows put back together give the same hospital', () => {
  const layout = hospital();
  const back = parseLayout(JSON.stringify(joinLayout(splitLayout(layout))));
  assert.equal(stableJson(back), stableJson(layout));
});

test('stable JSON ignores key order and undefined fields', () => {
  assert.equal(stableJson({ b: 1, a: [{ y: 2, x: undefined }] }), stableJson({ a: [{ y: 2 }], b: 1 }));
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }));
});
