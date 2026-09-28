import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyNetwork, walkable, type WalkingNetwork } from '../src/lib/wayfinding/navigation.ts';
import { parseLayout, type Piece } from '../src/lib/model/layout.ts';
const p=(x:number,y:number)=>({x,y});
const network=(...names:string[]):WalkingNetwork=>({nodes:names.map((name,i)=>({id:'n'+i,name,x:1+i*2,y:1})),edges:names.length>1?[{from:'n0',to:'n1'}]:[]});
const building:Piece={id:1,name:'Reception',kind:'flat',x:4,y:4,w:4,h:4,rotation:0,color:'#ffffff'};
test('building walls block paths while actual entrances allow travel',()=>{
 assert.equal(walkable(p(3,6),p(9,6),[building]),false);
 assert.equal(walkable(p(6,3),p(6,6),[building]),true);
 assert.equal(walkable(p(5,3),p(5,6),[building]),false);
 const changed={...building,entrances:[{side:'west' as const,offset:2,width:.8}]};
 assert.equal(walkable(p(3,6),p(6,6),[changed]),true);
 assert.equal(walkable(p(6,3),p(6,6),[changed]),false);
});
test('room partitions allow only the south doorway by default',()=>{
 const b={...building,roomAssets:[{id:1,name:'Exam',type:'exam' as const,x:1,y:1,w:2,h:2}]};
 assert.equal(walkable(p(6,7.5),p(6,6.5),[b]),true);
 assert.equal(walkable(p(4.5,6),p(6,6),[b]),false);
});
test('a room door can face any wall',()=>{
 const b={...building,roomAssets:[{id:1,name:'Exam',type:'exam' as const,x:1,y:1,w:2,h:2,door:'west' as const}]};
 assert.equal(walkable(p(4.5,6),p(6,6),[b]),true);
 assert.equal(walkable(p(6,7.5),p(6,6.5),[b]),false);
});
test('landmarks persist, old layouts default to an empty network',()=>{
 const n=network('','Reception');
 assert.deepEqual(parseLayout(JSON.stringify({pieces:[],network:n})).network,n);
 assert.deepEqual(parseLayout(JSON.stringify({pieces:[]})).network,emptyNetwork());
});
test('invalid bounds, nonfinite coordinates, duplicate ids and dangling edges are rejected',()=>{
 const n=network('A','B');
 for(const network of [{...n,nodes:[{...n.nodes[0],x:25},n.nodes[1]]},{...n,nodes:[{...n.nodes[0],x:null},n.nodes[1]]},{...n,nodes:[n.nodes[0],n.nodes[0]]},{...n,edges:[{from:n.nodes[0].id,to:'missing'}]},null])assert.throws(()=>parseLayout(JSON.stringify({pieces:[],network})));
});
