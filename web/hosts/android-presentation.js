'use strict';
// Reparent original controls so handlers, request IDs, drafts and native boundaries survive.
if(typeof document!=='undefined'&&typeof BridgeHost!=='undefined'&&BridgeHost.kind()==='android')(()=>{
  function adapt({chat,composer,tools,toggle,message,attach,actions,modes=[],model,send,stop,workspace}){
    if(!chat||!composer||!tools||!message||composer.dataset.androidPresentation)return;
    composer.dataset.androidPresentation='compact';composer.classList.add('android-composer');chat.classList.add('android-chat');
    model?.classList.add('android-model-button');message.classList.add('android-message-textarea');send?.classList.add('android-send');stop?.classList.add('android-stop');
    for(const button of [send,stop])if(button){const label=button.textContent;button.setAttribute('aria-label',label);button.title=label;}
    const toolbar=document.createElement('div');toolbar.className='android-composer-toolbar';tools.before(toolbar);toolbar.append(tools);if(toggle)toolbar.append(toggle);
    for(const mode of modes.filter(Boolean))tools.append(mode);
    tools.setAttribute('aria-label',BridgeI18n.t('会话工具，可左右滑动'));
    const input=document.createElement('div');input.className='android-message-input';message.before(input);
    if(attach)input.append(attach);input.append(message);if(actions)input.append(actions);
    const head=chat.querySelector('.chat-head');
    if(head&&workspace){
      const button=document.createElement('button');button.type='button';button.className='android-workspace-button icon-button';button.dataset.i18nAriaLabel='工作台';button.dataset.i18nTitle='文件、Git、终端';
      button.setAttribute('aria-label',BridgeI18n.t('工作台'));button.title=BridgeI18n.t('文件、Git、终端');
      button.innerHTML='<svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 10h18M10 10v11"/></svg>';
      button.onclick=workspace;head.insertBefore(button,head.querySelector('.appearance-button'));
    }
  }
  window.BridgeAndroidPresentation={adapt};
  const get=id=>document.getElementById(id);
  adapt({chat:get('chat'),composer:get('composer'),tools:document.querySelector('#composer .composer-tools'),toggle:get('composer-toggle'),message:get('message'),attach:get('attach-button'),actions:document.querySelector('#composer .compose-actions'),modes:[get('send-mode'),get('work-mode')],model:get('model-button'),send:get('send'),stop:get('stop'),workspace:()=>window.BridgeWorkbench?.newTab()});
  document.dispatchEvent(new CustomEvent('bridge-android-presentation'));
  window.BridgePresentation?.resizeMessage();
})();
