'use strict';

class ListSync {
  constructor({root,status,refresh,visible,ready,automatic=true,onState=()=>{},hasRows=()=>root.children?.length>0}) {
    Object.assign(this,{root,status,refresh,visible,ready,automatic,onState,hasRows});this.retryable=true;this.lastSuccess=0;this.failures=[];this.busy=false;this.frame=0;this.revision=0;this.automaticFailures=0;this.failureVisible=false;
    status.onclick=()=>this.update(true);
    const resume=()=>{if(!document.hidden&&this.retryable)this.update();};
    if(automatic){document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(this.timer);this.readTask?.controller.abort();}else{resume();this.schedule();}});window.addEventListener('focus',resume);window.addEventListener('online',resume);}
    root.addEventListener('touchstart',event=>{
      if(this.start)this.endPull(true);
      this.start=!this.busy&&!document.hidden&&visible()&&ready()&&root.scrollTop<=0&&event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;this.distance=0;
    },{passive:true});
    root.addEventListener('touchmove',event=>{
      if(!this.start)return;
      if(event.touches.length!==1){this.endPull(true);return;}
      const dx=event.touches[0].clientX-this.start.x,dy=event.touches[0].clientY-this.start.y;
      if(Math.abs(dx)>Math.max(10,Math.abs(dy))||dy<0){this.endPull(true);return;}
      this.distance=dy;
      if(dy>10)event.preventDefault();
      if(!this.frame)this.frame=requestAnimationFrame(()=>{
        this.frame=0;
        if(this.distance<=10){this.setPull(0);this.hide();return;}
        const pull=Math.min(64,this.distance*.5);
        this.setPull(pull,true);this.show(this.distance>=72?'松开刷新聊天列表':'下拉刷新聊天列表',pull);
      });
    },{passive:false});
    root.addEventListener('touchend',()=>this.endPull());
    root.addEventListener('touchcancel',()=>this.endPull(true));
    if(automatic)this.schedule();
  }
  setPull(distance,dragging=false){this.root.classList.toggle('list-pulling',dragging);this.root.style.setProperty('--list-pull',distance+'px');}
  show(text,pull=0){
    clearTimeout(this.hideTimer);clearTimeout(this.dismissTimer);
    const translated=BridgeI18n.t(text);if(this.status.textContent!==translated)this.status.textContent=translated;
    if(this.failureVisible)this.status.classList.add('list-sync-failure');else this.status.classList.remove('list-sync-failure');
    this.status.hidden=false;this.status.style.setProperty('--list-hint-y',Math.max(4,(pull-28)/2)+'px');this.status.classList.add('list-sync-visible');
  }
  hide(){
    clearTimeout(this.hideTimer);clearTimeout(this.dismissTimer);this.status.classList.remove('list-sync-visible');this.status.classList.remove('list-sync-failure');
    this.dismissTimer=setTimeout(()=>this.status.hidden=true,160);
  }
  endPull(cancel=false){
    if(!this.start)return;
    const refresh=!cancel&&this.distance>=72;this.start=null;this.distance=0;
    if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;
    if(refresh)this.update(true);else{this.setPull(0);this.hide();}
  }
  reset(){
    this.revision++;this.readTask?.controller.abort();this.readTask=null;this.busy=false;this.updateTask=null;
    this.automaticFailures=0;this.failureVisible=false;this.recoveredWhileBusy=false;this.retryable=true;this.lastSuccess=0;this.failures=[];
    this.endPull(true);this.setPull(0);clearTimeout(this.timer);clearTimeout(this.hideTimer);clearTimeout(this.dismissTimer);
    this.status.classList.remove('list-sync-visible');this.status.classList.remove('list-sync-failure');this.status.hidden=true;this.onState(this);this.schedule();
  }
  diagnostics(){return {lastSuccess:this.lastSuccess,consecutiveFailures:this.automaticFailures,retrying:this.retryable&&this.automaticFailures>0,recent:this.failures.map(row=>({...row}))};}
  acknowledgeSuccess(){
    this.lastSuccess=Date.now();this.automaticFailures=0;this.retryable=true;
    if(this.failureVisible){this.failureVisible=false;if(this.busy)this.recoveredWhileBusy=true;else this.hide();}
    this.onState(this);this.schedule();
  }
  reportFailure(error,explicit=false){
    if(error?.status===401){this.automaticFailures=0;this.failureVisible=false;this.retryable=false;clearTimeout(this.timer);this.hide();this.onState(this);return;}
    if(error?.name==='AbortError')return;
    this.automaticFailures++;
    this.retryable=![400,403,404,405,409,422].includes(error?.status);
    const hosts=error?.hostErrors||[{}];
    for(const host of hosts)this.failures.push({at:Date.now(),path:'/api/sessions',host:host.host||'',status:host.status||error?.status||0,kind:host.kind||error?.name||'Error',durationMs:host.durationMs||0,foreground:!document.hidden});
    this.failures=this.failures.slice(-20);
    if(explicit||this.automaticFailures>=3||!this.hasRows()||!this.retryable){
      this.failureVisible=true;
      let text=this.retryable?'连接暂时不稳定，聊天列表尚未更新，点击重试':'聊天列表读取失败，请检查连接权限后重试';
      if(this.lastSuccess)text=BridgeI18n.t(text)+' · '+BridgeI18n.t('上次更新')+' '+new Date(this.lastSuccess).toLocaleTimeString();
      this.show(text);
    }
    this.onState(this);this.schedule();
  }
  // This coordinator accepts list reads only. Never submit messages or approvals here.
  read(key,work){
    if(this.readTask?.key===key)return this.readTask.promise;
    this.readTask?.controller.abort();
    const task={key,controller:new AbortController()};this.readTask=task;
    task.promise=(async()=>{
      try{const result=await work(task.controller.signal);if(this.readTask!==task||task.controller.signal.aborted)return false;if(result!==false)this.acknowledgeSuccess();return result;}
      catch(error){if(this.readTask===task&&!task.controller.signal.aborted)this.reportFailure(error,this.explicitUpdate===true);return false;}
      finally{if(this.readTask===task){this.readTask=null;if(!this.busy)this.explicitUpdate=false;}}
    })();
    return task.promise;
  }
  schedule(){
    clearTimeout(this.timer);if(!this.automatic||document.hidden||!this.retryable)return;
    const delay=this.automaticFailures?[1000,3000,8000,15000,30000][Math.min(this.automaticFailures-1,4)]:15000;
    this.timer=setTimeout(async()=>{await this.update();this.schedule();},delay);
  }
  async update(explicit=false){
    if(this.start)return;
    if(this.busy)return this.updateTask;
    if(this.readTask){if(explicit)this.explicitUpdate=true;return this.readTask.promise;}
    if(document.hidden||!this.visible()||!this.ready()||(!explicit&&this.root.scrollTop>24)){
      if(explicit){this.setPull(0);if(!this.failureVisible)this.hide();}return;
    }
    this.busy=true;this.explicitUpdate=explicit;this.recoveredWhileBusy=false;const revision=this.revision;
    if(explicit){this.setPull(32);this.show('正在刷新聊天列表…',32);}
    const task=(async()=>{
      try{
        const updated=await this.refresh();if(revision!==this.revision)return;
        if(updated===false){this.setPull(0);if(!this.failureVisible)this.hide();return;}
        const hadFailure=this.failureVisible;this.acknowledgeSuccess();
        if(explicit){this.setPull(0);this.show('聊天列表已更新');this.hideTimer=setTimeout(()=>this.hide(),500);}else if(hadFailure||this.recoveredWhileBusy)this.hide();
      }catch(error){if(revision===this.revision){this.setPull(0);this.reportFailure(error,explicit);}}
      finally{if(revision===this.revision){this.busy=false;this.explicitUpdate=false;this.updateTask=null;this.recoveredWhileBusy=false;this.schedule();}}
    })();this.updateTask=task;return task;
  }
}

