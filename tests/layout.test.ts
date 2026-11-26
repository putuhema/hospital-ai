import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { assets, parseLayout, pieceFrom, starterPieces } from '../src/lib/model/layout.ts';
import { fitsRoom, isBuilding, overlaps } from '../src/lib/model/interiors.ts';
import { buildGrid, places, unreachable } from '../src/lib/wayfinding/routing.ts';

test('older saved layouts retain their original grid',()=>{
 const result=parseLayout(JSON.stringify({title:'Legacy',pieces:starterPieces}));
 assert.deepEqual(result.grid,{width:24,height:20,tileMeters:2});
});
test('enlarged canvas supports objects past the original bounds',()=>{
 const pieces=[{...starterPieces[0],x:27,y:23}];
 const result=parseLayout(JSON.stringify({pieces,grid:{width:32,height:28}}));
 assert.equal(result.pieces[0].x,27);
 assert.equal(result.grid.width,32);
});
test('rejects a canvas that clips an existing building',()=>{
 assert.throws(()=>parseLayout(JSON.stringify({pieces:starterPieces,grid:{width:8,height:8}})));
});
test('rejects fractional and excessive canvas sizes',()=>{
 for(const width of [8.5,101,0])assert.throws(()=>parseLayout(JSON.stringify({pieces:[],grid:{width,height:20}})));
});

test('room names survive a saved layout round trip',()=>{
 const pieces=[{...starterPieces[0],rooms:['Examination room','Storage']}];
 assert.deepEqual(parseLayout(JSON.stringify({pieces})).pieces[0].rooms,pieces[0].rooms);
});
test('legacy building types migrate while keeping dimensions and room names',()=>{
 const piece={...starterPieces[0],kind:'ward',rooms:['Ward A']};
 const loaded=parseLayout(JSON.stringify({pieces:[piece]})).pieces[0];
 assert.equal(loaded.kind,'pitched');assert.equal(loaded.w,piece.w);assert.deepEqual(loaded.rooms,['Ward A']);
});
test('invalid room data is rejected',()=>{
 assert.throws(()=>parseLayout(JSON.stringify({pieces:[{...starterPieces[0],rooms:[42]}]})));
});

test('interior room assets persist and must fit inside their building',()=>{
 const room={id:1,name:'Patient room',type:'patient',x:0,y:0,w:2,h:2};
 const good={...starterPieces[0],roomAssets:[room]};
 assert.equal(parseLayout(JSON.stringify({pieces:[good]})).pieces[0].roomAssets?.length,1);
 assert.throws(()=>parseLayout(JSON.stringify({pieces:[{...good,roomAssets:[{...room,x:99}]}]})));
});
test('appearance and room door settings persist and are validated',()=>{
 const b={...starterPieces[0],roofColor:'#b0564a',floors:3,roomAssets:[{id:1,name:'Lab',type:'lab',x:0,y:0,w:2,h:2,door:'east',color:'#abcdef'}]};
 const result=parseLayout(JSON.stringify({pieces:[b]}));
 assert.equal(result.pieces[0].floors,3);
 assert.equal(result.pieces[0].roomAssets?.[0].door,'east');
 for(const bad of [{floors:5},{floors:1.5},{roofColor:'red'}])assert.throws(()=>parseLayout(JSON.stringify({pieces:[{...b,...bad}]})));
 for(const room of [{door:'up'},{type:'spa'},{color:'#fff'}])assert.throws(()=>parseLayout(JSON.stringify({pieces:[{...b,roomAssets:[{...b.roomAssets[0],...room}]}]})));
});
test('the starter layout is valid and every template fits its building',()=>{
 assert.equal(parseLayout(JSON.stringify({pieces:starterPieces})).pieces.length,starterPieces.length);
 for(const a of assets.filter(a=>a.roomAssets))parseLayout(JSON.stringify({pieces:[pieceFrom(a,{id:1,x:0,y:0})]}));
});

test('PHTC building and 3-storey templates validate, stay rectangular, and have reachable rooms', () => {
  const phtcAsset = assets.find((a) => a.kind === 'phtc' && a.group === 'Buildings');
  const phtcTemplate = assets.find((a) => a.kind === 'phtc' && a.group === 'Templates');
  const wing3f = assets.find((a) => a.name === 'Large 3-storey wing');
  assert.ok(phtcAsset && phtcTemplate && wing3f);
  assert.equal(phtcAsset.floors, 3);
  assert.equal(phtcTemplate.floors, 3);
  assert.equal(wing3f.floors, 3);

  for (const tpl of [phtcTemplate, wing3f]) {
    const p = pieceFrom(tpl, { id: 100, x: 2, y: 2 });
    assert.ok(isBuilding(p));
    assert.ok(p.roomAssets?.some((r) => r.type === 'stairs'), `${tpl.name} includes stairs & lift`);
    for (const r of p.roomAssets ?? []) assert.ok(fitsRoom(p, r, p.roomAssets), `${tpl.name}: ${r.name}`);
    const g = buildGrid([p], 24, 20);
    assert.deepEqual(unreachable(g, places([p])), [], `${tpl.name} rooms are all reachable`);
  }

  // PHTC survives save/load, and rejects L-shape since PHTC is rectangular.
  const phtcPiece = pieceFrom(phtcAsset, { id: 1, x: 1, y: 1 });
  assert.equal(parseLayout(JSON.stringify({ pieces: [phtcPiece] })).pieces[0].kind, 'phtc');
  assert.throws(() => parseLayout(JSON.stringify({ pieces: [{ ...phtcPiece, shape: 'L' }] })));
});

test('starter campus showcases 3-storey green wing and PHTC building without overlaps', () => {
  assert.ok(starterPieces.some((p) => p.kind === 'phtc' && p.floors === 3 && p.roomAssets?.some((r) => r.type === 'stairs')));
  assert.ok(starterPieces.some((p) => p.kind === 'flat' && p.floors === 3 && p.roomAssets?.some((r) => r.type === 'stairs')));
  for (let i = 0; i < starterPieces.length; i++) {
    for (let j = i + 1; j < starterPieces.length; j++) {
      assert.equal(overlaps(starterPieces[i], starterPieces[j]), false, `${starterPieces[i].name} overlaps ${starterPieces[j].name}`);
    }
  }
});

test('every asset library thumbnail file exists under static/', () => {
  for (const a of assets) {
    const rel = a.image ?? `/models/${a.kind}.png`;
    assert.ok(existsSync(`static${rel}`), `missing thumbnail static${rel} for ${a.name}`);
  }
});
