import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {apply,LiveAssistantPreview} from '../bridge/clients/deepseek/host.mjs';

function streamFixture(options={}){
  const preview=new LiveAssistantPreview(options),agent={session:{id:'fixture'},status:'running'};
  let revision=0,index=0;
  const start=(extra={})=>{index=0;preview.accept({agent,frame:{type:'start',attemptId:'attempt',revision:++revision,turn:2,step:1,...extra}});};
  const chunk=(value,extra={})=>preview.accept({agent,frame:{type:'chunk',attemptId:'attempt',revision:++revision,index:index++,time:1200,chunk:value,...extra}});
  const end=(outcome,extra={})=>preview.accept({agent,frame:{type:'end',attemptId:'attempt',revision:++revision,index,outcome,...extra}});
  const read=(extra={})=>preview.snapshot('fixture',{running:true,asOfSeq:3,agent,...extra});
  return {preview,agent,start,chunk,end,read};
}

test('preview assembles only public text and reasoning with authoritative block endings',()=>{
  const f=streamFixture();f.start();
  f.chunk({type:'reasoning-delta',index:0,text:'检查依据'});
  f.chunk({type:'text-delta',index:1,text:'准备回答'});
  const first=f.read();
  assert.deepEqual(first.liveMessages.map(row=>[row.role,row.text]),[['reasoning','检查依据'],['assistant','准备回答']]);
  assert.equal(first.liveActivity.kind,'replying');assert.equal(first.liveActivity.startedAt,undefined);
  f.chunk({type:'block-end',index:1,block:{type:'text',text:'完整回答'}});
  f.chunk({type:'text-delta',index:1,text:'closed straggler'});
  f.chunk({type:'usage',usage:{PRIVATE:'secret'}});
  f.chunk({type:'tool-call-delta',index:2,id:'call',name:'shell',argumentsDelta:'PRIVATE secret args'});
  const next=f.read();
  assert.equal(next.liveMessages[1].text,'完整回答');
  assert.equal(next.liveMessages[1].id,first.liveMessages[1].id);
  assert.equal(JSON.stringify(next).includes('PRIVATE'),false);
  assert.equal(next.liveActivity.kind,'thinking');
});

for(const [name,extra] of [['revision gap',{revision:4}],['chunk index gap',{index:2}],['wrong attempt',{attemptId:'another'}]]){
  test(`preview drops an attempt after ${name} and waits for a fresh start`,()=>{
    const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'before'});
    f.chunk({type:'text-delta',index:0,text:'missing'},extra);
    assert.deepEqual(f.read().liveMessages,[]);
    f.chunk({type:'text-delta',index:0,text:'orphan'});assert.deepEqual(f.read().liveMessages,[]);
    f.start({attemptId:'new-attempt',revision:10});
    f.preview.accept({agent:f.agent,frame:{type:'chunk',attemptId:'new-attempt',revision:11,index:0,time:1400,chunk:{type:'text-delta',index:0,text:'fresh'}}});
    assert.equal(f.read().liveMessages[0].text,'fresh');
  });
}

test('preview clears abandoned, non-message and malformed settlements',()=>{
  for(const outcome of [{kind:'abandoned'},{kind:'committed',eventType:'assistant/attempt',seq:4},{kind:'committed',eventType:'assistant/message',seq:-1}]){
    const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'temporary'});f.end(outcome);
    assert.deepEqual(f.read().liveMessages,[]);
  }
  const f=streamFixture();f.start();f.chunk({type:'finish',reason:{kind:'error'}});assert.deepEqual(f.read().liveMessages,[]);
});

test('preview retains final text only until the exact durable page cut catches up',()=>{
  const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'durable soon'});
  f.end({kind:'committed',eventType:'assistant/message',seq:4});
  assert.equal(f.read().liveMessages[0].text,'durable soon');assert.equal(f.read().liveActivity,undefined);
  assert.deepEqual(f.read({asOfSeq:4}).liveMessages,[]);
});

test('preview is isolated by native agent identity and disposal',()=>{
  const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'one'});
  const other={session:{id:'other'},status:'running'};
  f.preview.accept({agent:other,frame:{type:'start',attemptId:'other-attempt',revision:1,turn:2,step:1}});
  f.preview.accept({agent:other,frame:{type:'chunk',attemptId:'other-attempt',revision:2,index:0,time:1200,chunk:{type:'text-delta',index:0,text:'two'}}});
  assert.equal(f.read().liveMessages[0].text,'one');
  assert.equal(f.preview.snapshot('other',{running:true,asOfSeq:3,agent:other}).liveMessages[0].text,'two');
  f.preview.disposeAgent({session:{id:'fixture'}});assert.equal(f.read().liveMessages[0].text,'one');
  assert.deepEqual(f.read({agent:{session:f.agent.session}}).liveMessages,[]);
  f.preview.disposeAgent(other);assert.deepEqual(f.preview.snapshot('other',{running:true,asOfSeq:3,agent:other}).liveMessages,[]);
});

