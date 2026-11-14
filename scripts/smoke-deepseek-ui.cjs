'use strict';
// Isolated production DSH UI. Only synthetic sessions and a private Electron profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.tmp/deepseek-experience');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'electron-data'));
const webRoot=process.env.CMB_UI_WEB_ROOT?path.resolve(process.env.CMB_UI_WEB_ROOT):path.join(root,'web');
const assets=JSON.parse(fs.readFileSync(path.join(webRoot,'assets.json'),'utf8')),read=file=>fs.readFileSync(file.startsWith('web/')?path.join(webRoot,file.slice(4)):path.join(root,file),'utf8');
const urls=['/host.js','/i18n.js','/message-actions.js','/permissions.js','/activity.js','/attachments.js','/list-sync.js','/client-lifecycle.js','/workbench.js','/timeline.js','/desktop-sessions.js','/vendor/markdown-it.min.js','/vendor/katex/katex.min.js','/vendor/texmath.js','/markdown.js'];
const styles=['/style.css','/presentation.css','/workbench.css','/desktop-sessions.css'];
let writes=0;
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){writes++;res.writeHead(405);return res.end();}
  const route=new URL(req.url,'http://fixture.invalid').pathname;
  if(route==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles.map(url=>'<link rel="stylesheet" href="'+url+'">').join('')+'<body>'+urls.map(url=>'<script src="'+url+'"></script>').join('')+'</body></html>');}
  const file=assets[route]||(/^\/vendor\/[\w/.-]+$/.test(route)?route.slice(1):null);
  if(!file){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',route.endsWith('.css')?'text/css':route.endsWith('.png')?'image/png':'text/javascript');res.end(Buffer.concat([].concat(file).map(name=>fs.readFileSync(path.join(webRoot,name)))));
});
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const window=new BrowserWindow({show:false,width:390,height:844,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}),results=[],errors=[];
  window.webContents.setUserAgent(window.webContents.getUserAgent()+' BridgeMobile/0.1-Android');
  window.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('404'))errors.push(event.message);});
  for(const [width,height] of [[390,844],[320,844],[844,390],[1440,900]])for(const theme of ['light','dark']){
    window.setContentSize(width,height);await window.loadURL('http://127.0.0.1:'+server.address().port);
    await window.webContents.executeJavaScript('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.documentElement.classList.add("bridge-mobile");');
    for(const file of ['web/layouts/viewport.js','web/hosts/android-presentation.js','tests/browser/deepseek-experience.browser.js'])await window.webContents.executeJavaScript(read(file));
    const lateAdapter=theme==='dark';
    try{results.push({width,height,theme,lateAdapter,...await window.webContents.executeJavaScript('runDeepseekExperienceChecks({keepOpen:true,lateAdapter:'+lateAdapter+'})')});}
    catch(error){fs.writeFileSync(path.join(out,'failed-'+width+'.png'),(await window.webContents.capturePage()).toPNG());throw error;}
    fs.writeFileSync(path.join(out,theme+'-'+width+'.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.__deepseekExperiencePreview.cleanup()');
  }
  assert.equal(writes,0);assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({results,writes,errors},null,2));console.log(JSON.stringify({results,writes,errors}));window.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error.message);server.close();app.exit(1);});
