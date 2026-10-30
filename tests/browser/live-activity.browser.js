// Production ChatTimeline and ChatActivityStatus, synthetic native metadata only.
async function runLiveActivityChecks({keepOpen=false}={}){
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const root=document.createElement('section');root.style.cssText='position:fixed;inset:0;z-index:99999;background:var(--page);display:flex;flex-direction:column';
  const viewport=document.createElement('div'),messages=document.createElement('div'),older=document.createElement('button'),newer=document.createElement('button'),working=document.createElement('div');
  viewport.className='timeline';working.className='working';working.hidden=true;working.setAttribute('role','status');
  const dot=document.createElement('i'),label=document.createElement('span'),elapsed=document.createElement('small');
  label.dataset.activityLabel='';elapsed.dataset.activityElapsed='';elapsed.hidden=true;
  working.append(dot,label,elapsed);viewport.append(older,messages,working,newer);root.append(viewport);document.body.append(root);
  let requested=0;
  const timeline=new ChatTimeline({elements:{viewport,container:messages,older,newer,working},url:()=>'/synthetic',request:async()=>{requested++;throw Error('Unexpected request');},renderMeta(){},renderText:renderMarkdown,status(){}});
  const rows=[
    {key:'user',order:0,turnId:'round',role:'user',text:'分析 fillOpenApiShopIntroduction',version:'v1'},
    {key:'progress',order:1,turnId:'round',role:'assistant',phase:'commentary',text:'我先看这个方法的调用位置和远程查询逻辑，确认它在供应商刷新流程中的作用。',version:'v1'},
    {key:'search',order:2,turnId:'round',role:'activity',kind:'commandExecution',status:'inProgress',text:'search command',version:'v1'},
  ];
  const activity={turnId:'round',itemId:'search',kind:'search',target:'java',startedAt:Date.now()-53000};
  const page=(sequence,currentActivity=activity,extra={})=>({sequence,epoch:'live-fixture',rows:sequence===1?rows:[],files:[],hasMore:false,meta:{status:'active',connected:true,requests:[],currentActivity,...extra}});
  const cleanup=()=>{timeline.dispose();root.remove();delete window.__liveActivityPreview;};
  try{
    timeline.apply(page(1),true);await frame();await frame();
    check(!working.hidden&&label.textContent===timelineText('正在搜索 {target} 文件夹中的文件').replace('{target}','java'),'Current search is visible while tool details stay collapsed');
    check(!messages.querySelector('.process-group').open,'Live status does not expand the tool transcript');
    check(!elapsed.hidden&&/\d/.test(elapsed.textContent),'Elapsed time uses the native turn start');
    const nodes=[...messages.children];
    timeline.apply(page(2,{...activity,target:'main'}));
    check(label.textContent===timelineText('正在搜索 {target} 文件夹中的文件').replace('{target}','main'),'Metadata-only live updates change the target');
    check(nodes.every((node,index)=>messages.children[index]===node),'Status changes do not append or rebuild transcript messages');
    timeline.apply({...page(1,{...activity,target:'old-page'}),rows:[]},false,true);
    check(label.textContent.includes('main'),'Historical pages cannot overwrite the live action');
    timeline.setVisibility({showProcess:false});
    check(!working.hidden&&label.textContent.includes('main'),'Hiding tool details retains the current live action');
    timeline.apply(page(3,{...activity,kind:'read',target:'SupplierProductPoolServiceImpl.java'}));
    check(label.textContent===timelineText('正在读取 {target}').replace('{target}','SupplierProductPoolServiceImpl.java'),'Read actions replace the search indicator');
    timeline.apply(page(4,{...activity,kind:'read',target:'Controller.java',status:'completed'}));
    check(label.textContent===timelineText('正在读取 {target}').replace('{target}','Controller.java'),'Fast tool completion keeps a truthful recent-action label');
    timeline.apply(page(5,{...activity,kind:'search',target:'main',status:'completed'}));
    check(label.textContent===timelineText('正在搜索 {target} 文件夹中的文件').replace('{target}','main'),'Successive completed tools update without returning to generic thinking');
    timeline.apply(page(6,null,{requests:[{id:'approval'}]}));
    check(label.textContent===timelineText('等待你的确认或回复…'),'Requests for user action take priority over tool status');
    timeline.apply(page(7,null,{status:'idle'}));check(working.hidden,'Task completion removes the live indicator');
    timeline.apply(page(8,activity,{connected:false}));check(working.hidden,'Disconnection removes stale running status');
    timeline.apply(page(9,{...activity,target:'SupplierProductPoolServiceImpl.java'}));
    timeline.setVisibility({showProcess:true});
    const query='MerchantServiceProductController#page|editable|service_review_source_version|review_status|source_version|SupplierProductPoolServiceImpl|submission_status|merchant_product_id';
    const longTarget='supply_mall_server/src/main/java/com/yx/cloud/module/supplier/service/info/long_nested_directory_for_layout_checks';
    timeline.apply(page(10,{...activity,target:longTarget,query}));
    await frame();
    check(label.textContent===timelineText('正在搜索 {target} 文件夹中的文件').replace('{target}',longTarget),'The folder caption retains the full official suffix');
    check(label.title.includes(query),'Full search parameters remain in execution details');
    check(getComputedStyle(label).whiteSpace!=='nowrap'&&label.clientHeight>20,'Long activity descriptions wrap instead of being forced into one line');
    const tail=document.createRange();tail.setStart(label.firstChild,label.firstChild.length-1);tail.setEnd(label.firstChild,label.firstChild.length);
    const tailRect=tail.getBoundingClientRect(),labelRect=label.getBoundingClientRect();
    check(tailRect.right<=labelRect.right+1&&tailRect.bottom<=labelRect.bottom+1,'The final character remains inside the visible label');
    const actions=[{kind:'read',target:'Controller.java'},{kind:'search',target:'supply/src',query:'editable|service_review_source_version'},{kind:'read',target:'VersionMapper.java'},{kind:'list',target:'supply/src/main'}];
    timeline.apply(page(11,{...activity,kind:'read',target:'Controller.java',actions}));
    check(label.textContent===timelineText('正在列出 {target} 文件夹中的文件').replace('{target}','supply/src/main'),'The most recent action drives the compact caption');
    check(['Controller.java','editable|service_review_source_version','VersionMapper.java','supply/src/main'].every(value=>label.title.includes(value)),'Compound call details retain every action');
    actions[1]={...actions[1],query:'review_status'};
    timeline.apply(page(12,{...activity,kind:'read',target:'Controller.java',actions}));
    check(label.title.includes('review_status')&&!label.title.includes('editable|service_review_source_version'),'Later parameter updates remain available without inventing a new activity');
    const exactCaption=BridgeI18n.language()==='en'?'Searching files in supply_mall_server folder':'正在搜索 supply_mall_server 文件夹中的文件';
    timeline.apply(page(13,{...activity,target:'supply_mall_server',query:'sync/center/openApi/supplier|pageWithoutTenant'}));
    check(label.textContent===exactCaption,'The fillOpenApiShopIntroduction caption matches the official wording exactly');
    check(nodes.every((node,index)=>messages.children[index]===node),'Compound action changes do not rebuild the transcript');
    await frame();
    check(root.scrollWidth<=root.clientWidth&&working.scrollWidth<=working.clientWidth,'Live label and elapsed time fit the viewport');
    check(label.getBoundingClientRect().right<=elapsed.getBoundingClientRect().left,'Long targets do not overlap elapsed time');
    check(requested===0,'Live status never fetches tool bodies');
    timeline.dispose();check(working.hidden,'Switching away disposes the live status');
    // Keep a fresh running state for screenshot review.
    if(keepOpen){
      timeline.activityStatus=new ChatActivityStatus(working);timeline.activityStatus.update(page(14,{...activity,target:'supply_mall_server',query:'sync/center/openApi/supplier|pageWithoutTenant'}).meta);
      window.__liveActivityPreview={root,cleanup};
    }
    return {passed:checks.length,width:innerWidth,checks};
  }finally{if(!keepOpen||!window.__liveActivityPreview)cleanup();}
}
