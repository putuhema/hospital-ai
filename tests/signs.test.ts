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

test('a scanned sign gives its spot; another map or another code is told apart', async () => {
  const { readSign } = await import('../src/lib/signs.ts');
  assert.deepEqual(readSign('https://pmap.example/m/abc?from=r:2:25', 'abc'), { from: 'r:2:25' });
  assert.deepEqual(readSign('https://pmap.example/m/abc?from=n%3Aw1', undefined), { from: 'n:w1' });
  assert.deepEqual(readSign('https://pmap.example/m/xyz?from=b:9', 'abc'), { error: 'other-map' });
  assert.deepEqual(readSign('https://example.com/promo', 'abc'), { error: 'not-a-sign' });
  assert.deepEqual(readSign('WIFI:S:RSUD;;', 'abc'), { error: 'not-a-sign' });
});

test("a printed sign's QR code reads back to its spot with the in-page decoder (iPhones)", async () => {
  const { encode } = await import('uqr');
  const { default: jsQR } = await import('jsqr');
  const { readSign } = await import('../src/lib/signs.ts');
  const place = places(starterPieces).find((p) => p.kind === 'room')!;
  const qr = encode(signLink('https://pmap.example/m/abc', place));
  // Drawn as a camera would see it: 6 px a module, a white margin round it.
  const scale = 6, margin = 4, size = (qr.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.data[y][x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
  const read = jsQR(pixels, size, size);
  assert.ok(read, 'decoded');
  assert.deepEqual(readSign(read!.data, 'abc'), { from: place.id });
});
