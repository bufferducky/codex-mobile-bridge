'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/shell/app.js','utf8');
const enter=source.slice(source.indexOf('async function enter(authInfo)'),source.indexOf("$('login-form').addEventListener"));
function fixture(){
  const nodes=new Map(),opened=[];let finish;
  const clientsReady=new Promise(resolve=>finish=resolve);
  const context=vm.createContext({
    $:id=>{if(!nodes.has(id))nodes.set(id,{hidden:false});return nodes.get(id);},
    desktopSessions:{onListEnter(){},bindDraftGateway(){},bindListCache(){},previewCachedList(){return false;}},
    clientNavigation:{provider:'codex',chatLinkRevision:0,refresh:()=>clientsReady,async openChatLink(hash){this.chatLinkRevision++;opened.push(hash);}},
    location:{hash:'#initial',host:'gateway.example',origin:'https://gateway.example',search:''},
    draftGateway:'',sessionPins:{bind(){}},listIdentity:'',listAuthIdentity:()=> 'identity',restoreListSnapshot(){},refreshComputer(){},
    window:{},document:{dispatchEvent(){}},Event:class{},accountsPanel:null,isCodexClient:()=>false,
    browserNavigation:{paused:true},history:{state:null},openChat(){},
  });
  vm.runInContext(enter,context);
  return {context,opened,finish,start:()=>context.enter({authenticated:true}),async newer(){await context.clientNavigation.openChatLink('#latest');}};
}
test('startup cannot replay its initial notification over a newer notification handled during discovery',async()=>{
  const f=fixture(),starting=f.start();await Promise.resolve();await Promise.resolve();
  await f.newer();f.finish();await starting;assert.deepEqual(f.opened,['#latest']);
});
test('startup still routes its original notification when no newer link arrived',async()=>{
  const f=fixture(),starting=f.start();f.finish();await starting;assert.deepEqual(f.opened,['#initial']);
});
