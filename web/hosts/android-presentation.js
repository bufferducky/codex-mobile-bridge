'use strict';
// Reparent existing controls, keeping their handlers, request identities,
// drafts, attachments and native approval/navigation boundaries intact.
if(typeof document!=='undefined'&&BridgeHost.kind()==='android')(()=>{
  const get=id=>document.getElementById(id),tools=document.querySelector('#composer .composer-tools');
  if(!tools)return;
  const toolbar=document.createElement('div');toolbar.className='android-composer-toolbar';tools.before(toolbar);toolbar.append(tools,get('composer-toggle'));
  tools.insertBefore(get('send-mode'),get('notify-button'));tools.insertBefore(get('work-mode'),get('notify-button'));
  tools.setAttribute('aria-label',BridgeI18n.t('会话工具，可左右滑动'));
  const input=document.createElement('div');input.className='android-message-input';get('message').before(input);
  input.append(get('attach-button'),get('message'),document.querySelector('#composer .compose-actions'));
  const head=document.querySelector('#chat .chat-head'),workspace=document.createElement('button');
  workspace.type='button';workspace.className='android-workspace-button icon-button';workspace.dataset.i18nAriaLabel='工作台';workspace.dataset.i18nTitle='文件、Git、终端';
  workspace.setAttribute('aria-label',BridgeI18n.t('工作台'));workspace.title=BridgeI18n.t('文件、Git、终端');
  workspace.innerHTML='<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 10h18M10 10v11"/></svg>';
  workspace.onclick=()=>window.BridgeWorkbench?.newTab();head.insertBefore(workspace,head.querySelector('.appearance-button'));
  window.BridgePresentation?.resizeMessage();
})();
