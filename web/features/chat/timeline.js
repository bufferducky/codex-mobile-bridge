'use strict';
const timelineText=source=>typeof BridgeI18n==='undefined'?source:BridgeI18n.t(source);
const fileChangeLabel=row=>timelineText('已编辑 {count} 个文件').replace('{count}',row.fileSummary?.count||0);
const recentTimelinePages=new Map();

function timelineWorkingSummary(activity){
  if(activity.summary&&typeof activity.summary==='object')return activity.summary;
  return Array.isArray(activity.actions)&&activity.actions.length?activity.actions[activity.actions.length-1]:activity;
}

function timelineWorkingActionText(action,status){
  const target=typeof action.target==='string'?action.target.slice(0,4096):'',query=typeof action.query==='string'?action.query.slice(0,4096):'',command=typeof action.command==='string'?action.command.slice(0,4096):'',kind=action.kind;
  const labels={search:['正在搜索 {target} 文件夹中的文件','正在搜索文件'],read:['正在读取 {target}','正在读取文件'],list:['正在列出 {target} 文件夹中的文件','正在列出文件'],tool:['正在调用 {target}','正在调用工具…'],image:['正在查看 {target}','正在查看图片…'],edit:['正在修改 {target}','正在修改文件…']};
  const neutral={search:['搜索 {target} 文件夹中的文件','搜索文件'],read:['读取 {target}','读取文件'],list:['列出 {target} 文件夹中的文件','列出文件'],tool:['调用 {target}','调用工具'],image:['查看 {target}','查看图片'],edit:['修改 {target}','修改文件']};
  let text;
  if(kind==='command'){
    const stopped=['cancelled','declined','interrupted'].includes(status),finished=['completed','failed','error'].includes(status);
    text=stopped?(command?'已停止 {command}':'已停止命令'):finished?(command?'已运行 {command}':'已运行命令'):(command?'正在运行 {command}':'正在运行命令');
    if(status==='neutral')text=command?'运行 {command}':'运行命令';
  }else if(status==='neutral')text=kind==='search'&&query?(target?'搜索 {target} 中的「{query}」':'搜索「{query}」'):neutral[kind]?neutral[kind][target?0:1]:'处理任务';
  // The official activity caption uses a folder description when a path is
  // supplied. Search terms are used only when no folder is available.
  else if(kind==='search'&&!target&&query)text='正在搜索「{query}」';
  else text=labels[kind]?labels[kind][target?0:1]:kind==='replying'?'正在生成回答…':kind==='thinking'?'正在思考…':'Codex 正在工作…';
  return timelineText(text).replace(/\{(target|query|command)\}/g,(_,key)=>({target,query,command})[key]);
}

function timelineWorkingStatusText(activity,waiting){
  if(waiting)return timelineText('等待你的确认或回复…');
  return timelineWorkingActionText(timelineWorkingSummary(activity),activity.status);
}

function timelineWorkingDetailsText(activity){
  const actions=Array.isArray(activity.actions)&&activity.actions.length?activity.actions.slice(0,64):[activity];
  let label=actions.map(action=>timelineWorkingActionText(action,'neutral')).join(timelineText('；'));
  if(Number.isInteger(activity.actionsOmitted)&&activity.actionsOmitted>0)label+=timelineText('；另有 {count} 项动作，详见执行详情').replace('{count}',activity.actionsOmitted);
  return label;
}

class ChatActivityStatus {
  constructor(node,{now=()=>Date.now(),schedule=fn=>setInterval(fn,1000),cancel=id=>clearInterval(id)}={}){
    Object.assign(this,{node,now,schedule,cancel});
    this.label=node.querySelector('[data-activity-label]');this.elapsed=node.querySelector('[data-activity-elapsed]');
    this.document=node.ownerDocument;
    this.onVisibility=()=>{if(this.document.hidden)this.stopTimer();else if(this.view)this.update(this.view);};
    this.document?.addEventListener('visibilitychange',this.onVisibility);
  }
  stopTimer(){if(this.timer!==undefined){this.cancel(this.timer);this.timer=undefined;}}
  update(view={}){
    this.view=view;this.stopTimer();
    this.node.hidden=view.status!=='active'||!view.connected;
    if(this.node.hidden){this.elapsed.hidden=true;this.elapsed.textContent='';return;}
    const activity=view.currentActivity||{};
    const kind=view.requests?.length?'waiting':timelineWorkingSummary(activity).kind||'working';
    this.label.textContent=timelineWorkingStatusText(activity,kind==='waiting');
    this.label.title=kind==='waiting'?this.label.textContent:timelineWorkingDetailsText(activity);
    this.node.dataset.activityKind=kind;
    this.startedAt=activity.startedAt;this.renderTime();
    if(!this.elapsed.hidden&&!this.document?.hidden)this.timer=this.schedule(()=>this.renderTime());
  }
  renderTime(){
    const start=this.startedAt,now=this.now();
    this.elapsed.hidden=typeof start!=='number'||!Number.isFinite(start)||start<=0||start>now;
    if(this.elapsed.hidden){this.elapsed.textContent='';return;}
    const seconds=Math.floor((now-start)/1000),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
    const duration=hours?timelineText('{hours}小时{minutes}分').replace('{hours}',hours).replace('{minutes}',minutes%60):minutes?timelineText('{minutes}分{seconds}秒').replace('{minutes}',minutes).replace('{seconds}',seconds%60):timelineText('{seconds}秒').replace('{seconds}',seconds);
    this.elapsed.textContent=timelineText('已处理 {duration}').replace('{duration}',duration);
  }
  dispose(){this.stopTimer();this.document?.removeEventListener('visibilitychange',this.onVisibility);this.node.hidden=true;this.view=null;}
}

