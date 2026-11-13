'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/shell/app.js','utf8');
function fixture(){
 let calls=0,handler=async()=>({sessions:[{id:'fresh',host:'local',recency:2}],complete:true,remoteHosts:[],availableSources:['desktop']});
 const nodes={search:{value:''},archived:{checked:false},'list-mode':{value:'recent'},sessions:{scrollTop:0,children:[{}],style:{setProperty(){}},classList:{toggle(){}},addEventListener(){}},'list-sync':{hidden:true,textContent:'',style:{setProperty(){}},classList:{add(){},remove(){}}}};
 const timers=new Map();let serial=0;const rendered=[];
 const context=vm.createContext({AbortController,Date,BridgeI18n:{t:x=>x},document:{hidden:false,addEventListener(){}},window:{addEventListener(){}},setTimeout:(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;},clearTimeout:id=>timers.delete(id),requestAnimationFrame(){},cancelAnimationFrame(){},$:(id)=>nodes[id],listLoading:0,listHasMore:true,listGeneration:0,listOffset:0,sessionPins:{capture:()=>({}),observe(){},pending:()=>false},listSource:'all',listFilterKey:JSON.stringify(['',false,'all','recent']),listRows:[{id:'saved',host:'local',recency:1}],listHostIds:[],availableSources:[],recentInteractions:new Map(),pinRow:r=>r,chatKey:(id,host)=>host+'|'+id,t:x=>x,renderList(){},renderHostErrors:errors=>rendered.push(errors),refreshActivity(){},saveListSnapshot(){},restoreListSnapshot:()=>false,renderSourceFilter:()=>true,clientNavigation:{acknowledgeList(){}},api:async(...args)=>{calls++;return handler(...args);}});
 vm.runInContext(fs.readFileSync('web/features/chat/list-sync.js','utf8'),context);
 vm.runInContext("const listSync=new ListSync({root:$('sessions'),status:$('list-sync'),refresh:()=>loadList(true),visible:()=>true,ready:()=>true});",context);
 vm.runInContext(source.slice(source.indexOf('async function loadList(reset=false){'),source.indexOf('function loadMoreSessions()')),context);
 return {context,nodes,rendered,timers,get calls(){return calls;},sync:vm.runInContext('listSync',context),read:()=>context.loadList(true),respond:fn=>{handler=fn;}};
}
test('one actual list transport failure retains saved chats without a raw host error or rejected UI request',async()=>{
 const ui=fixture();ui.respond(async()=>{throw TypeError('Failed to fetch');});
 assert.equal(await ui.read(),false);assert.equal(ui.context.listRows[0].id,'saved');assert.equal(ui.nodes['list-sync'].hidden,true);
 assert.ok(ui.rendered.every(errors=>!errors.some(row=>row.error==='Failed to fetch')));assert.equal(ui.sync.automaticFailures,1);
 assert.ok([...ui.timers.values()].some(timer=>timer.delay===1000));
 ui.respond(async()=>({sessions:[{id:'fresh',host:'local',recency:2}],complete:true,remoteHosts:[],availableSources:['desktop']}));
 await ui.read();assert.equal(ui.context.listRows[0].id,'fresh');assert.equal(ui.sync.automaticFailures,0);
});
test('concurrent refresh entry points share the actual host request',async()=>{
 const ui=fixture();let finish;ui.respond(()=>new Promise(resolve=>finish=resolve));
 const first=ui.read(),second=ui.read();assert.equal(ui.calls,1);
 finish({sessions:[],complete:true,remoteHosts:[],availableSources:[]});await Promise.all([first,second]);assert.equal(ui.context.listGeneration,1);
});
test('a new search cancels superseded reads without counting an intentional abort as a connection failure',async()=>{
 const ui=fixture();let oldSignal;ui.respond((_path,_body,signal)=>new Promise((_resolve,reject)=>{oldSignal=signal;signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})));}));
 const stale=ui.read();ui.nodes.search.value='new query';ui.respond(async()=>({sessions:[],complete:true,remoteHosts:[],availableSources:[]}));
 await ui.read();await stale;assert.equal(oldSignal.aborted,true);assert.equal(ui.sync.automaticFailures,0);
});
test('sustained list failures offer a Chinese retry hint and clear on authoritative recovery',async()=>{
 const ui=fixture();ui.respond(async()=>{throw TypeError('Failed to fetch');});
 await ui.read();await ui.read();await ui.read();assert.equal(ui.nodes['list-sync'].hidden,false);assert.match(ui.nodes['list-sync'].textContent,/连接暂时不稳定/);assert.doesNotMatch(ui.nodes['list-sync'].textContent,/Failed to fetch|local:/);
 ui.respond(async()=>({sessions:[],complete:true,remoteHosts:[],availableSources:[]}));await ui.read();assert.equal(ui.sync.failureVisible,false);
});


test('an explicit refresh reports its failure immediately through the same coordinator',async()=>{
 const ui=fixture();ui.respond(async()=>{throw TypeError('Failed to fetch');});await ui.sync.update(true);
 assert.equal(ui.sync.automaticFailures,1);assert.equal(ui.sync.failureVisible,true);assert.match(ui.nodes['list-sync'].textContent,/点击重试/);
});

test('incomplete host reads keep old rows and cannot acknowledge a successful refresh',async()=>{
 const ui=fixture();ui.respond(async()=>({sessions:[],complete:false,unavailableHosts:[],remoteHosts:[]}));
 assert.equal(await ui.read(),false);assert.equal(ui.context.listRows[0].id,'saved');assert.equal(ui.sync.lastSuccess,0);assert.equal(ui.sync.automaticFailures,1);
});
