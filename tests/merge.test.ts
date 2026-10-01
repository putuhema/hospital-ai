import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLayouts } from '../src/lib/editor/merge.ts';
import { layoutSnapshot } from '../src/lib/editor/export.ts';
import { parseLayout, starterPieces, type Piece } from '../src/lib/model/layout.ts';
import type { FaqEntry } from '../src/lib/model/faq.ts';
import type { WalkingNetwork } from '../src/lib/wayfinding/navigation.ts';

type Project = { title?: string; pieces?: Piece[]; network?: WalkingNetwork; faq?: FaqEntry[]; greenery?: number };
const base = {
  title: 'RS Uji',
  greenery: 1,
  pieces: structuredClone(starterPieces),
  network: { nodes: [{ id: 'w1', name: 'Masjid', x: 1, y: 1 }], edges: [] } as WalkingNetwork,
  faq: [{ question: 'Jam besuk?', answer: '16.00–20.00', topic: 'besuk' as const }],
};
const snap = (p: Project = {}) => layoutSnapshot({ ...base, ...p, width: 24, height: 20 });
const rename = (pieces: Piece[], id: number, name: string) => pieces.map((p) => (p.id === id ? { ...p, name } : p));
const [first, second] = base.pieces;
const merge = (mine: Project, theirs: Project) => {
  const { layout, conflicts } = mergeLayouts(snap(), snap(mine), snap(theirs));
  return { ...parseLayout(layout), conflicts };
};

test('changes to different buildings are both kept', () => {
  const m = merge({ pieces: rename(base.pieces, first.id, 'Mine') }, { pieces: rename(base.pieces, second.id, 'Theirs') });
  assert.equal(m.pieces.find((p) => p.id === first.id)!.name, 'Mine');
  assert.equal(m.pieces.find((p) => p.id === second.id)!.name, 'Theirs');
  assert.deepEqual(m.conflicts, []);
});

test("a building added on one side and removed on the other are both kept", () => {
  const added = { ...first, id: 999, x: 0, y: 18, w: 1, h: 1, name: 'Kiosk', kind: 'path', roomAssets: undefined, entrances: undefined };
  const m = merge({ pieces: [...base.pieces, added] }, { pieces: base.pieces.filter((p) => p.id !== second.id) });
  assert.ok(m.pieces.some((p) => p.name === 'Kiosk'));
  assert.ok(!m.pieces.some((p) => p.id === second.id));
});

test('the same building changed on both sides keeps this editor’s version and names it', () => {
  const m = merge({ pieces: rename(base.pieces, first.id, 'Mine') }, { pieces: rename(base.pieces, first.id, 'Theirs') });
  assert.equal(m.pieces.find((p) => p.id === first.id)!.name, 'Mine');
  assert.deepEqual(m.conflicts, ['Mine']);
});

test('site settings, waypoints and questions merge too', () => {
  const visiting = { question: 'Boleh bawa anak?', answer: 'Boleh', topic: 'besuk' as const };
  const m = merge(
    { greenery: 2, faq: [...base.faq, visiting] },
    { title: 'RSUD Baru', network: { nodes: [{ id: 'w1', name: 'Musala', x: 1, y: 1 }], edges: [] } },
  );
  assert.equal(m.title, 'RSUD Baru');
  assert.equal(m.greenery, 2);
  assert.equal(m.network.nodes[0].name, 'Musala');
  assert.deepEqual(m.faq.map((e) => e.question), ['Jam besuk?', 'Boleh bawa anak?']);
});

test('a question removed here and one added there', () => {
  const added = { question: 'Ada parkir?', answer: 'Ada', topic: 'fasilitas' as const };
  const m = merge({ faq: [] }, { faq: [...base.faq, added] });
  assert.deepEqual(m.faq.map((e) => e.question), ['Ada parkir?']);
});