test('preview bounds UTF-8 bytes, block count, sessions and fiber lifetime',()=>{
  const bytes=streamFixture({maxBytes:8});bytes.start();bytes.chunk({type:'text-delta',index:0,text:'中文汉'});
  assert.deepEqual(bytes.read().liveMessages,[],'Byte limit must count UTF-8 bytes');
  const blocks=streamFixture({maxBlocks:1});blocks.start();blocks.chunk({type:'text-delta',index:0,text:'one'});blocks.chunk({type:'text-delta',index:1,text:'two'});
  assert.deepEqual(blocks.read().liveMessages,[]);
  const sessions=new LiveAssistantPreview({maxSessions:2}),agents=[];
  for(let i=0;i<3;i++){
    const agent={session:{id:String(i)}};agents.push(agent);
    sessions.accept({agent,frame:{type:'start',attemptId:String(i),revision:1,turn:1,step:1}});
    sessions.accept({agent,frame:{type:'chunk',attemptId:String(i),revision:2,index:0,time:1200,chunk:{type:'text-delta',index:0,text:String(i)}}});
  }
  assert.deepEqual(sessions.snapshot('0',{running:true,asOfSeq:3,agent:agents[0]}).liveMessages,[]);
  assert.equal(sessions.snapshot('2',{running:true,asOfSeq:3,agent:agents[2]}).liveMessages[0].text,'2');
  sessions.dispose();
  sessions.accept({agent:agents[2],frame:{type:'start',attemptId:'after-dispose',revision:1,turn:1,step:1}});
  assert.deepEqual(sessions.snapshot('2',{running:true,asOfSeq:3,agent:agents[2]}).liveMessages,[]);
});

test('preview uses only native turn-start time and clears on idle',()=>{
  const f=streamFixture();
  f.preview.sessionEvent(f.agent.session,{type:'turn/start',time:1000,data:{turn:2}});
  f.start();f.chunk({type:'text-delta',index:0,text:'reply'});
  assert.equal(f.read().liveActivity.startedAt,1000);
  assert.deepEqual(f.read({running:false}).liveMessages,[]);
  assert.equal(f.read().liveActivity,undefined);
});

test('native next-turn and turn-end events immediately retire the preceding preview',()=>{
  for(const event of [
    {type:'turn/start',seq:5,time:2000,data:{turn:3}},
    {type:'turn/end',seq:5,time:2000,data:{turn:2,reason:{kind:'completed'}}}
  ]){
    const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'old preview'});
    f.preview.sessionEvent(f.agent.session,event);assert.deepEqual(f.read().liveMessages,[]);
  }
});

test('durable completion or a later native step cannot retain a stale live preview',()=>{
  for(const event of [
    {type:'turn/end',seq:5,time:2000,data:{turn:2,reason:{kind:'completed'}}},
    {type:'turn/start',seq:5,time:2000,data:{turn:3}},
    {type:'tool/call',seq:5,time:2000,data:{turn:2,step:2,callId:'next-tool',name:'bash',arguments:'{}'}},
    {type:'assistant/message',seq:5,time:2000,data:{turn:2,step:1,message:{content:[]}}},
    {type:'tool/call',seq:5,time:2000,data:{turn:2,step:1,callId:'current-tool',name:'bash',arguments:'{}'}}
  ]){
    const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'stale preview'});
    assert.deepEqual(f.read({asOfSeq:5,records:[{event}]}).liveMessages,[]);
  }
  const f=streamFixture();f.start();f.chunk({type:'text-delta',index:0,text:'current preview'});
  assert.equal(f.read({records:[{event:{type:'tool/call',seq:3,time:900,data:{turn:1,step:3}}}]}).liveMessages[0].text,'current preview','An older page read cannot retire a newer native turn');
});

