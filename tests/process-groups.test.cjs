'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ctx=vm.createContext({window:{},BridgeI18n:{t:s=>s}});
vm.runInContext(fs.readFileSync('web/features/chat/timeline.js','utf8'),ctx);
const group=vm.runInContext('timelineProcessGroups',ctx),failure=vm.runInContext('timelineFailure',ctx);
const tool=(key,extra={})=>({key,turnId:'turn-1',kind:'commandExecution',role:'activity',...extra});
const keys=plan=>plan.flatMap(item=>item.row?[item.row.key]:item.rows.map(row=>row.key));
test('native reconnect notices are informational while terminal and detailed errors remain failures',()=>{
 const reconnect=vm.runInContext('timelineReconnectText',ctx);
 for(const text of ['Reconnecting... 1/5','Reconnecting… 2/5','Reconnecting...','重新连接中… 1/5','正在重连… 3/5']){
  const row={role:'error',text};assert.ok(reconnect(row),text);assert.equal(failure(row),false,text);
 }
 for(const text of ['Reconnecting failed after 5 attempts','Reconnecting... 1/5\nAuthentication failed','连接中断，请重新连接。','Reconnecting... 6/5','Reconnecting... 1/0','Failed: Reconnecting... 1/5']){
  const row={role:'error',text};assert.equal(reconnect(row),null,text);assert.equal(failure(row),true,text);
 }
 assert.equal(reconnect({role:'assistant',text:'Reconnecting... 1/5'}),null);
 assert.equal(reconnect({role:'error',text:'Reconnecting... 1/5',truncated:true}),null);
 assert.equal(reconnect({role:'error',text:'Reconnecting... 1/5',attachments:[{type:'image'}]}),null);
});
test('progress commentary stays between its tool groups and final output',()=>{
 const rows=[{key:'user',turnId:'turn-1',role:'user'},tool('read'),{key:'progress',turnId:'turn-1',role:'assistant',phase:'commentary'},tool('test'),{key:'answer',turnId:'turn-1',role:'assistant',phase:'final_answer'}];
 const plan=group(rows);assert.equal(plan.length,5);assert.equal(plan[2].row.key,'progress');assert.deepEqual(Array.from(plan[1].rows,row=>row.key),['read']);assert.deepEqual(Array.from(plan[3].rows,row=>row.key),['test']);assert.deepEqual(Array.from(keys(plan)),rows.map(row=>row.key));
});
test('tool failures stay in one disclosure while task errors, file changes and images remain outside',()=>{
 const rows=[tool('ok'),tool('nonzero',{exitCode:2}),tool('failed',{status:'failed'}),tool('error',{role:'error'}),tool('files',{role:'fileChanges',fileSummary:{count:1}}),tool('image',{attachments:[{type:'toolImage'}]}),tool('next')];
 const plan=group(rows);assert.deepEqual(Array.from(plan[0].rows,row=>row.key),['ok','nonzero','failed']);for(const key of ['error','files','image'])assert.ok(plan.some(item=>item.row?.key===key),key);
 assert.deepEqual(Array.from(keys(plan)),rows.map(row=>row.key));assert.equal(failure(rows[1]),true);
});
test('turns and missing identities never merge into the same process group',()=>{
 const plan=group([tool('one'),tool('two',{turnId:'turn-2'}),tool('legacy',{turnId:undefined})]);assert.equal(plan.length,3);assert.equal(plan[2].row.key,'legacy');
});
test('loading an earlier part of the same run retains group identity',()=>{
 const page=group([tool('recent')]),expanded=group([tool('earlier'),tool('recent')]);assert.equal(page[0].key,expanded[0].key);
});
test('public answers and user interventions retain their chronological position',()=>{
 const rows=[tool('first'),{key:'intervention',role:'user',turnId:'turn-1'},tool('second')],plan=group(rows);assert.equal(plan.length,3);assert.notEqual(plan[0].key,plan[2].key);assert.deepEqual(Array.from(keys(plan)),rows.map(row=>row.key));
});
test('failed commands stay visible even when execution details are disabled',()=>{
 const type=vm.runInContext('ChatTimeline',ctx),ui=Object.create(type.prototype);ui.showProcess=false;ui.showReasoning=false;
 assert.equal(ui.rowVisible(tool('fail',{exitCode:1})),true);assert.equal(ui.rowVisible(tool('ok',{exitCode:0})),false);
});
test('public progress remains visible when both reasoning and tool details are disabled',()=>{
 const type=vm.runInContext('ChatTimeline',ctx),ui=Object.create(type.prototype);ui.showProcess=false;ui.showReasoning=false;
 assert.equal(ui.rowVisible({role:'assistant',phase:'commentary'}),true);
 assert.equal(ui.rowVisible(tool('reasoning',{kind:'reasoning'})),false);
 assert.equal(ui.rowVisible({role:'error'}),true);
});
test('command exit codes remain explicit without presenting them as task failures',()=>{
 const label=vm.runInContext('timelineActivityLabel',ctx);
 assert.equal(label(tool('search',{title:'执行命令',status:'completed',exitCode:1})),'执行命令 · 退出码 1');
 assert.equal(label(tool('search',{title:'执行命令',status:'failed',exitCode:2})),'执行命令 · 退出码 2');
 assert.equal(label(tool('tool',{title:'工具',status:'failed'})),'工具 · 执行失败');
});
