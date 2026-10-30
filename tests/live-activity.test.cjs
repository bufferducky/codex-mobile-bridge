'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const context=vm.createContext({window:{},BridgeI18n:{t:value=>value}});
 vm.runInContext(fs.readFileSync('web/features/chat/timeline.js','utf8'),context);
 const Type=vm.runInContext('ChatActivityStatus',context),label={},elapsed={},events=new Map(),timers=new Map();
 const document={hidden:false,addEventListener:(event,handler)=>events.set(event,handler),removeEventListener:event=>events.delete(event)};
 const node={hidden:true,dataset:{},ownerDocument:document,querySelector:selector=>selector==='[data-activity-label]'?label:elapsed};
 let now=1800000043000,identifier=0;
 const status=new Type(node,{now:()=>now,schedule:fn=>{timers.set(++identifier,fn);return identifier;},cancel:id=>timers.delete(id)});
 const view={status:'active',connected:true,requests:[],currentActivity:{turnId:'turn',kind:'search',target:'java',startedAt:1800000000000}};
 return {status,node,label,elapsed,document,events,timers,view,tick(value){now=value;for(const fn of timers.values())fn();}};
}
test('fillOpenApiShopIntroduction folder search matches the full official caption',()=>{
 const f=fixture();
 f.status.update({...f.view,currentActivity:{kind:'search',target:'supply_mall_server',query:'sync/center/openApi/supplier|pageWithoutTenant',status:'inProgress',actions:[{kind:'search',target:'supply_mall_server',query:'sync/center/openApi/supplier|pageWithoutTenant'}]}});
 assert.equal(f.label.textContent,'正在搜索 supply_mall_server 文件夹中的文件');
});
test('listing, reading and remote command captions follow the official action types',()=>{
 const f=fixture();
 f.status.update({...f.view,currentActivity:{kind:'list',target:'supply_mall_server'}});
 assert.equal(f.label.textContent,'正在列出 supply_mall_server 文件夹中的文件');
 f.status.update({...f.view,currentActivity:{kind:'read',target:'SupplierService.java',status:'completed'}});
 assert.equal(f.label.textContent,'正在读取 SupplierService.java');
 const command='ssh remote-host rg fillOpenApiShopIntroduction supply_mall_server';
 f.status.update({...f.view,currentActivity:{kind:'command',command,status:'inProgress'}});
 assert.equal(f.label.textContent,'正在运行 '+command);
 f.status.update({...f.view,currentActivity:{kind:'command',command,status:'completed'}});
 assert.equal(f.label.textContent,'已运行 '+command);
 f.status.update({...f.view,currentActivity:{kind:'command',command,status:'cancelled'}});
 assert.equal(f.label.textContent,'已停止 '+command);
});
test('live search targets change without adding transcript messages and elapsed time ticks independently',()=>{
 const f=fixture();f.status.update(f.view);assert.equal(f.label.textContent,'正在搜索 java 文件夹中的文件');assert.equal(f.elapsed.textContent,'已处理 43秒');assert.equal(f.timers.size,1);
 f.status.update({...f.view,currentActivity:{...f.view.currentActivity,target:'main'}});assert.equal(f.label.textContent,'正在搜索 main 文件夹中的文件');assert.equal(f.timers.size,1);
 f.tick(1800000063000);assert.equal(f.elapsed.textContent,'已处理 1分3秒');f.status.dispose();assert.equal(f.timers.size,0);
});
test('folder-first captions match the official rule while full parameters remain available',()=>{
 const f=fixture();f.status.update({...f.view,currentActivity:{...f.view.currentActivity,target:'supply',query:'MerchantServiceProductController|editable'}});
 assert.equal(f.label.textContent,'正在搜索 supply 文件夹中的文件');
 assert.ok(f.label.title.includes('MerchantServiceProductController|editable'));
 f.status.update({...f.view,currentActivity:{...f.view.currentActivity,target:'supply',query:'editable|$&|{target}',status:'completed'}});
 assert.equal(f.label.textContent,'正在搜索 supply 文件夹中的文件');
 assert.ok(f.label.title.includes('editable|$&|{target}'));
 f.status.update({...f.view,currentActivity:{kind:'search',query:'pattern'}});
 assert.equal(f.label.textContent,'正在搜索「pattern」');
});
test('the latest compound action drives the caption and all actions remain in its detail text',()=>{
 const f=fixture(),actions=[{kind:'read',target:'A.java'},{kind:'search',target:'supply/src',query:'editable|version'},{kind:'read',target:'C.java'},{kind:'list',target:'supply/src/main'}];
 f.status.update({...f.view,currentActivity:{...f.view.currentActivity,kind:'read',target:'A.java',actions}});
 assert.equal(f.label.textContent,'正在列出 supply/src/main 文件夹中的文件');
 assert.equal(f.label.title,'读取 A.java；搜索 supply/src 中的「editable|version」；读取 C.java；列出 supply/src/main 文件夹中的文件');
 actions[1]={...actions[1],query:'review_status'};
 f.status.update({...f.view,currentActivity:{...f.view.currentActivity,kind:'read',target:'A.java',actions,status:'completed'}});
 assert.equal(f.label.textContent,'正在列出 supply/src/main 文件夹中的文件');
 assert.ok(f.label.title.includes('review_status'));
});
test('tool errors retain the action context and file edits retain every file',()=>{
 const f=fixture();f.status.update({...f.view,currentActivity:{kind:'read',target:'A.java',status:'failed'}});
 assert.equal(f.label.textContent,'正在读取 A.java');
 f.status.update({...f.view,currentActivity:{kind:'edit',actions:[{kind:'edit',target:'src/A.java'},{kind:'edit',target:'src/B.java'}]}});
 assert.equal(f.label.textContent,'正在修改 src/B.java');
 assert.equal(f.label.title,'修改 src/A.java；修改 src/B.java');
});
test('live revisions are requested again immediately without the fixed polling delay',async()=>{
 const context=vm.createContext({window:{},BridgeI18n:{t:value=>value}});vm.runInContext(fs.readFileSync('web/features/chat/timeline.js','utf8'),context);
 const Type=vm.runInContext('ChatTimeline',context),abort=new AbortController(),pauses=[];let reads=0;
 const timeline=Object.assign(Object.create(Type.prototype),{abort,sequence:0,generation:1,windowRevision:0,before:null,epoch:'a',active:()=>true,
  read:async()=>{if(++reads===3)abort.abort();return {sequence:1,rows:[]};},apply(page){this.sequence=page.sequence;},pause:async delay=>pauses.push(delay),status(){}});
 await timeline.updates();assert.equal(reads,3);assert.deepEqual(pauses,[200],'only unchanged responses are throttled');
});
test('native tool information has useful generic fallbacks without guessing an action',()=>{
 const f=fixture();f.status.update({...f.view,currentActivity:{kind:'command'}});assert.equal(f.label.textContent,'正在运行命令');assert.equal(f.elapsed.hidden,true);
 f.status.update({...f.view,currentActivity:null});assert.equal(f.label.textContent,'Codex 正在工作…');assert.equal(f.timers.size,0);
 f.status.update({...f.view,currentActivity:{kind:'thinking'}});assert.equal(f.label.textContent,'正在思考…');
});
test('a fast completed tool shows its latest action instead of falling back to generic thinking',()=>{
 const f=fixture();f.status.update({...f.view,currentActivity:{...f.view.currentActivity,status:'completed'}});
 assert.equal(f.label.textContent,'正在搜索 java 文件夹中的文件');
 f.status.update({...f.view,currentActivity:{...f.view.currentActivity,kind:'read',target:'Controller.java',status:'completed'}});
 assert.equal(f.label.textContent,'正在读取 Controller.java');
});
test('approvals take priority and completed or disconnected tasks stop their timers',()=>{
 const f=fixture();f.status.update({...f.view,requests:[{id:'approval'}]});assert.equal(f.label.textContent,'等待你的确认或回复…');
 f.status.update({...f.view,status:'idle'});assert.equal(f.node.hidden,true);assert.equal(f.timers.size,0);assert.equal(f.elapsed.textContent,'');
 f.status.update(f.view);f.status.update({...f.view,connected:false});assert.equal(f.node.hidden,true);assert.equal(f.timers.size,0);
});
test('invalid or missing start times do not invent elapsed time',()=>{
 for(const startedAt of [undefined,null,NaN,Infinity,-1,'1800000000000',1800000044000]){
  const f=fixture();f.status.update({...f.view,currentActivity:{kind:'read',startedAt}});assert.equal(f.elapsed.hidden,true);assert.equal(f.timers.size,0);
 }
});
test('backgrounding pauses the timer and disposing a chat removes its visibility listener',()=>{
 const f=fixture();f.status.update(f.view);f.document.hidden=true;f.events.get('visibilitychange')();assert.equal(f.timers.size,0);
 f.document.hidden=false;f.events.get('visibilitychange')();assert.equal(f.timers.size,1);
 f.status.dispose();assert.equal(f.timers.size,0);assert.equal(f.events.size,0);assert.equal(f.node.hidden,true);
});
