// Run with production timeline.js, renderMarkdown and chat styles loaded.
// All records and detail responses are synthetic; never contacts a live chat.
async function runProgressTimelineChecks({keepOpen=false}={}){
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const root=document.createElement('section');root.style.cssText='position:fixed;inset:0;z-index:99999;background:var(--page);display:flex;flex-direction:column';
  const viewport=document.createElement('div'),messages=document.createElement('div'),older=document.createElement('button'),newer=document.createElement('button');
  viewport.className='timeline';viewport.append(older,messages,newer);root.append(viewport);document.body.append(root);
  const tool=(key,order,extra={})=>({key,order,turnId:'round',role:'activity',kind:'commandExecution',title:'执行命令',text:'rg message web/',status:'completed',turnStatus:'inProgress',version:'v1',...extra});
  const progress=(key,order,text)=>({key,order,turnId:'round',role:'assistant',kind:'agentMessage',phase:'commentary',text,model:'fixture-model',turnStatus:'inProgress',version:'v1'});
  const rows=[
    {key:'user',order:0,turnId:'round',role:'user',text:'请精简手机端的执行过程展示。',version:'v1'},
    progress('intro',1,'我先定位消息气泡和操作栏，检查占用空间的原因。'),
    tool('read',2),tool('failed',3,{exitCode:1}),tool('search',4),
    progress('finding',5,'已找到主要原因：进度说明被折叠了，工具异常又拆出了多张卡片。'),
    tool('check',6),
    {key:'answer',order:8,turnId:'round',role:'assistant',phase:'final_answer',text:'进度说明会直接显示，工具记录收进轻量的执行详情。',version:'v1'},
  ];
  const page=(items,sequence=1)=>({rows:items,sequence,epoch:'progress-fixture',files:[],meta:{status:'active',requests:[{id:'approval-fixture'}]},hasMore:false});
  let requests=0,meta;
  const timeline=new ChatTimeline({elements:{viewport,container:messages,older,newer},url:action=>'/fixture/'+action,request:async()=>{requests++;return {key:'failed',version:'v1',offset:0,text:'rg message web/\nNo matches',next:null};},renderMeta:value=>meta=value,renderText:renderMarkdown,status(){}});
  const cleanup=()=>{timeline.dispose();root.remove();delete window.__progressTimelinePreview;};
  try{
    timeline.setVisibility({showProcess:true,showReasoning:true});timeline.apply(page(rows),true);
    await frame();await frame();
    check(timeline.nodes.get('intro').node.parentElement===messages&&timeline.nodes.get('finding').node.parentElement===messages,'Public progress stays outside tool disclosures');
    check([...messages.children].map(n=>n.dataset.key).join(',')==='user,intro,read,finding,check,answer','Progress, tools and final answer retain their chronological order');
    const group=messages.querySelector('.process-group');
    check(messages.querySelectorAll('.process-group').length===2&&!group.open,'Consecutive tools including failures share a collapsed disclosure');
    check(group.querySelector('.process-group-issues')?.textContent.includes('1'),'Collapsed tool issues have a visible count');
    check(messages.querySelector(':scope > .execution-failure')===null,'A tool issue does not create a task failure card');
    check([...messages.querySelectorAll('.process-group>summary')].every(n=>!n.textContent.includes('进行中')&&!n.textContent.includes('In progress')),'Past tool groups do not inherit the active turn label');
    check(meta.requests[0].id==='approval-fixture'&&timeline.pendingRequests,'Approval metadata remains actionable outside the tool groups');
    check(requests===0,'Collapsed tools do not fetch detail bodies');
    check([...messages.querySelectorAll('.progress-message')].every(n=>!n.querySelector('.message-actions')&&getComputedStyle(n.querySelector('.who')).display==='none'),'Progress is readable without repeated model headers or action bars');
    check(group.querySelector('summary').getBoundingClientRect().height<=40,'Tool summary occupies a compact line');
    check(getComputedStyle(group).borderTopWidth==='0px','Collapsed tool summaries have no card border');
    const intro=timeline.nodes.get('intro').node;
    group.open=true;
    timeline.apply(page([tool('streamed',4.5,{status:'inProgress'}),{...rows[5],version:'v2',text:rows[5].text+' 正在验证显示效果。'}],2));
    check(messages.querySelector('.process-group')===group&&group.open&&group.querySelectorAll('.timeline-row').length===4,'Streaming keeps the same expanded tool group');
    check(timeline.nodes.get('intro').node===intro&&timeline.nodes.get('finding').node.parentElement===messages,'Streaming preserves earlier progress and updates the current explanation');
    timeline.setVisibility({showProcess:false,showReasoning:false});
    check(timeline.nodes.get('intro').node.parentElement===messages&&!intro.hidden,'Hiding execution details retains public progress');
    check(messages.querySelector('.process-group-issues')&&messages.querySelectorAll('.process-group').length===1,'Hiding tools retains the compact issue disclosure');
    timeline.setVisibility({showProcess:true});
    check(messages.querySelector('.process-group')===group&&group.open,'Restoring tools preserves disclosure expansion');
    const failed=timeline.nodes.get('failed').node;failed.open=true;
    for(let i=0;i<10&&requests===0;i++)await frame();
    await frame();
    check(requests===1&&failed.textContent.includes('No matches'),'Opening a failed command loads its original details');
    check(failed.querySelector('summary').textContent===timelineActivityLabel(tool('failed',3,{exitCode:1})),'Nonzero exit codes retain their exact result in both languages');
    timeline.apply(page([{key:'task-error',order:9,turnId:'round',role:'error',text:'连接中断，请重新连接。',version:'v1'}],3));
    check(messages.querySelector(':scope > .execution-failure')?.dataset.key==='task-error','Task-level errors remain visible outside tool details');
    timeline.apply(page([tool('earlier',-2),progress('earlier-progress',-1,'这是更早的一段进度。')],4),false,true);
    check(group.open&&group.querySelector('[data-key=read]')&&messages.firstElementChild!==group,'History prepend cannot transfer expansion to an unrelated tool run');
    check(root.scrollWidth<=root.clientWidth&&messages.scrollWidth<=messages.clientWidth,'Progress and tool summaries fit the viewport');
    // Return to a representative running view for visual review.
    timeline.apply(page(rows,5),true);for(const node of messages.querySelectorAll('.process-group'))node.open=false;
    viewport.scrollTop=0;await frame();await frame();
    if(keepOpen)window.__progressTimelinePreview={timeline,root,cleanup};
    return {passed:checks.length,width:innerWidth,checks};
  }finally{if(!keepOpen||!window.__progressTimelinePreview)cleanup();}
}
