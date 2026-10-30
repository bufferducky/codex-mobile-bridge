/* Production UI against synthetic APIs only.
 * CMB_FIXTURE_ONLY=1 CMB_ANDROID_UI_FIXTURE=1 node scripts/smoke-wsl-app-ui.cjs
 * Click "运行界面检查" in the fixture. No real clients, accounts or models.
 */
'use strict';
(()=>{
  const button=document.createElement('button'),result=document.createElement('pre');
  const dismiss=document.createElement('button');dismiss.textContent='关闭检查结果';dismiss.hidden=true;
  dismiss.style.cssText='position:fixed;top:8px;right:8px;z-index:10000;padding:8px;background:var(--accent);color:var(--accent-ink)';
  dismiss.onclick=()=>{result.hidden=true;button.hidden=true;dismiss.hidden=true;};
  button.textContent='运行界面检查';button.id='android-ui-checks';
  button.style.cssText='position:fixed;bottom:8px;right:8px;z-index:9999;padding:8px;background:var(--accent);color:var(--accent-ink);border:0;border-radius:8px';
  result.id='android-ui-results';result.style.cssText='position:fixed;bottom:50px;right:8px;z-index:9999;max-width:95vw;max-height:50vh;overflow:auto;background:white;color:#242b29;padding:16px;border:1px solid #ddd;white-space:pre-wrap';result.hidden=true;
  document.body.append(button,result,dismiss);
  button.onclick=async()=>{
    button.disabled=true;result.hidden=false;result.textContent='正在检查…';let count=0;
    const check=(condition,message)=>{if(!condition)throw Error(message);count++;};
    const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('等待超时');};
    let isolated;
    try{
      await wait(()=>!document.getElementById('app').hidden&&typeof clientNavigation!=='undefined'&&clientNavigation.clients.length>0);
      check(BridgeHost.kind()==='android','Android host identity');
      check(clientNavigation.provider==='codex','Codex selected');
      check(clientNavigation.switchDock.hidden,'Switcher hidden');
      check(clientNavigation.switchToggle.hidden,'Native menu switch toggle hidden');
      await clientNavigation.choose('claude');check(clientNavigation.provider==='codex','Other providers do not switch this Android view');
      const session=document.querySelector('.session');check(!!session,'Synthetic chat list loaded');session.click();
      await wait(()=>!document.getElementById('chat').hidden&&window.BridgeWorkbench?.current&&typeof ChatTimeline!=='undefined'&&typeof chatTimeline!=='undefined'&&chatTimeline?.sequence>=0);
      check(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#4c6f98','Misty blue-gray default accent');
      const draft=document.getElementById('message');
      check(draft.closest('.android-message-input')!==null,'Compact input contains the real textarea');
      check(document.getElementById('send-mode').closest('.composer-tools')!==null,'Send mode still accessible');
      check(document.getElementById('work-mode').closest('.composer-tools')!==null,'Work mode still accessible');
      check(!document.getElementById('messages').contains(document.getElementById('approvals')),'Live approvals remain outside the grouped message stream');
      draft.value='保留的检查草稿';draft.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('composer-toggle').click();document.getElementById('composer-toggle').click();
      check(draft.value==='保留的检查草稿','Collapsing retains draft');draft.value='';draft.dispatchEvent(new Event('input',{bubbles:true}));
      check(document.querySelector('#chat .chat-head').getBoundingClientRect().height<=56,'Single-line header');
      check(document.getElementById('composer').getBoundingClientRect().height<130,'Compact composer');
      document.querySelector('.android-workspace-button').click();
      const workspace=document.querySelector('.wb-new-tab');check(workspace?.open,'Original workspace chooser opens');workspace.close();
      // Real DOM, real ChatTimeline; test only local synthetic state.
      isolated=document.createElement('section');isolated.style.cssText='height:200px;width:320px;overflow:auto;position:fixed;left:0;top:0;z-index:-1';
      const messages=document.createElement('div'),older=document.createElement('button'),newer=document.createElement('button');isolated.append(messages,older,newer);document.body.append(isolated);
      const timeline=new ChatTimeline({elements:{viewport:isolated,container:messages,older,newer},url:()=>'/synthetic',request:async()=>{throw Error('Unexpected request');},renderMeta(){},renderText:(node,text)=>node.textContent=text,status(){}});
      const tool=(key,order,extra={})=>({key,order,turnId:'round',role:'activity',kind:'commandExecution',status:'completed',turnStatus:'completed',version:'v1',text:'command '+key,...extra});
      const page=(sequence,rows)=>({sequence,epoch:'synthetic',rows,files:[],meta:{requests:[]},hasMore:false});
      timeline.apply(page(1,[{key:'user',turnId:'round',role:'user',order:0,version:'v1',text:'request'},tool('read',1),tool('search',2),{key:'answer',turnId:'round',role:'assistant',order:4,version:'v1',text:'final answer'}]),true);
      const group=messages.querySelector('.process-group');check(!!group&&!group.open,'Execution starts collapsed');check(messages.querySelectorAll(':scope > .activity').length===0,'No scattered process cards');
      group.open=true;timeline.apply(page(2,[tool('test',3)]));check(messages.querySelector('.process-group')===group&&group.open,'Streaming update retains disclosure and open state');
      check(group.querySelectorAll('.timeline-row').length===3,'Streaming appends actual tool rows');
      check(messages.lastElementChild.dataset.key==='answer','Final answer stays outside process group');
      timeline.apply(page(3,[tool('failed',5,{exitCode:1})]));timeline.setVisibility({showProcess:false});
      check(messages.querySelector(':scope > .execution-failure')===null,'Tool failure does not create a separate warning card');
      check(messages.querySelector('.process-group-issues')!==null,'Tool failure retains a visible issue summary when process display is off');
      timeline.setVisibility({showProcess:true});check(messages.querySelector('.process-group').open,'Visibility changes preserve expanded process');
      timeline.apply(page(4,[tool('earlier',-2),{key:'earlier-answer',turnId:'round',role:'assistant',order:-1,version:'v1',text:'earlier stage'}]),false,true);
      check(messages.querySelectorAll('.process-group').length===3,'Earlier history adds a distinct chronological run');
      check(group.open&&group.querySelector('[data-key=read]')!==null,'Earlier runs never steal the expanded state of the current run');
      timeline.dispose();isolated.remove();isolated=null;
      // Load a bundled fixture font through the actual appearance import handler.
      const fontInput=document.getElementById('appearance-code-file'),select=document.getElementById('appearance-code-family');
      const bytes=await (await fetch('/__font.ttf')).arrayBuffer(),transfer=new DataTransfer();transfer.items.add(new File([bytes],'fixture-font.ttf'));
      fontInput.files=transfer.files;fontInput.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>!fontInput.disabled&&select.value==='custom');
      check(document.fonts.check('13px BridgeCustomCode'),'Imported font parsed and registered');
      const reloaded=new BridgeFontLibrary.Library();check((await reloaded.restore('code'))?.name==='fixture-font.ttf','Font survives a fresh library using IndexedDB');
      const invalid=new DataTransfer();invalid.items.add(new File(['<html>not a font</html>'],'bad.ttf'));fontInput.files=invalid.files;fontInput.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>!fontInput.disabled);check(select.value==='custom','Invalid font leaves previous selection intact');
      check(document.getElementById('appearance-code-font-status').textContent.includes('有效'),'Invalid font reports an error');
      document.getElementById('appearance-code-font-remove').click();await wait(()=>select.value==='mono');
      check(!(await new BridgeFontLibrary.Store().read('code')),'Delete removes saved font bytes');
      result.textContent='通过 '+count+' 项浏览器检查\n生产页面 + 合成 API\n未执行 Android 真机验证';result.dataset.status='passed';
      document.documentElement.dataset.androidChecks='passed';
    }catch(error){result.textContent='失败：'+error.stack;result.dataset.status='failed';document.documentElement.dataset.androidChecks='failed';}
    finally{isolated?.remove();button.disabled=false;button.textContent='重新检查';dismiss.hidden=false;}
  };
})();
