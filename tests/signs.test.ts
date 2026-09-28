import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signLink, signablePlaces, suggestedSpots } from '../src/lib/signs.ts';
import { places } from '../src/lib/wayfinding/routing.ts';
import { starterPieces, type Piece } from '../src/lib/model/layout.ts';
test('a sign opens the published map with its spot as the start',()=>{
 const [reception]=places(starterPieces).filter(p=>p.id==='b:9');
 assert.equal(signLink('https://example.org/m/abc',reception),'https://example.org/m/abc?from=b:9');
 const landmark={id:'n:main door&1',name:'Main door',kind:'landmark' as const,detail:'Landmark',point:{x:1,y:1}};
 assert.equal(new URL(signLink('https://example.org/m/abc',landmark)).searchParams.get('from'),'n:main door&1');
});
test('signs are suggested at landmarks, receptions and stairs',()=>{
 const list=places(starterPieces,{nodes:[{id:'e1',name:'East entrance',x:1,y:1}],edges:[]});
 const names=suggestedSpots(list).map(p=>p.name);
 assert.ok(names.includes('East entrance'));
 assert.ok(names.includes('Reception desk'));
 assert.ok(!names.includes('Pharmacy'));
});
test('without landmarks or arrival rooms, every building gets a sign',()=>{
 const bare:Piece[]=starterPieces.map(p=>({...p,roomAssets:[]}));
 const spots=suggestedSpots(places(bare));
 assert.ok(spots.length>0&&spots.every(p=>p.kind==='building'));
});
test('listed rooms cannot carry a sign',()=>{
 const withListed=starterPieces.map(p=>p.id===9?{...p,rooms:['MRI suite']}:p);
 assert.ok(!signablePlaces(places(withListed)).some(p=>p.kind==='listed'));
});