// Fold consecutive tool records within one native turn. Public progress,
// task errors, final answers, file summaries and tool images stay in the stream.
function timelineReconnectText(row){
  if(row.role!=='error'||row.truncated||row.attachments?.length||typeof row.text!=='string')return null;
  // Native retry notices arrive as error items. Only the standalone notice is
  // informational; exhausted retries and messages with error details stay errors.
  const match=/^(?:reconnecting|正在重连|正在重新连接|重新连接中)(?:\.{3}|…)?\s*(?:(\d{1,3})\s*\/\s*(\d{1,3}))?$/i.exec(row.text.trim());
  if(!match||match[2]&&(!Number(match[2])||Number(match[1])>Number(match[2])))return null;
  return timelineText('重新连接中')+'…'+(match[1]?' '+match[1]+'/'+match[2]:'');
}
function timelineFailure(row){return !timelineReconnectText(row)&&(row.role==='error'||['failed','error','declined','cancelled'].includes(row.status)||Number.isInteger(row.exitCode)&&row.exitCode!==0);}
function timelineActivityLabel(row){
  const label=row.title||row.kind;
  // A command's nonzero exit code need not mean that the whole task failed.
  if(Number.isInteger(row.exitCode)&&row.exitCode!==0)return label+' · '+timelineText('退出码 {code}').replace('{code}',row.exitCode);
  return label+(timelineFailure(row)?' · '+timelineText('执行失败'):row.status==='inProgress'?timelineText(' · 进行中'):'');
}
function timelineProcessRow(row){
  if(!row.turnId||row.role==='error'||row.role==='fileChanges'||row.fileSummary)return false;
  if(row.attachments?.some(item=>['toolImage','localImage','image'].includes(item.type)))return false;
  return row.role==='activity';
}
function timelineProcessGroups(rows){
  const result=[],runs=new Map();let group=null;
  for(const row of rows){
    if(!timelineProcessRow(row)){group=null;result.push({row});continue;}
    if(!group||group.turnId!==row.turnId){
      const index=runs.get(row.turnId)||0;runs.set(row.turnId,index+1);
      group={key:JSON.stringify([row.turnId,index]),turnId:row.turnId,rows:[]};result.push(group);
    }
    group.rows.push(row);
  }
  return result;
}
function timelineFilePath(path,cwd){
  if(typeof path!=='string'||!path||typeof cwd!=='string'||!cwd||/[\0\r\n]/.test(path))throw Error(timelineText('文件路径无法定位'));
  const windows=/^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(cwd);
  const normalize=value=>windows?value.replace(/\\/g,'/'):value;
  path=normalize(path);cwd=normalize(cwd).replace(/\/+$/,'');
  const absolute=/^(?:\/|[A-Za-z]:\/)/.test(path);
  if(absolute){
    const prefix=cwd+'/',match=windows?path.toLowerCase().startsWith(prefix.toLowerCase()):path.startsWith(prefix);
    if(!match)throw Error(timelineText('此文件位于聊天项目之外，无法在当前文件标签页中定位。'));
    path=path.slice(prefix.length);
  }
  const parts=[];
  for(const part of path.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw Error(timelineText('文件路径无法定位'));parts.pop();}
    else parts.push(part);
  }
  if(!parts.length||parts.some(part=>part.includes('\\')||part.includes(':')))throw Error(timelineText('文件路径无法定位'));
  return parts.join('/');
}