test('Harness detail shows native streaming text without following or activating a session',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cmb-live-'));
  const endpoint=join(directory,'endpoint.json'),configPath=join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({token:'synthetic-live-token',endpoint}));
  const handlers=new Map(),disposers=[],agent={session:{id:'synthetic-session'},status:'running'};
  let sequence=3,beforePage=()=>{};
  const rows=[{sessionId:agent.session.id,running:true,projections:{asOfSeq:sequence,values:{}}}];
  const ctx={
    sessionController:{
      list:async()=>({items:rows}),projections:async()=>({asOfSeq:sequence}),
      page:async()=>{beforePage();return {records:[{event:{type:'turn/start',seq:1,time:1000,data:{turn:1}}}],hasMore:false};},
      follow:()=>{throw Error('A passive preview must not follow or activate a session');},
      create:()=>{throw Error('A passive preview must not create or resume a session');}
    },
    permissionPresets:{catalog:()=>({defaultPreset:'default',options:[]})},
    workspaceRegistry:{},agents:{get:sid=>sid===agent.session.id?agent:undefined},
    on:(name,handler)=>{handlers.set(name,handler);return()=>handlers.delete(name);},
    effect:setup=>{disposers.push(setup());}
  };
  const emit=(name,payload,...rest)=>handlers.get(name)?.(payload,...rest);
  let request;
  try{
    await apply(ctx,{configPath});
    const {port}=JSON.parse(await readFile(endpoint,'utf8'));
    request=async(body={})=>{
      const response=await fetch(`http://127.0.0.1:${port}/mobile`,{method:'POST',headers:{Authorization:'Bearer synthetic-live-token','Content-Type':'application/json'},body:JSON.stringify({action:'detail',sid:agent.session.id,body})});
      assert.equal(response.status,200);return response.json();
    };
    emit('session/event',agent.session,{type:'turn/start',seq:1,time:1000,data:{turn:1}});
    emit('agent/assistant-stream',{agent,frame:{type:'start',attemptId:'synthetic-attempt',revision:1,turn:1,step:1}});
    emit('agent/assistant-stream',{agent,frame:{type:'chunk',attemptId:'synthetic-attempt',revision:2,index:0,time:1100,chunk:{type:'text-delta',index:0,text:'正在检查'}}});
    const first=await request();
    assert.equal(first.liveMessages?.[0]?.text,'正在检查','Native streaming text must be visible before the assistant message is durable');
    assert.equal(first.liveMessages[0].streaming,true);
    assert.equal(first.liveActivity.kind,'replying');assert.equal(first.liveActivity.startedAt,1000);
    emit('agent/assistant-stream',{agent,frame:{type:'chunk',attemptId:'synthetic-attempt',revision:3,index:1,time:1200,chunk:{type:'text-delta',index:0,text:'布局。'}}});
    const second=await request();
    assert.equal(second.liveMessages[0].id,first.liveMessages[0].id);
    assert.equal(second.liveMessages[0].text,'正在检查布局。');
    const before=Buffer.from(JSON.stringify({sid:agent.session.id,seq:3,before:2})).toString('base64url');
    const older=await request({historyBefore:before});
    assert.equal(older.liveMessages,undefined);assert.equal(older.liveActivity,undefined);
    emit('agent/assistant-stream',{agent,frame:{type:'end',attemptId:'synthetic-attempt',revision:4,index:2,outcome:{kind:'committed',eventType:'assistant/message',seq:4}}});
    assert.equal((await request()).liveMessages[0].text,'正在检查布局。','A page older than the durable commit retains the final preview');
    sequence=4;
    assert.deepEqual((await request()).liveMessages,[],'A caught-up page must not duplicate the durable message');
    rows[0].running=false;
    beforePage=()=>{
      beforePage=()=>{};
      emit('session/event',agent.session,{type:'turn/start',seq:5,time:2000,data:{turn:2}});
      emit('agent/assistant-stream',{agent,frame:{type:'start',attemptId:'next-attempt',revision:5,turn:2,step:1}});
      emit('agent/assistant-stream',{agent,frame:{type:'chunk',attemptId:'next-attempt',revision:6,index:0,time:2100,chunk:{type:'text-delta',index:0,text:'新任务正在输出'}}});
    };
    const raced=await request();
    assert.equal(raced.session.status,'active','Current native agent status must replace an idle list row captured before the page read');
    assert.equal(raced.liveMessages[0].text,'新任务正在输出');
    assert.equal((await request()).liveMessages[0].text,'新任务正在输出','A stale idle row must not erase the active preview');
  }finally{
    for(const dispose of disposers.reverse())await dispose();
    await rm(directory,{recursive:true,force:true});
  }
});
