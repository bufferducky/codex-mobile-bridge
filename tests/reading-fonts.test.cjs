'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Library,MAX_BYTES,validate}=require('../web/features/settings/fonts.js');
const buffer=()=>Uint8Array.from([0,1,0,0,0,0,0,0,0,0,0,0]).buffer;
function fixture(Font=class{constructor(family){this.family=family;}async load(){return this;}}){
 const records=new Map(),faces=new Set(),store={read:async key=>records.get(key),write:async(key,value)=>records.set(key,value),remove:async key=>records.delete(key)};
 const library=new Library({store,Font,fonts:faces});return {library,records,faces,store,Font};
}
const file=(name='font.ttf')=>({name,size:12,arrayBuffer:async()=>buffer()});
test('rejects HTML, incomplete and oversized input before parsing fonts',()=>{
 for(const data of [new ArrayBuffer(0),new ArrayBuffer(MAX_BYTES+1),new TextEncoder().encode('<html>bad-font</html>').buffer])assert.throws(()=>validate(data));
 assert.equal(validate(buffer()).byteLength,12);
});
test('body and code fonts restore independently after creating a new library',async()=>{
 const f=fixture();await f.library.import('body',file('body.ttf'));await f.library.import('code',file('code.otf'));
 const next=new Library({store:f.store,Font:f.Font,fonts:new Set()});assert.equal((await next.restore('body')).name,'body.ttf');assert.equal((await next.restore('code')).family,'BridgeCustomCode');
});
test('invalid replacement keeps the installed font and saved bytes',async()=>{
 const f=fixture();await f.library.import('body',file('good.ttf'));const face=[...f.faces][0];
 await assert.rejects(f.library.import('body',{size:14,name:'bad.ttf',arrayBuffer:async()=>new ArrayBuffer(14)}));
 assert.equal(f.records.get('body').name,'good.ttf');assert.ok(f.faces.has(face));
});
test('storage failure does not claim that the imported font was saved or replace the active font',async()=>{
 const f=fixture();await f.library.import('body',file('saved.ttf'));const face=[...f.faces][0];f.store.write=async()=>{throw Error('quota');};
 await assert.rejects(f.library.import('body',file('new.ttf')),/quota/);assert.equal(f.faces.size,1);assert.ok(f.faces.has(face));
});
test('deleting while parsing prevents late completion from restoring a removed font',async()=>{
 let finish;const f=fixture(class{constructor(family){this.family=family;}load(){return new Promise(resolve=>{finish=()=>resolve(this);});}});
 const pending=f.library.import('body',file());await new Promise(resolve=>setImmediate(resolve));await f.library.remove('body');finish();assert.equal(await pending,null);assert.equal(f.records.size,0);assert.equal(f.faces.size,0);
});
