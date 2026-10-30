'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ctx=vm.createContext({window:{},BridgeI18n:{t:s=>s}});
vm.runInContext(fs.readFileSync('web/features/chat/timeline.js','utf8'),ctx);
const group=vm.runInContext('timelineProcessGroups',ctx),failure=vm.runInContext('timelineFailure',ctx);
const tool=(key,extra={})=>({key,turnId:'turn-1',kind:'commandExecution',role:'activity',...extra});
const keys=plan=>plan.flatMap(item=>item.row?[item.row.key]:item.rows.map(row=>row.key));
test('a native turn folds tools and progress commentary while preserving final output',()=>{
 const rows=[{key:'user',turnId:'turn-1',role:'user'},tool('read'),{key:'progress',turnId:'turn-1',role:'assistant',phase:'commentary'},tool('test'),{key:'answer',turnId:'turn-1',role:'assistant',phase:'final_answer'}];
 const plan=group(rows);assert.equal(plan.length,3);assert.deepEqual(Array.from(plan[1].rows,row=>row.key),['read','progress','test']);assert.deepEqual(Array.from(keys(plan)),rows.map(row=>row.key));
});
test('failures, file changes and tool images remain outside collapsed groups',()=>{
 const rows=[tool('ok'),tool('nonzero',{exitCode:2}),tool('failed',{status:'failed'}),tool('error',{role:'error'}),tool('files',{role:'fileChanges',fileSummary:{count:1}}),tool('image',{attachments:[{type:'toolImage'}]}),tool('next')];
 const plan=group(rows);for(const key of ['nonzero','failed','error','files','image'])assert.ok(plan.some(item=>item.row?.key===key),key);
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