// Desired display preferences only. Never use this retry loop for native mutations.
class LocalSessionPins {
  constructor({send,onChange=()=>{},storage=localStorage,newId,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{send,onChange,storage,newId,setTimer,clearTimer});this.generation=0;this.epoch=0;this.scope='';this.inflight=new Map();this.timers=new Map();this.barriers=new Map();
    this.clientId=null;
    const resume=()=>{if(!document.hidden)this.flush(true);};window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  }
  key(identity){return JSON.stringify([identity.provider,identity.host||'local',identity.id]);}
  capture(){return {scope:this.scope,generation:this.generation,epoch:this.epoch};}
  current(token){return !!this.scope&&token?.scope===this.scope&&token.generation===this.generation;}
  suspend(){for(const timer of this.timers.values())this.clearTimer(timer);this.timers.clear();this.scope='';this.generation++;this.inflight=new Map();}
  bind(scope){
    this.suspend();if(!scope)return;this.clientId=this.storage.getItem('bridge-session-pins-client');this.scope=scope;this.storageKey='bridge-session-pins:'+scope;this.barriers=new Map();
    try{this.state=JSON.parse(this.storage.getItem(this.storageKey)||'null');}catch{this.state=null;}
    if(!this.state||!Number.isSafeInteger(this.state.clock)||!this.state.entries||typeof this.state.entries!=='object')this.state={clock:0,entries:{}};
    for(const entry of Object.values(this.state.entries))entry.attempts=0;
    this.onChange();this.flush();
  }
  save(){this.storage.setItem(this.storageKey,JSON.stringify(this.state));}
  value(identity,server){const entry=this.scope&&this.state.entries[this.key(identity)];return entry?entry.pinned:!!server;}
  pending(identity){return !!(this.scope&&this.state.entries[this.key(identity)]?.pending);}
  set(identity,pinned){
    if(!this.scope)throw Error('登录状态暂不可用');
    try{if(!this.clientId){const client=this.storage.getItem('bridge-session-pins-client')||this.newId();this.storage.setItem('bridge-session-pins-client',client);this.clientId=client;}}catch{throw Error('无法保存此设备的置顶设置');}
    const key=this.key(identity),previous=this.state.entries[key];
    this.state.clock++;this.epoch++;this.state.entries[key]={identity:{provider:identity.provider,host:identity.host||'local',id:identity.id},pinned:!!pinned,revision:this.state.clock,pending:true,attempts:0};
    try{this.save();}catch(error){if(previous)this.state.entries[key]=previous;else delete this.state.entries[key];throw Error('无法保存此设备的置顶设置');}
    if(this.timers.has(key)){this.clearTimer(this.timers.get(key));this.timers.delete(key);}
    this.onChange();this.flushKey(key);
  }
  observe(identity,server,token){
    if(!this.current(token))return;
    const key=this.key(identity),entry=this.state.entries[key];
    if(entry&&!entry.pending&&token.epoch>=(this.barriers.get(key)||0)){delete this.state.entries[key];this.barriers.delete(key);this.save();}
  }
  flush(resume=false){if(!this.scope||document.hidden||typeof navigator!=='undefined'&&navigator.onLine===false)return;if(resume){for(const timer of this.timers.values())this.clearTimer(timer);this.timers.clear();}for(const key of Object.keys(this.state.entries))this.flushKey(key);}
  flushKey(key){
    if(!this.scope||this.inflight.has(key)||this.timers.has(key)||typeof navigator!=='undefined'&&navigator.onLine===false)return;
    const entry=this.state.entries[key];if(!entry?.pending)return;
    const token=this.capture(),revision=entry.revision,pinned=entry.pinned,flights=this.inflight;flights.set(key,true);
    Promise.resolve().then(()=>{if(this.current(token)&&this.state.entries[key]?.revision===revision)return this.send(entry.identity,{pinned,clientId:this.clientId,revision},token);}).then(result=>{
      if(!this.current(token)||this.state.entries[key]?.revision!==revision)return;
      if(result.id!==entry.identity.id||result.clientId!==this.clientId||!Number.isSafeInteger(result.revision)||result.revision<revision)throw Error('置顶同步结果不匹配');
      if(result.revision>revision||result.bridgePinned!==pinned){this.state.clock=Math.max(this.state.clock,result.revision)+1;entry.revision=this.state.clock;this.save();return;}
      entry.pending=false;entry.attempts=0;this.barriers.set(key,++this.epoch);this.save();this.onChange();
    }).catch(error=>{
      if(!this.current(token)||this.state.entries[key]?.revision!==revision)return;
      entry.attempts=(entry.attempts||0)+1;
      if([400,401,403,404].includes(error?.status))return;
      const delay=[5000,15000,60000][Math.min(entry.attempts-1,2)];
      this.timers.set(key,this.setTimer(()=>{this.timers.delete(key);if(this.current(token))this.flushKey(key);},delay));
    }).finally(()=>{flights.delete(key);if(this.current(token)&&this.state.entries[key]?.pending&&this.state.entries[key].revision!==revision)this.flushKey(key);});
  }
}
