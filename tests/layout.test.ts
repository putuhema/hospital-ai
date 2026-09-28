import { test } from 'node:test';
import assert from 'node:assert/strict';
import {assets,parseLayout,pieceFrom,starterPieces} from '../src/lib/model/layout.ts';

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
