'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/features/workspace/side-chat.js'),'utf8');

test('side chat creation requests full access only for Android and keeps retry identity',async()=>{
 for(const kind of ['android','ios','browser']){
  const context=vm.createContext({BridgeHost:{kind:()=>kind},BridgeI18n:{t:v=>v}});
  vm.runInContext(source,context);const Panel=vm.runInContext('SideChatPanel',context),calls=[];
  const panel=Object.assign(Object.create(Panel.prototype),{creationId:'same-attempt',status:{},controls(){},apply(){},async request(body){calls.push(JSON.parse(JSON.stringify(body)));return {};}});
  await panel.create();await panel.create();
  assert.equal(calls[0].permissionMode,kind==='android'?'full-access':undefined);
  assert.deepEqual(calls[0],calls[1]);assert.equal(panel.busy,false);
 }
});
