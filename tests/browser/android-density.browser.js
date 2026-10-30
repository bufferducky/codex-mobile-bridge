// Production timeline, synthetic rows only; never writes to a real chat or clipboard.
async function runAndroidDensityChecks(){
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const root=document.createElement('section');root.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--page);overflow:auto;padding:12px 20px';
  const viewport=document.createElement('div'),messages=document.createElement('div'),older=document.createElement('button'),newer=document.createElement('button');
  viewport.className='timeline';viewport.style.cssText='height:100%;overflow:auto;padding:0';viewport.append(messages,older,newer);root.append(viewport);document.body.append(root);
  let copied,quoted,action,reads=0;const originalClipboard=window.BridgeClipboard;
  window.BridgeClipboard={copy:(getText,button)=>{copied=getText();button.textContent=timelineText('已复制');}};
  messages.addEventListener('bridge-compose-quote',event=>quoted=event.detail.getText());
  const timeline=new ChatTimeline({elements:{viewport,container:messages,older,newer},url:()=>'/synthetic',request:async()=>{reads++;throw Error('Unexpected request');},renderMeta(){},renderText:renderMarkdown,status(){},onAction:(kind,row)=>action={kind,key:row.key}});
  const rows=[
    {key:'user',turnId:'first',order:0,role:'user',text:'请压缩信息密度，保留引用与编辑分支。',editable:true,turnStatus:'completed',version:'v1'},
    {key:'tool',turnId:'first',order:1,role:'activity',kind:'commandExecution',status:'completed',text:'synthetic tool',version:'v1'},
    {key:'answer',turnId:'first',order:2,role:'assistant',phase:'final_answer',model:'gpt-6.1-sol',effort:'high',text:'正文直接显示。\n\n复制和引用改成图标，执行详情保持紧凑。',forkable:true,version:'v1'},
    {key:'latest',turnId:'latest',order:3,role:'user',text:'再检查一次。',editable:true,turnStatus:'completed',version:'v1'}
  ];
  const page=(sequence,items=rows,meta={})=>({sequence,epoch:'density',rows:items,files:[],hasMore:false,meta:{status:'idle',connected:true,requests:[],latestUserTurnId:'latest',...meta}});
  try{
    check(BridgeHost.kind()==='android','Fixture uses Android host identity');
    timeline.apply(page(1),true);await frame();await frame();
    const user=timeline.nodes.get('user').node,answer=timeline.nodes.get('answer').node,latest=timeline.nodes.get('latest').node;
    check(getComputedStyle(answer.querySelector('.who')).display==='none','Repeated Codex/model/effort header is hidden');
    check(answer.querySelector('.who').textContent.includes('gpt-6.1-sol'),'Original model metadata is retained');
    const userBar=user.querySelector('.message-actions'),answerBar=answer.querySelector('.message-actions');
    check(!messages.querySelector('.message-actions-menu'),'No expand button or extra action menu remains');
    check(userBar.parentElement===user&&answerBar.parentElement===answer,'Original action buttons remain directly below their message');
    check(userBar.getBoundingClientRect().height<=32,'Direct icon row stays vertically compact');
    const buttons=[...messages.querySelectorAll('.message-actions button')];
    check(buttons.every(button=>button.getBoundingClientRect().width>=32&&button.getBoundingClientRect().height>=32),'Small glyphs retain separate usable click targets');
    check(buttons.every(button=>getComputedStyle(button,'::before').width==='14px'&&getComputedStyle(button,'::before').maskImage.includes('data:image/svg+xml')),'Each action has a small visible icon');
    check(buttons.every(button=>button.getAttribute('aria-label')===button.textContent&&button.title===button.textContent),'Original action names remain accessible without visible text labels');
    check(buttons.every(button=>getComputedStyle(button).fontSize==='0px'),'Long action names reserve no extra text space');
    check(answer.querySelector('.message-body').getBoundingClientRect().right<=messages.getBoundingClientRect().right,'Icons do not overlap or narrow the message text');
    const group=messages.querySelector('.process-group');
    check(parseFloat(getComputedStyle(group).marginBottom)<=4,'Tool group bottom spacing is compact');
    check(group.querySelector('summary').getBoundingClientRect().height<=28,'Tool disclosure is a compact line');
    check(parseFloat(getComputedStyle(answer).marginTop)<=4,'No oversized gap after execution details');
    const copy=userBar.querySelector('.message-copy');copy.click();await frame();
    check(copied===rows[0].text,'Copy receives the original message text');
    check(copy.dataset.feedback==='copied'&&copy.getAttribute('aria-label')===timelineText('已复制'),'Clipboard acknowledgement updates the icon and accessible label');
    copy.textContent=timelineText('复制');await frame();check(copy.dataset.feedback==='','Copy feedback clears when the original label is restored');
    answerBar.querySelector('.message-quote').click();check(quoted===rows[2].text,'Quote retains the original message context');
    userBar.querySelector('.message-edit').click();check(action?.kind==='edit-fork'&&action.key==='user','Earlier user message still offers edit in a new branch');
    latest.querySelector('.message-edit').click();check(action?.kind==='edit'&&action.key==='latest','Latest user message still offers edit and resend');
    answerBar.querySelector('.message-fork').click();check(action?.kind==='fork'&&action.key==='answer','Assistant reply retains its branch action');
    timeline.apply(page(2,[],{status:'active'}));check(latest.querySelector('.message-edit').disabled,'Running-state edit restrictions still apply');
    const textNode=answer.querySelector('.message-body');timeline.apply(page(3,[]));
    check(answer.querySelector('.message-body')===textNode,'Metadata updates retain the original text DOM');
    timeline.relabel();check(answerBar.querySelector('.message-quote').getAttribute('aria-label')===timelineText('引用'),'Icon labels follow the selected language');
    const positions=[...userBar.children].map(button=>button.getBoundingClientRect());
    check(positions.every((rect,index)=>index===0||rect.left>=positions[index-1].right),'Adjacent icon click areas do not overlap');
    check(reads===0,'Icons and metadata changes do not fetch message bodies');
    check(root.scrollWidth<=root.clientWidth&&viewport.scrollWidth<=viewport.clientWidth,'Dense view fits the screen');
    return {passed:checks.length,width:innerWidth,checks};
  }finally{timeline.dispose();root.remove();window.BridgeClipboard=originalClipboard;}
}