// History and live changes share stable keys, but never share a request queue.
class ChatTimeline {
  static clearCache(){recentTimelinePages.clear();}
  constructor({url, request, renderMeta, renderText, status, onAction, onFile, canEdit = () => true, elements = {}, active = () => true, cacheKey = ''}) {
    Object.assign(this,{url,request,renderMeta,renderText,status,onAction,onFile,active,cacheKey});
    this.canEdit=()=>!this.cached&&canEdit();
    this.viewport=elements.viewport||document.getElementById('timeline');
    this.container=elements.container||document.getElementById('messages');
    this.older=elements.older||document.getElementById('older');
    this.newer=elements.newer||document.getElementById('newer');
    this.activityStatus=elements.working?new ChatActivityStatus(elements.working):null;
    this.abort=new AbortController();this.rows=new Map();this.nodes=new Map();this.details=new Map();this.processGroups=new Map();
    this.compactActions=typeof BridgeHost!=='undefined'&&BridgeHost.kind()==='android';
    if(this.compactActions)this.actionLabelsObserver=new MutationObserver(records=>{
      for(const record of records){const target=record.target.nodeType===1?record.target:record.target.parentElement,button=target?.closest('button');if(button)this.labelAction(button);}
    });
    this.mermaidScope=window.BridgeMermaidCards?.createScope();
    this.files=new Map();this.sequence=-1;this.epoch='';this.before=null;this.hasMore=false;
    this.busy=false;this.generation=0;this.windowRevision=0;this.following=true;this.lastTop=0;this.retryCount=0;
    this.showReasoning=document.documentElement.dataset.showReasoning!=='false';
    this.showProcess=document.documentElement.dataset.showProcess!=='false';
    this.showToolImages=document.documentElement.dataset.showToolImages!=='false';
    this.onScroll=()=>{
      if(this.suppress||!this.viewport.clientHeight)return;
      const upward=this.viewport.scrollTop<this.lastTop;
      this.lastTop=this.viewport.scrollTop;this.following=this.atBottom();this.anchor=this.capture();
      if(this.following)this.newer.hidden=true;
      if(upward&&this.nearTop()&&!this.retryCount)this.loadOlder(100);
    };
    this.viewport.addEventListener('scroll',this.onScroll,{passive:true});
    // At the scroll boundary wheel/touch intent produces no scroll event.
    this.atHistoryEdge=()=>!this.suppress&&this.viewport.clientHeight&&this.viewport.scrollTop<=1&&!this.retryCount;
    this.onWheel=event=>{if(event.deltaY<0&&this.atHistoryEdge())this.loadOlder(100);};
    this.onTouchStart=event=>{this.touchY=event.touches.length===1?event.touches[0].clientY:null;};
    this.onTouchMove=event=>{if(this.touchY===null||event.touches.length!==1)return;const y=event.touches[0].clientY;if(y-this.touchY>12&&this.atHistoryEdge()){this.touchY=y;this.loadOlder(100);}};
    this.viewport.addEventListener('wheel',this.onWheel,{passive:true});
    this.viewport.addEventListener('touchstart',this.onTouchStart,{passive:true});
    this.viewport.addEventListener('touchmove',this.onTouchMove,{passive:true});
    this.older.onclick=()=>this.sequence<0||this.cached?this.start():this.loadOlder(this.retryCount||100);
    this.newer.onclick=()=>{this.jumpBottom();this.anchor=this.capture();};
    this.resize=new ResizeObserver(()=>this.restore(this.anchor,this.following));
    this.resize.observe(this.container);
  }
  dispose(){this.abort.abort();this.actionLabelsObserver?.disconnect();this.activityStatus?.dispose();window.BridgeMermaidCards?.clearScope(this.mermaidScope);clearTimeout(this.startRetry);this.resize.disconnect();this.viewport.removeEventListener('scroll',this.onScroll);this.viewport.removeEventListener('wheel',this.onWheel);this.viewport.removeEventListener('touchstart',this.onTouchStart);this.viewport.removeEventListener('touchmove',this.onTouchMove);this.newer.hidden=true;}
  atBottom(){return this.viewport.scrollHeight-this.viewport.scrollTop-this.viewport.clientHeight<110;}
  nearTop(){const nodes=[...this.container.children].filter(n=>!n.hidden);return nodes.length>0&&nodes.slice(0,11).some(n=>n.getBoundingClientRect().bottom>=this.viewport.getBoundingClientRect().top);}
  capture(accept=()=>true){if(!this.viewport.clientHeight)return this.anchor;const top=this.viewport.getBoundingClientRect().top;const nodes=[...this.container.children].filter(n=>!n.hidden&&accept(n));const node=nodes.find(n=>n.getBoundingClientRect().bottom>top)||nodes[nodes.length-1];return node?{key:node.dataset.key,offset:node.getBoundingClientRect().top-top}:null;}
  rowVisible(row){
    if(row.role==='user'||row.role==='assistant'&&row.phase==='commentary'||timelineFailure(row))return true;
    if(row.kind==='reasoning')return this.showReasoning;
    if(row.role==='activity')return this.showProcess;
    return true;
  }
  setVisibility({showReasoning=this.showReasoning,showProcess=this.showProcess,showToolImages=this.showToolImages}){
    if(this.showReasoning===showReasoning&&this.showProcess===showProcess&&this.showToolImages===showToolImages)return;
    const imagesChanged=this.showToolImages!==showToolImages;
    this.showToolImages=showToolImages;
    this.showReasoning=showReasoning;this.showProcess=showProcess;
    const anchor=this.capture(node=>{const row=this.rows.get(node.dataset.key)?.row;return row&&this.rowVisible(row);}),bottom=this.following;
    for(const [key,entry] of this.nodes){
      const row=this.rows.get(key).row;
      if(imagesChanged&&row.attachments?.some(item=>item.type==='toolImage')){
        const open=(entry.node.tagName==='DETAILS'?entry.node:entry.node.querySelector('details.activity'))?.open;
        const node=this.renderRow(row,open);node.dataset.key=key;
        entry.node.replaceWith(node);entry.node=node;
      }
      entry.node.hidden=!this.rowVisible(row);
    }
    this.layoutRows();this.refreshActions();
    this.restore(anchor,bottom);
  }
  jumpBottom(){this.viewport.scrollTop=this.viewport.scrollHeight;this.following=true;this.newer.hidden=true;}
  restore(anchor,bottom=false){
    if(this.abort.signal.aborted||!this.viewport.clientHeight)return;
    this.suppress=true;
    const rowNode=anchor&&this.nodes.get(anchor.key)?.node;
    const node=rowNode?.closest('details.process-group')||rowNode;
    if(bottom)this.jumpBottom();
    else if(node&&!node.hidden)this.viewport.scrollTop+=node.getBoundingClientRect().top-this.viewport.getBoundingClientRect().top-anchor.offset;
    this.lastTop=this.viewport.scrollTop;
    this.anchor=this.capture();
    requestAnimationFrame(()=>this.suppress=false);
  }
  read(action,params={}){return this.request(this.url(action)+'&'+new URLSearchParams(params),undefined,this.abort.signal);}
  async start(){
    if(this.starting||this.abort.signal.aborted)return;
    clearTimeout(this.startRetry);this.starting=true;
    if(this.sequence<0&&this.cacheKey&&recentTimelinePages.has(this.cacheKey)){
      this.apply(recentTimelinePages.get(this.cacheKey),true,false,true);
    }
    this.older.hidden=false;this.older.disabled=true;this.older.textContent=timelineText('正在读取最近内容…');
    try{
      const page=await this.read('timeline',{limit:20});
      if(this.abort.signal.aborted)return;
      this.apply(page,true);this.updates();
    }catch(e){if(this.abort.signal.aborted)return;this.older.disabled=false;this.older.textContent=timelineText('读取失败，点击重试');this.status(e.message);this.startRetry=setTimeout(()=>this.start(),3000);}
    finally{this.starting=false;}
  }
  historyStatus(){this.older.hidden=!this.hasMore;this.older.disabled=this.busy;this.older.textContent=this.busy?timelineText('正在读取更早内容…'):this.retryCount?timelineText('历史加载失败，点击重试'):timelineText('查看更早内容');}
  async loadOlder(count){
    if(this.cached||this.busy||!this.hasMore||this.abort.signal.aborted)return;
    this.busy=true;this.retryCount=0;this.historyStatus();
    try{
      // Keep the user's history intent across a concurrent live reset. A page
      // of hidden tool activity may otherwise leave scrollTop stuck at zero.
      for(let attempt=0;attempt<3;attempt++){
        const generation=this.generation,before=this.before;
        const page=await this.read('timeline',{before,limit:count});
        if(this.abort.signal.aborted)return;
        if(generation!==this.generation)continue;
        if(page.reset||page.epoch!==this.epoch){this.apply(page,true);if(!this.hasMore)return;continue;}
        if(page.hasMore&&(!page.rows.length||page.before===before)){this.retryCount=count;return;}
        const visible=page.rows.some(row=>!this.rows.has(row.key)&&this.rowVisible(row));
        this.apply(page,false,true);
        if(visible||!this.hasMore||!this.active()||!this.nearTop())return;
      }
    }catch(e){if(this.abort.signal.aborted)return;this.retryCount=count;}
    finally{this.busy=false;if(!this.abort.signal.aborted)this.historyStatus();}
  }
  apply(page,reset=false,history=false,cached=false){
    if(this.cached&&!cached){
      // An empty owner-discovery response is not an empty conversation.
      if(!page.rows.length&&page.meta.loadingHistory){
        this.sequence=page.sequence;this.epoch=page.epoch;
        this.renderMeta({...page.meta,files:page.files||[]});this.activityStatus?.update(page.meta);return;
      }
      reset=true;
    }
    this.cached=cached;
    const anchor=this.capture(),bottom=this.following;
    if(reset){this.generation++;window.BridgeMermaidCards?.clearScope(this.mermaidScope);this.mermaidScope=window.BridgeMermaidCards?.createScope();this.rows.clear();this.nodes.clear();this.details.clear();this.files.clear();this.container.replaceChildren();this.epoch=page.epoch;this.retryCount=0;}
    for(const file of page.files||[])this.files.set(file.id,file);
    if((!history&&page.sequence>=this.sequence)||reset){this.sequence=page.sequence;this.meta=page.meta;if(!cached){this.renderMeta({...page.meta,files:[...this.files.values()]});this.activityStatus?.update(page.meta);}}
    if(!history)this.pendingRequests=!cached&&!!page.meta.requests?.length;
    let changed=false;
    for(const row of page.rows){
      const previous=this.rows.get(row.key);
      if(previous&&previous.sequence>page.sequence)continue;
      this.rows.set(row.key,{row,sequence:page.sequence});
      const stamp=JSON.stringify(row),old=this.nodes.get(row.key);
      if(old?.stamp===stamp)continue;
      const open=(old?.node.tagName==='DETAILS'?old.node:old?.node.querySelector('details.activity'))?.open;
      const node=this.renderRow(row,open);node.dataset.key=row.key;
      node.hidden=!this.rowVisible(row);changed=changed||!node.hidden;
      if(old)old.node.replaceWith(node);
      this.nodes.set(row.key,{node,stamp});
    }
    const ordered=[...this.rows.values()].map(x=>x.row).sort((a,b)=>a.order-b.order);
    this.layoutRows(ordered);
    if(reset||history){this.before=page.before;this.hasMore=page.hasMore;this.windowRevision++;}
    this.refreshActions();this.historyStatus();this.restore(anchor,bottom);
    if(!history&&!bottom&&(changed||page.meta.requests?.length)){this.newer.textContent=page.meta.requests?.length?timelineText('有待确认请求 ↓'):timelineText('有新内容 ↓');this.newer.hidden=false;}
    if(!cached&&!history&&this.cacheKey){
      const rows=ordered.slice(-20);
      // Memory-only, bounded and gateway/auth/host/thread scoped by the caller.
      // Cached approvals and access permissions never become actionable state.
      recentTimelinePages.delete(this.cacheKey);
      if(rows.length)recentTimelinePages.set(this.cacheKey,JSON.parse(JSON.stringify({rows,sequence:this.sequence,epoch:this.epoch,
        before:this.epoch+'.'+rows[0].key,hasMore:this.hasMore||ordered.length>20,meta:{requests:[]},files:page.files||[]})));
      while(recentTimelinePages.size>8)recentTimelinePages.delete(recentTimelinePages.keys().next().value);
    }
  }
  layoutRows(ordered=[...this.rows.values()].map(x=>x.row).sort((a,b)=>a.order-b.order)){
    const plan=timelineProcessGroups(ordered.filter(row=>this.rowVisible(row))),roots=[],used=new Set();
    const place=(parent,nodes)=>{
      let position=parent.firstChild;
      for(const node of nodes){if(node===position)position=position.nextSibling;else parent.insertBefore(node,position);}
      const keep=new Set(nodes);for(const node of [...parent.children])if(!keep.has(node))node.remove();
    };
    for(const item of plan){
      if(item.row){roots.push(this.nodes.get(item.row.key).node);continue;}
      const keys=new Set(item.rows.map(row=>row.key));
      // A history page can prepend another run in the same turn. Match by row
      // identity so an expanded group never transfers to that unrelated run.
      const existing=[...this.processGroups].find(([key,group])=>!used.has(key)&&group.node.dataset.turnId===String(item.turnId)&&[...keys].some(rowKey=>group.keys.has(rowKey)));
      let [groupKey,group]=existing||[JSON.stringify([item.turnId,item.rows[0].key]),null];
      if(!group){
        const node=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('div');
        node.className='process-group';body.className='process-group-body';node.append(heading,body);
        group={node,heading,body,keys};this.processGroups.set(groupKey,group);
      }
      group.keys=keys;
      const count=item.rows.filter(row=>row.role==='activity'&&row.kind!=='reasoning').length;
      const issues=item.rows.filter(timelineFailure).length;
      group.node.dataset.key=item.rows[0].key;group.node.dataset.turnId=item.turnId;
      const label=timelineText(count?'执行详情 · {count} 项工具活动':'思考摘要').replace('{count}',count);
      const issueLabel=issues?' · '+timelineText('{count} 项异常').replace('{count}',issues):'';
      if(group.heading.textContent!==label+issueLabel){
        group.heading.textContent=label;
        if(issues){const badge=document.createElement('span');badge.className='process-group-issues';badge.textContent=issueLabel;group.heading.append(badge);}
      }
      group.heading.title=timelineText('按当前已加载的记录汇总');
      place(group.body,item.rows.map(row=>this.nodes.get(row.key).node));roots.push(group.node);used.add(groupKey);
    }
    place(this.container,roots);
    const turns=new Set(ordered.map(row=>String(row.turnId)));
    for(const [key,group] of this.processGroups)if(!used.has(key)){
      group.node.remove();
      // Hiding execution details must not forget a disclosure the user opened.
      if(!turns.has(group.node.dataset.turnId))this.processGroups.delete(key);
    }
  }
  renderRow(row,open){
    const reconnect=timelineReconnectText(row);
    if(reconnect){
      const node=document.createElement('div');node.className='timeline-row reconnect-status';node.textContent=reconnect;
      return node;
    }
    const activity=row.role==='activity'||row.role==='fileChanges',toolImages=activity&&row.attachments?.some(item=>item.type==='toolImage');
    const node=document.createElement(activity&&!toolImages?'details':'div');
    node.className=toolImages?'tool-images timeline-row':activity?'activity timeline-row':'message timeline-row '+row.role;
    if(row.role==='assistant'&&row.phase==='commentary')node.classList.add('progress-message');
    if(timelineFailure(row))node.classList.add('execution-failure');
    const content=toolImages?document.createElement('details'):node;
    if(toolImages){content.className='activity';node.append(content);}
    const heading=document.createElement(activity?'summary':'span');heading.className=activity?'':'who';
    heading.textContent=activity?timelineActivityLabel(row):row.role==='user'?timelineText('你'):row.role==='error'?timelineText('执行错误'):['CODEX',row.model&&[row.model,row.effort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');content.append(heading);
    if(row.fileSummary){
      node.classList.add('edited-files-card');
      heading.replaceChildren();
      const label=document.createElement('span');label.className='edited-files-label';label.textContent=fileChangeLabel(row);
      const stats=document.createElement('span');stats.className='edited-files-stats';
      const added=document.createElement('span');added.className='edited-files-added';added.textContent='+'+row.fileSummary.added;
      const removed=document.createElement('span');removed.className='edited-files-removed';removed.textContent='−'+row.fileSummary.removed;
      stats.append(added,removed);heading.append(label);
      if(row.fileSummary.basis==='recorded'){
        const basis=document.createElement('small');basis.className='edited-files-basis';basis.textContent=timelineText('累计修改');heading.append(basis);
      }
      heading.append(stats);
      const list=document.createElement('ul');list.className='edited-files-list';
      for(const file of row.fileSummary.files){
        const item=document.createElement('li'),path=document.createElement(this.onFile?'button':'span'),counts=document.createElement('span');
        if(this.onFile){path.type='button';path.onclick=()=>this.onFile(file.path);}
        path.textContent=file.path;path.className='edited-files-path';counts.textContent='+'+file.added+' −'+file.removed;counts.className='edited-files-stats';item.append(path,counts);list.append(item);
        if(this.onFile)path.classList.add('plain');
      }
      content.append(list);
      // File cards expand the supplied summary only, including old cached rows
      // which may still advertise a patch body. Never request their details.
      content.open=!!open;
      return node;
    }
    const body=document.createElement(activity?'pre':'div');body.className=activity?'activity-body':'message-body';
    body.__mermaidScope=this.mermaidScope;body.__mermaidIdentity=row.key;
    const more=document.createElement('button');more.className='plain detail-more';more.type='button';
    const cached=this.details.get(row.key);
    if(cached&&cached.version!==row.version)this.details.delete(row.key);
    const paint=()=>{
      const detail=this.details.get(row.key),text=detail?.text??row.text;
      body.replaceChildren();if(activity)body.textContent=text;else this.renderText(body,text,[...this.files.values()],()=>this.fullText(row));
      if(activity)body.hidden=!text;
      more.hidden=detail?detail.next===null:!row.truncated;
      more.textContent=detail?timelineText('继续加载正文'):timelineText('展开完整内容');
    };
    const load=async()=>{
      if(more.disabled||this.abort.signal.aborted)return;
      const prior=this.details.get(row.key);if(prior?.next===null)return;
      more.disabled=true;more.textContent=timelineText('正在读取…');
      try{
        const detail=await this.read('detail',{key:this.epoch+'.'+row.key,offset:prior?.next||0,version:prior?.version||row.version});
        if(this.abort.signal.aborted||!node.isConnected||this.rows.get(row.key)?.row.version!==detail.version)return;
        for(const file of detail.files||[])this.files.set(file.id,file);
        this.details.set(row.key,{version:detail.version,text:(detail.offset?prior?.text||'':'')+detail.text,next:detail.next});paint();
      }catch(e){if(!this.abort.signal.aborted){more.hidden=false;more.textContent=timelineText('读取失败，点击重试');}}
      finally{more.disabled=false;}
    };
    more.onclick=load;content.append(body,more);paint();
    if(row.role==='user'||row.role==='assistant'&&row.phase!=='commentary'){
      const actions=document.createElement('div');actions.className='message-actions';
      const copy=document.createElement('button');copy.type='button';copy.className='plain message-copy';copy.textContent=timelineText('复制');copy.onclick=()=>window.BridgeClipboard?.copy(()=>this.fullText(row),copy);actions.append(copy);node.append(actions);
      const quote=document.createElement('button');quote.type='button';quote.className='plain message-quote';quote.textContent=timelineText('引用');quote.onclick=()=>node.dispatchEvent(new CustomEvent('bridge-compose-quote',{bubbles:true,detail:{getText:()=>this.fullText(row),source:row.key}}));actions.append(quote);
      if(this.compactActions){
        for(const button of actions.children)this.labelAction(button);
        // Observe only action labels, including the native clipboard's busy/success feedback.
        this.actionLabelsObserver.observe(actions,{subtree:true,childList:true,characterData:true});
      }
    }
    if(row.attachments?.length){
      const attachments=document.createElement('div');attachments.className='timeline-attachments';
      for(const item of row.attachments){
        if(item.type==='toolImage'&&!this.showToolImages)continue;
        if(['localImage','image','toolImage'].includes(item.type)&&(item.uploadId||item.desktopId)){
          const source=item.uploadId
            ?this.url('uploads/'+encodeURIComponent(item.uploadId)+'/preview')
            :this.url('desktop-images/'+encodeURIComponent(item.desktopId));
          const original=item.uploadId
            ?source+'&variant=original'
            :source;
          const link=document.createElement('a');link.href=original;link.target='_blank';link.rel='noopener';
          link.dataset.imagePreview=original;link.dataset.imageName=item.name||timelineText('图片附件');
          const image=document.createElement('img');image.className='attachment-image';image.alt=item.name||timelineText('图片附件');
          image.loading='lazy';image.decoding='async';image.src=source;
          image.onerror=()=>link.remove();link.append(image);attachments.append(link);
        }
      }
      const attachment=document.createElement('small');attachment.className='muted';
      attachment.textContent=timelineText('附件：')+row.attachments.map(a=>a.name||a.type).join('、');
      attachments.append(attachment);node.append(attachments);
    }
    if(activity){content.open=!!open;content.ontoggle=()=>{if(content.open&&!this.details.has(row.key))load();};}
    return node;
  }
  fullText(row){
    const valid=()=>!this.abort.signal.aborted&&this.rows.get(row.key)?.row.version===row.version;
    if(!valid())return Promise.reject(Error(timelineText('消息内容已变化，请重新打开编辑')));
    if(!row.truncated)return row.text;
    return (async()=>{
      let text='',offset=0;
      do{
        const detail=await this.read('detail',{key:this.epoch+'.'+row.key,offset,version:row.version});
        if(!valid()||detail.version!==row.version||detail.offset!==offset||detail.key!==row.key)throw Error(timelineText('消息内容已变化，请重新打开编辑'));
        text+=detail.text;
        if(detail.next===null)return text;
        if(detail.next<=offset)throw Error(timelineText('读取完整正文失败，请重试'));
        offset=detail.next;
      }while(true);
    })();
  }
  labelAction(button){
    if(!this.compactActions)return;
    button.title=button.textContent;button.setAttribute('aria-label',button.textContent);
    button.dataset.feedback=button.textContent===timelineText('已复制')?'copied':button.textContent===timelineText('正在读取…')?'busy':'';
  }
  refreshActions(){
    this.actionLabelsObserver?.disconnect();
    for(const [key,{node}] of this.nodes){
      const row=this.rows.get(key)?.row,bar=node.querySelector('.message-actions');if(!bar||!row)continue;
      if(this.compactActions){for(const button of bar.children)this.labelAction(button);this.actionLabelsObserver.observe(bar,{subtree:true,childList:true,characterData:true});}
      if(!this.onAction)continue;
      const add=(action,label,disabled)=>{const cls=action==='fork'?'message-fork':'message-edit';let b=bar.querySelector('.'+cls);if(!b){b=document.createElement('button');b.type='button';b.className='plain '+cls;bar.append(b);}b.textContent=timelineText(label);this.labelAction(b);b.disabled=disabled;b.onclick=()=>this.onAction(action,row,this);};
      for(const action of bar.querySelectorAll('.message-edit,.message-fork'))action.hidden=!this.canEdit();
      if(row.editable&&this.canEdit()){const latest=this.meta?.latestUserTurnId===row.turnId;add(latest?'edit':'edit-fork',latest?'编辑并重新发送':'编辑并新建分支',row.turnStatus==='inProgress'||latest&&this.meta?.status==='active');}
      if(row.forkable&&this.canEdit())add('fork','从这里分支',false);
    }
  }
  relabel(){
    if(!this.cached)this.activityStatus?.update(this.meta);
    this.layoutRows();
    this.refreshActions();
    this.container.querySelectorAll('.message-copy').forEach(n=>n.textContent=timelineText('复制'));
    this.container.querySelectorAll('.message-quote').forEach(n=>n.textContent=timelineText('引用'));
    this.container.querySelectorAll('.message-actions button').forEach(n=>this.labelAction(n));
    this.container.querySelectorAll('.code-copy').forEach(n=>n.textContent=timelineText('复制代码'));
    this.historyStatus();
    for(const [key,entry] of this.nodes){
      const row=this.rows.get(key)?.row;if(!row)continue;
      const reconnect=timelineReconnectText(row);
      if(reconnect){entry.node.textContent=reconnect;continue;}
      const node=entry.node,heading=(row.role==='activity'||row.role==='fileChanges')?(node.tagName==='DETAILS'?node.firstElementChild:node.querySelector('details.activity > summary')):node.firstElementChild;
      if(row.fileSummary){const label=node.querySelector('.edited-files-label');if(label)label.textContent=fileChangeLabel(row);const basis=node.querySelector('.edited-files-basis');if(basis)basis.textContent=timelineText('累计修改');}
      else if(heading)heading.textContent=(row.role==='activity'||row.role==='fileChanges')?timelineActivityLabel(row):row.role==='user'?timelineText('你'):row.role==='error'?timelineText('执行错误'):['CODEX',row.model&&[row.model,row.effort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
      const more=node.querySelector('.detail-more');
      if(more&&!more.disabled)more.textContent=timelineText(this.details.has(key)?'继续加载正文':'展开完整内容');
      const attachment=node.querySelector('.timeline-attachments small.muted');
      if(attachment)attachment.textContent=timelineText('附件：')+row.attachments.map(a=>a.name||a.type).join('、');
    }
    this.newer.textContent=timelineText(this.pendingRequests?'有待确认请求 ↓':'有新内容 ↓');
  }
  async updates(){
    while(!this.abort.signal.aborted){
      if(!this.active()){await this.pause(1000);continue;}
      try{
        const generation=this.generation,windowRevision=this.windowRevision,sequence=this.sequence;
        const page=await this.read('changes',{after:this.sequence,epoch:this.epoch,start:this.before||''});
        if(this.abort.signal.aborted)return;
        if(generation!==this.generation||windowRevision!==this.windowRevision)continue;
        // History may have expanded the window while this poll was in flight.
        // Polls never replace the oldest loaded cursor.
        this.apply(page,!!page.reset);
        // The server already waits for revisions. Re-arm it immediately after
        // an event; throttle only unchanged responses from older gateways.
        if(this.sequence===sequence)await this.pause(200);
      }catch(e){if(this.abort.signal.aborted)return;this.status(timelineText('重新连接中'));await this.pause(3000);}
    }
  }
  pause(ms){return new Promise(resolve=>{const done=()=>{clearTimeout(timer);this.abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);this.abort.signal.addEventListener('abort',done,{once:true});});}
}
