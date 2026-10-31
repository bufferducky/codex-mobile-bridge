'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/shell/app.js'),'utf8');
const factory=vm.runInNewContext(source.slice(source.indexOf('function createNotificationPresence'),source.indexOf('// Capture once'))+'\ncreateNotificationPresence');
function fixture(){
  let route={id:'chat-a',host:'local'},enabled=true,timer,send=async()=>{};
  const writes=[];
  const presence=factory({read:()=>route,enabled:()=>enabled,newId:()=> 'a'.repeat(32),
    send:async body=>{writes.push({...body});await send();},schedule:fn=>{timer=fn;return fn;},cancel:()=>{timer=null;}});
  return {writes,presence,setRoute:value=>{route=value;},setEnabled:value=>{enabled=value;},setSend:value=>{send=value;},tick:()=>timer?.()};
}
test('foreground heartbeat follows the current chat and clears immediately on background',async()=>{
  const f=fixture();await f.presence.refresh();await f.tick();
  assert.equal(f.writes.length,2);assert.equal(f.writes[0].viewer,f.writes[1].viewer);
  f.setRoute({id:'chat-b',host:'remote'});await f.presence.refresh();
  assert.deepEqual(f.writes.at(-1),{viewer:'a'.repeat(32),thread:'chat-b',host:'remote'});
  f.setEnabled(false);await f.presence.refresh();
  assert.equal(f.writes.at(-1).thread,'');assert.equal(f.writes.at(-1).host,'');
  assert.equal(f.tick(),undefined);
});
test('returning from a file view or list renews the selected chat lease',async()=>{
  const f=fixture();await f.presence.refresh();f.setRoute(null);await f.presence.refresh();
  assert.equal(f.writes.at(-1).thread,'');await f.tick();assert.equal(f.writes.length,2);
  f.setRoute({id:'chat-a',host:'local'});await f.tick();assert.equal(f.writes.at(-1).thread,'chat-a');
});
test('background while a heartbeat is in flight clears after it without overlapping writes',async()=>{
  const f=fixture();let finish;f.setSend(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.presence.refresh();f.setEnabled(false);await f.presence.refresh();assert.equal(f.writes.length,1);
  f.setSend(async()=>{});finish();await pending;await new Promise(setImmediate);
  assert.equal(f.writes.length,2);assert.equal(f.writes[1].thread,'');
});
test('failed foreground writes retry on the next heartbeat and ordinary browsers send nothing',async()=>{
  const f=fixture();f.setSend(async()=>{throw Error('offline');});await f.presence.refresh();
  f.setSend(async()=>{});await f.tick();assert.equal(f.writes.length,2);
  const browser=fixture();browser.setEnabled(false);await browser.presence.refresh();assert.equal(browser.writes.length,0);
});
test('completion receipts only accompany a currently visible chat, never its background clear',async()=>{
  const f=fixture();f.setRoute({id:'chat-a',host:'local',completed:['rendered-turn']});
  await f.presence.refresh();assert.deepEqual(f.writes[0].completed,['rendered-turn']);
  f.setEnabled(false);await f.presence.refresh();
  assert.equal(f.writes[1].thread,'');assert.equal(f.writes[1].completed,undefined);
});
