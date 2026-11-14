// Production DSH view and renderers, synthetic sessions only. No real client writes.
async function runDeepseekExperienceChecks({keepOpen=false,lateAdapter=false}={}){
  const checks=[],calls=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const root=document.createElement('div');root.className='app';root.style.cssText='position:fixed;inset:0;background:var(--page);z-index:10';document.body.append(root);
  const select=document.createElement('select');for(const provider of ['codex','claude','deepseek'])select.add(new Option(provider,provider));
  const user={id:'1:0',turnId:'1',role:'user',text:'难度大吗？影响大吗？改动大吗？'};
  const tools=Array.from({length:20},(_,index)=>({id:'tool:'+index,turnId:'1',role:'activity',kind:'commandExecution',title:'运行测试',status:index===19?'inProgress':'completed',text:'node --test fixture-'+index+'.test.cjs',toolCallId:'call:'+index}));
  const context={id:'context',role:'context',title:'会话上下文',text:'<system-reminder>\nCurrent working directory: /fixture\n'+'Native session context. '.repeat(40)+'\n</system-reminder>'};
  const thought={id:'thought',turnId:'1',role:'reasoning',text:'合成思考摘要，默认收进执行详情。'};
  const detail={session:{id:'fixture',title:'DeepSeek 手机体验：长标题与工作区',status:'active',requests:[],model:'fixture/long-model-name',effort:'high',permissionMode:'danger-full-access',permissionLabel:'danger-full-access',currentActivity:{turnId:'1',kind:'command',command:'node --test fixture-19.test.cjs',status:'inProgress',startedAt:Date.now()-12000}},capabilities:{send:true,permissions:true,models:true,skills:true,queue:true,steer:true},connected:true,messages:[user,context,thought,...tools],history:{hasMore:false},files:[]};
  const adapter=window.BridgeAndroidPresentation;if(lateAdapter)window.BridgeAndroidPresentation=undefined;
  const view=new DesktopSessionsView({root,select,notify(){},onSelect(){},csrf:()=>'',onUnauthorized(){},request:async(url,body)=>{
    calls.push({url,body});if(body)throw Error('Unexpected fixture write');
    if(url.includes('/detail'))return detail;
    if(url.includes('/workspace'))return {entries:[],total:0,project:'/fixture'};
    return {sessions:[{id:'fixture',title:detail.session.title,backend:'deepseek',status:'active'}]};
  }});
  if(lateAdapter){window.BridgeAndroidPresentation=adapter;document.dispatchEvent(new CustomEvent('bridge-android-presentation'));}
  const cleanup=()=>{view.clear();root.remove();};
  window.__deepseekExperiencePreview={view,detail,cleanup};
  try{
    await view.choose('deepseek');await view.open('fixture');clearTimeout(view.timer);await frame();await frame();
    check(view.input.closest('.android-message-input')!==null,'DSH uses the compact Android input with original controls');
    check(view.mode.closest('.composer-tools')!==null,'Send mode occupies the tool strip instead of a separate row');
    check(view.stop.closest('.android-message-input')!==null&&view.send.closest('.android-message-input')!==null,'Send and stop remain in the input row');
    check(view.form.getBoundingClientRect().height<130,'Single-line DSH composer stays below 130 CSS pixels');
    check(view.conversation.querySelector('.chat-head').getBoundingClientRect().height<=56,'DSH header is one compact line');
    check(getComputedStyle(view.workbench.strip).display==='none','A lone chat tab reserves no extra toolbar');
    check(view.permissionsButton.textContent==='完全访问','Native permission identifiers receive a readable label');
    const input=view.input,send=view.send;
    view.adaptPresentation();view.adaptPresentation();
    check(view.form.querySelectorAll('.android-message-input').length===1&&view.input===input&&view.send===send,'Repeated adaptation keeps one wrapper and original control identity');
    view.conversation.querySelector('.android-workspace-button').click();await frame();
    check(document.querySelector('.wb-new-tab')?.open,'Compact header retains the actual workspace chooser');document.querySelector('.wb-new-tab').close();
    view.input.value='保留的草稿';view.input.dispatchEvent(new Event('input',{bubbles:true}));
    view.composerToggle.click();await frame();check(view.composerBody.hidden,'Collapse keeps the input controls together');view.composerToggle.click();await frame();
    check(view.input.value==='保留的草稿','Compact input collapse retains the draft');
    const groups=view.messages.querySelectorAll('.process-group');
    check(groups.length===1&&!groups[0].open,'Twenty consecutive tools start in one collapsed process group');
    check(view.messages.querySelectorAll(':scope > details.activity').length===0,'Tool rows do not flood the top-level stream');
    check(groups[0].querySelector('summary').textContent.includes('20'),'Process count reports calls without counting results twice');
    const contextNode=view.messageNodes.get('context').node;
    check(contextNode.tagName==='DETAILS'&&!contextNode.open&&!contextNode.classList.contains('user'),'Native system context is collapsed outside the user bubble');
    check(contextNode.querySelector('pre').textContent===context.text,'Collapsing system context preserves its complete text');
    check(groups[0].contains(view.messageNodes.get('thought').node),'Thinking is inside the same process disclosure as tools');
    check(view.conversation.querySelector('[data-activity-label]')?.textContent.includes('fixture-19'),'Current native command appears in the activity summary');
    groups[0].open=true;
    view.applyDetail({...detail,messages:[...detail.messages,{id:'reply',turnId:'1',role:'assistant',text:'已完成检查。'}]});await frame();
    check(view.messages.querySelector('.process-group')===groups[0]&&groups[0].open,'Refresh preserves the expanded process node');
    check(view.messages.lastElementChild.classList.contains('assistant'),'Public reply remains outside the tool disclosure');
    const failed={...tools[1],status:'failed'};
    view.applyDetail({...detail,messages:[user,context,thought,...tools.map(row=>row.id===failed.id?failed:row),{id:'task-error',turnId:'1',role:'error',text:'合成任务错误'}]});await frame();
    check(view.messages.querySelector('.process-group-issues')?.textContent.includes('1'),'Tool failure is summarized inside the process group');
    check(view.messages.lastElementChild.classList.contains('error'),'Task failure stays visible outside the process group');
    const priorVisibility={reasoning:document.documentElement.dataset.showReasoning,process:document.documentElement.dataset.showProcess};
    document.documentElement.dataset.showReasoning='false';document.documentElement.dataset.showProcess='false';await frame();
    check(!!view.messages.querySelector('.process-group-issues')&&view.messages.lastElementChild.classList.contains('error'),'Hiding process details retains tool and task failure evidence');
    for(const [name,value] of [['showReasoning',priorVisibility.reasoning],['showProcess',priorVisibility.process]])if(value===undefined)delete document.documentElement.dataset[name];else document.documentElement.dataset[name]=value;
    await frame();
    view.applyDetail({...detail,session:{...detail.session,status:'idle',currentActivity:null}});await frame();
    check(view.conversation.querySelector('.working').hidden,'Native completion clears the current activity');
    view.applyDetail({...detail,messages:[user,context,thought,...tools,{id:'answer',turnId:'1',role:'assistant',text:'布局已收紧，执行过程默认折叠；这里保留公开回答正文。'}]});
    view.messages.querySelector('.process-group').open=false;view.messages.scrollTop=0;await frame();
    check(document.documentElement.scrollWidth<=innerWidth+1,'Long names cause no viewport overflow');
    check(calls.every(call=>!call.body),'All synthetic checks remain read-only');
    return {passed:checks.length,checks,geometry:{width:innerWidth,composer:view.form.getBoundingClientRect().height,header:view.conversation.querySelector('.chat-head').getBoundingClientRect().height}};
  }finally{clearTimeout(view.timer);if(!keepOpen)cleanup();}
}
