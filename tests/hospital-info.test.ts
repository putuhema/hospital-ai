import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinics, withDoctors, withInfo } from '../src/lib/editor/hospital-info.ts';
import { parseLayout, starterPieces } from '../src/lib/model/layout.ts';
import { layoutSnapshot } from '../src/lib/editor/export.ts';
import { emptyNetwork } from '../src/lib/wayfinding/navigation.ts';

const sari = { name: 'dr. Sari Wijaya', specialty: 'Anak', hours: [{ days: [1, 3], open: '08:00', close: '12:00' }] };

test('doctors practise in rooms and buildings, rooms first', () => {
  const list = clinics(starterPieces);
  assert.ok(list.length > 0);
  assert.ok(list.every((p) => p.kind === 'room' || p.kind === 'building'));
  assert.equal(list.findIndex((p) => p.kind === 'building'), list.filter((p) => p.kind === 'room').length);
});

test("a clinic's doctors are saved with the layout, keeping its other details", () => {
  const room = clinics(starterPieces).find((p) => p.kind === 'room')!;
  const info = withDoctors({ phone: '123' }, [sari, { name: '', hours: [] }]);
  // The doctor still being written stays while editing…
  assert.equal(info?.doctors?.length, 2);
  const { pieces, network } = withInfo(starterPieces, emptyNetwork(), room.id, info);
  const saved = parseLayout(layoutSnapshot({ title: 'H', greenery: 1, pieces, network, width: 24, height: 20 }));
  // …and is dropped when the layout is loaded.
  assert.deepEqual(clinics(saved.pieces).find((p) => p.id === room.id)?.info, { phone: '123', doctors: [sari] });
  assert.deepEqual(withDoctors(info, []), { phone: '123' });
  assert.equal(withDoctors({ doctors: [sari] }, []), undefined);
});

test('landmarks and buildings take details by place id too', () => {
  const network = { nodes: [{ id: 'a', name: 'Lobby', x: 1, y: 1 }], edges: [] };
  assert.deepEqual(withInfo(starterPieces, network, 'n:a', { phone: '1' }).network.nodes[0].info, { phone: '1' });
  const building = clinics(starterPieces).find((p) => p.kind === 'building')!;
  assert.deepEqual(withInfo(starterPieces, network, building.id, { phone: '2' }).pieces.find((p) => p.id === building.pieceId)?.info, { phone: '2' });
});
