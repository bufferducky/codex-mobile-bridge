// Production Android page and synthetic APIs only; never sends a chat or approval.
async function runListRecoveryTests(){
 const sync=window.BridgeListSync,originalFetch=window.fetch,checks=[];
 const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async fn=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Recovery check timed out');};
 let failing=false,held=false,release,reads=0;
 window.fetch=async(url,options)=>{
  const parsed=new URL(url,location.href);
  if(parsed.pathname==='/api/sessions'&&parsed.searchParams.get('scope')==='host'&&parsed.searchParams.get('host')==='local'){
   reads++;if(failing)throw TypeError('Failed to fetch');
   if(held)await new Promise((resolve,reject)=>{release=resolve;options.signal.addEventListener('abort',()=>reject(new DOMException('Superseded','AbortError')),{once:true});});
  }
  return originalFetch(url,options);
 };
 const restore=async(final=false)=>{failing=false;held=false;if(final)window.fetch=originalFetch;await loadList(true);await new Promise(r=>setTimeout(r,200));check(!sync.failureVisible&&document.getElementById('host-errors').hidden,'Authoritative recovery clears the hint and diagnostics');};
 try{
  await loadList(true);const before=listRows.map(row=>row.id).join('|');
  failing=true;await loadList(true);check(listRows.map(row=>row.id).join('|')===before,'One transport failure retains the previous chats');
  check(sync.automaticFailures===1&&sync.status.hidden&&document.getElementById('host-errors').hidden,'A single failure is quiet in both hint surfaces');
  await loadList(true);await loadList(true);check(sync.failureVisible&&sync.status.textContent.includes('连接暂时不稳定'),'Three failures produce a Chinese retry control');
  check(sync.status.textContent.includes('上次更新'),'Failure feedback includes the last successful refresh time');
  check(document.querySelector('#host-errors details summary')?.textContent==='连接详情','Persistent failures expose expandable connection details');
  const text=document.getElementById('host-errors').textContent;
  check(text.includes('/api/sessions')&&!text.includes('Failed to fetch')&&!text.includes('csrf'),'Diagnostics contain endpoint and error type without raw request secrets');
  const bounds=sync.status.getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth+1,'The wrapped hint fits the Android viewport');check(document.getElementById('sessions').getBoundingClientRect().top>=bounds.bottom,'A persistent hint reserves space instead of covering the first chat');
  await restore();
  held=true;reads=0;const first=loadList(true),second=loadList(true);await wait(()=>!!release);check(reads===1,'Two refresh callers share one network request');held=false;release();await Promise.all([first,second]);
  failing=true;reads=0;await loadList(true);await wait(()=>reads>=3);check(reads===3&&sync.failureVisible,'Automatic 1-second and 3-second retries reach the sustained-failure state');
  failing=false;window.dispatchEvent(new Event('online'));await wait(()=>sync.automaticFailures===0);await new Promise(r=>setTimeout(r,200));check(!sync.failureVisible,'Online recovery refreshes the same list and clears failure state');
  failing=true;await loadList(true);await loadList(true);await loadList(true);document.querySelector('#host-errors details').open=true;
  window.finishListRecovery=()=>restore(true);
  return {passed:checks.length,checks,host:BridgeHost.kind(),viewport:innerWidth,nativeWrites:0};
 }catch(error){await restore(true);throw error;}
}
