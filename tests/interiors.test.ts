import {test} from 'node:test';
import assert from 'node:assert/strict';
import {corridorDoors,fitsRoom} from '../src/lib/model/interiors.ts';
import type {Piece} from '../src/lib/model/layout.ts';
const b:Piece={id:1,name:'Building',kind:'flat',x:4,y:4,w:5,h:4,color:'#ffffff',rotation:0};
const corridor:Piece={...b,id:2,name:'Corridor',kind:'straight',x:9,y:5,w:4,h:1};
test('touching corridor creates a door and moving away removes it',()=>{assert.equal(corridorDoors(b,[corridor])[0].side,'east');assert.equal(corridorDoors(b,[{...corridor,x:10}]).length,0)});
test('multiple connected sides produce multiple doors',()=>{assert.equal(corridorDoors(b,[corridor,{...corridor,id:3,x:5,y:8}]).length,2)});
test('corner-only contact does not create a door',()=>{assert.equal(corridorDoors(b,[{...corridor,y:8}]).length,0)});
test('room placement rejects overlapping rooms',()=>{const r={id:1,name:'Room',type:'exam' as const,x:0,y:0,w:2,h:2};assert.equal(fitsRoom(b,{...r,id:2},[r]),false);assert.equal(fitsRoom(b,{...r,id:2,x:2},[r]),true)});

test('custom room dimensions must be positive whole tiles inside the building',()=>{
 const r={id:1,name:'Custom office',type:'office' as const,x:0,y:0,w:3,h:1};
 assert.equal(fitsRoom(b,r),true);
 for(const w of [0,-1,1.5,NaN,Infinity,6])assert.equal(fitsRoom(b,{...r,w}),false);
 assert.equal(fitsRoom(b,{...r,x:3}),false);
});
test('resizing a room ignores itself but rejects its neighbours',()=>{
 const r={id:1,name:'Room',type:'exam' as const,x:0,y:0,w:2,h:2};
 const neighbour={...r,id:2,x:3};
 assert.equal(fitsRoom(b,{...r,w:3},[r,neighbour]),true);
 assert.equal(fitsRoom(b,{...r,w:4},[r,neighbour]),false);
});
