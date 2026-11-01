'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/features/settings/presentation.js','utf8');
function page({host='android',theme='system',native,media=false}={}){
 const nodes=new Map(),events=new Map(),values=new Map([['bridge-appearance',JSON.stringify({theme})]]);
 const node=()=>({dataset:{},style:{setProperty(){}},classList:{toggle(){},contains(){return false;}},hidden:false,
  setAttribute(){},addEventListener(){},querySelector(){return {};},getBoundingClientRect(){return {height:48};}});
 const root=node(),system={matches:media,addEventListener:(name,fn)=>events.set('media:'+name,fn)};
 const document={documentElement:root,body:node(),querySelector:()=>node(),querySelectorAll:()=>[],
  getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}};
 const window={BridgeNativeColorScheme:native,matchMedia:()=>system,addEventListener:(name,fn)=>events.set(name,fn)};
 const context=vm.createContext({window,document,BridgeHost:{kind:()=>host},BridgeI18n:{t:x=>x},
  BridgeFontLibrary:{Library:class{restore(){return new Promise(()=>{});}}},
  localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},
  requestAnimationFrame(){},getComputedStyle:()=>({getPropertyValue:key=>key==='--user'?'#eeeeee':'#ffffff'}),
  MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}}});
 vm.runInContext(source,context);
 return {root,window,system,nodes,values,signal(value){window.BridgeNativeColorScheme=value;events.get('bridge-native-theme')?.();},
  media(value){system.matches=value;events.get('media:change')();},choose(theme){const select=nodes.get('appearance-theme');select.value=theme;select.onchange();}};
}
test('Android follows the actual dark system even when the light WebView theme reports light',()=>{
 const ui=page({native:'dark',media:false});assert.equal(ui.root.dataset.theme,'dark');
 assert.equal(ui.nodes.get('appearance-theme').value,'system');
});
test('late native injection and system changes update the page without reloading or saving an override',()=>{
 const ui=page();assert.equal(ui.root.dataset.theme,'light');
 ui.signal('dark');assert.equal(ui.root.dataset.theme,'dark');
 ui.media(false);assert.equal(ui.root.dataset.theme,'dark');
 ui.signal('light');assert.equal(ui.root.dataset.theme,'light');
 assert.equal(JSON.parse(ui.values.get('bridge-appearance')).theme,'system');
});
test('explicit themes win over native system changes; switching back to system uses the latest signal',()=>{
 const ui=page({theme:'light',native:'dark'});assert.equal(ui.root.dataset.theme,'light');
 ui.signal('dark');assert.equal(ui.root.dataset.theme,'light');
 ui.choose('system');assert.equal(ui.root.dataset.theme,'dark');
 ui.choose('dark');ui.signal('light');assert.equal(ui.root.dataset.theme,'dark');
});
test('browsers and iOS use media changes; Android falls back when no valid native signal exists',()=>{
 for(const host of ['browser','ios']){
  const ui=page({host,native:'dark'});assert.equal(ui.root.dataset.theme,'light');
  ui.media(true);assert.equal(ui.root.dataset.theme,'dark');
 }
 const ui=page({native:'invalid',media:true});assert.equal(ui.root.dataset.theme,'dark');
});
test('both Android variants keep the WebView on system theme changes and report at each lifecycle entry',()=>{
 for(const file of ['mobile/android/AndroidManifest.xml','mobile/android-push/AndroidManifest.xml']){
  const manifest=fs.readFileSync(file,'utf8'),activity=manifest.match(/<activity\b[^>]*MainActivity[^>]*>/)[0];
  assert.ok(activity.match(/android:configChanges="([^"]*)"/)[1].split('|').includes('uiMode'));
 }
 const source=fs.readFileSync('mobile/android/src/io/github/try2love/codexbridge/MainActivity.java','utf8');
 for(const signature of ['public void onPageFinished(','protected void onResume(','public void onConfigurationChanged(']){
  const entry=source.split('\n').find(line=>line.includes(signature));
  assert.ok(entry?.includes('reportSystemTheme();'),signature);
 }
});
