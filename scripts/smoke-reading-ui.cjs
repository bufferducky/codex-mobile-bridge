'use strict';
// Production rendering, synthetic content, a fresh Chromium profile; no real gateway.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const browser=process.env.CMB_BROWSER||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome');
  assert.ok(fs.existsSync(browser),'Set CMB_BROWSER to a Chromium executable');
  fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});
  const temporary=fs.mkdtempSync(path.join(root,'.tmp','reading-browser-'));
  const assets=JSON.parse(fs.readFileSync(path.join(root,'web/assets.json')));
  const scripts=['/host.js','/i18n.js','/message-actions.js','/vendor/markdown-it.min.js','/vendor/katex/katex.min.js','/vendor/texmath.js','/markdown.js','/vendor/prism/source-view.min.js','/timeline.js'];
  const server=http.createServer((req,res)=>{
    const route=new URL(req.url,'http://fixture.invalid').pathname;
    if(route==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+['/style.css','/presentation.css','/workbench.css'].map(url=>'<link rel="stylesheet" href="'+url+'">').join('')+'</head><body>'+scripts.map(url=>'<script src="'+url+'"></script>').join('')+'</body></html>');return;
    }
    const files=assets[route]||(/^\/vendor\/[a-zA-Z0-9/_.-]+$/.test(route)?route.slice(1):null);
    if(!files){res.writeHead(404);res.end();return;}
    try{res.setHeader('Content-Type',route.endsWith('.css')?'text/css':'text/javascript');res.end(Buffer.concat([].concat(files).map(file=>fs.readFileSync(path.join(root,'web',file)))));}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--disable-extensions','--remote-debugging-port='+port,'--user-data-dir='+temporary,'about:blank'],{stdio:'ignore'});
  let socket;const errors=[];
  try{
    let target;
    for(let i=0;i<100&&!target;i++){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(tab=>tab.type==='page');}catch{}if(!target)await delay(100);}
    assert.ok(target,'Chromium failed to start');socket=new WebSocket(target.webSocketDebuggerUrl);const pending=new Map();let next=0;
    socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);const item=pending.get(value.id);if(item){pending.delete(value.id);value.error?item.reject(Error(value.error.message)):item.resolve(value.result);}});
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
    await call('Runtime.enable');await call('Page.enable');
    const results=[];
    for(const host of ['browser','android'])for(const width of [320,390,430,844,1440]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:host==='android'});
      await call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36'+(host==='android'?' BridgeMobile/0.1-Android':'')});
      await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
      let ready=false;for(let i=0;i<100&&!ready;i++){ready=await evaluate('document.readyState==="complete"&&typeof renderMarkdown==="function"&&typeof ChatTimeline==="function"');if(!ready)await delay(50);}assert.ok(ready,'Rendering scripts did not load');
      if(host==='android')await evaluate('document.documentElement.classList.add("bridge-mobile");true');
      const highlight=await evaluate(fs.readFileSync(path.join(root,'tests/browser/code-highlight.browser.js'),'utf8'));
      await evaluate(fs.readFileSync(path.join(root,'tests/browser/progress-timeline.browser.js'),'utf8'));
      await evaluate(fs.readFileSync(path.join(root,'tests/browser/live-activity.browser.js'),'utf8'));
      for(const language of ['zh','en']){
        await evaluate('BridgeI18n.setLanguage('+JSON.stringify(language)+');true');
        const progress=await evaluate('runProgressTimelineChecks()'),live=await evaluate('runLiveActivityChecks()');results.push({host,width,language,highlightChecks:highlight.passed,progressChecks:progress.passed,liveChecks:live.passed});
      }
    }
    assert.deepEqual(errors,[],'Production renderers must not throw runtime errors');
    const result={passed:results.length,results,browserErrors:errors};fs.writeFileSync(path.join(root,'.tmp/reading-ui-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{socket?.close();child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
