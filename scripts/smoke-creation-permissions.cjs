'use strict';
// Check the shipped gateway with isolated credentials/home and no real creation.
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {runWorker}=require('../desktop/shared/controller.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
  const executable=process.argv[2]||path.join(root,'dist/desktop',process.platform==='darwin'?`${process.arch==='x64'?'mac':'mac-'+process.arch}/Codex Mobile Bridge.app/Contents/Resources/gateway/codex-mobile-gateway`:'win-unpacked/resources/gateway/codex-mobile-gateway.exe');
  const directory=await fs.mkdtemp(path.join(root,'.tmp/creation-package-'));
  const worker=(action,payload)=>runWorker({executable,dataDir:directory},action,payload);
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  let started=false;
  try{
    const state=await worker('snapshot');
    Object.assign(state.preferences,{codexHome:directory,ipcPath:path.join(directory,'unavailable.sock'),port,lan:false,tunnel:false,autoStart:false,connections:[]});
    state.auth.password='isolated-package-permissions';await worker('save',state);
    await worker('start');started=true;
    const deadline=Date.now()+25000;
    while(!(await worker('snapshot')).runtime.running){
      if(Date.now()>deadline)throw Error('Isolated packaged gateway did not start');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const base='http://127.0.0.1:'+port;
    const assets=JSON.parse(await fs.readFile(path.join(root,'web/assets.json'),'utf8'));
    for(const route of ['/app.js','/side-chat.js','/presentation.js']){
      const response=await fetch(base+route);assert.equal(response.status,200);
      const actual=Buffer.from(await response.arrayBuffer());
      const expected=Buffer.concat(await Promise.all([].concat(assets[route]).map(file=>fs.readFile(path.join(root,'web',file)))));
      assert.deepEqual(actual,expected,route+' must match the release source');
    }
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'admin',password:'isolated-package-permissions'})});
    assert.equal(login.status,200);const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await fetch(base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':auth.csrf},body:JSON.stringify({project:'local|independent',title:'never created',id:'11111111-1111-4111-8111-111111111111',permissionMode:'invalid-package-probe'})});
    assert.equal(response.status,400);assert.equal((await response.json()).error,'新会话权限设置无效');
    console.log('PASS: packaged Android creation scripts match source; frozen gateway validates creation permission before any native mutation.');
  }finally{
    if(started)await worker('stop');await fs.rm(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
