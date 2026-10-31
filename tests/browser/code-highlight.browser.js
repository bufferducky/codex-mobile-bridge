/* Run after the production Markdown bundle, Prism and styles in an isolated page.
 * Uses synthetic messages and a clipboard stub; never contacts a real gateway. */
(async () => {
  const checks=[], check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
  const fixture=document.createElement('div');fixture.style.width='300px';document.body.append(fixture);
  const originalClipboard=window.BridgeClipboard,originalFeatures=window.BridgeFeatures,prism=window.Prism;
  const tokenize=prism.tokenize;
  let copied,copyDone;
  window.BridgeClipboard={copy:getSource=>copyDone=Promise.resolve(getSource()).then(value=>{copied=value;})};
  const render=(text,options={})=>{
    const node=document.createElement('div');node.className='message assistant';
    renderMarkdown(node,text,[],()=>'',options);fixture.append(node);return node;
  };
  const fenced=(language,source)=>'```'+language+'\n'+source+'\n```';
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  try {
    const samples={java:'private String greet() { return "你好"; }',sql:"SELECT name FROM users WHERE id = 42 AND status = 'active';",
      javascript:'const x = 1;',typescript:'const x: number = 1;',jsx:'const x = <div>ok</div>;',tsx:'const x: JSX.Element = <div/>;',
      python:'def hello(): return "hi"',json:'{"name": "value"}',yaml:'name: value',toml:'name = "value"',markup:'<div id="x">ok</div>',css:'div { color: red; }',
      bash:'echo "hello"',powershell:'Write-Host "hello"',batch:'echo hello',kotlin:'val x: Int = 1',c:'int main() { return 0; }',cpp:'int main() { return 0; }',
      csharp:'public class Example { string x = "hi"; }',go:'func main() { return }',rust:'let x = 1;',swift:'let x = "hi"',ruby:'def hello; "hi"; end',
      php:'<?php echo "hi"; ?>',docker:'FROM node:20\nRUN echo hello',diff:'-old\n+new',ini:'[section]\nname=value',graphql:'query { user(id: 1) { name } }'};
    for(const [language,source] of Object.entries(samples)){
      const node=render(fenced(language,source)),code=node.querySelector('pre code');
      check(language+' has tokens, a label and exact source',code.querySelector('.token')&&code.textContent===source+'\n'&&node.querySelector('.code-language').textContent&&code.className==='language-'+language);
    }
    const java=fixture.querySelector('code.language-java');
    check('Java types and methods have their own tokens',java.querySelector('.token.class-name')?.textContent==='String'&&java.querySelector('.token.function')?.textContent==='greet');
    check('SQL keywords, strings and numbers are distinct',fixture.querySelector('code.language-sql .token.keyword')&&fixture.querySelector('code.language-sql .token.string')&&fixture.querySelector('code.language-sql .token.number'));
    for(const [alias,label] of Object.entries({JAVA:'Java',js:'JavaScript',ts:'TypeScript',mysql:'SQL',postgresql:'SQL',sh:'Bash','c++':'C++','c#':'C#',yml:'YAML'})){
      check(alias+' resolves its language label',render(fenced(alias,'value = 1')).querySelector('.code-language').textContent===label);
    }
    const hostile='<script>window.codeInjected=true</script>\t<&>\u00a0中文';
    const safe=render(fenced('html',hostile));
    check('highlighted HTML remains text',safe.querySelector('pre code').textContent===hostile+'\n'&&!safe.querySelector('script,img,iframe,svg')&&!window.codeInjected);
    const unknown=render(fenced('unknown-language','literal <tag>'));
    check('unknown languages keep a label and readable plain text',unknown.querySelector('.code-language').textContent==='unknown-language'&&!unknown.querySelector('.token')&&unknown.querySelector('pre code').textContent==='literal <tag>\n');
    for(const info of ['', 'text', '__proto__', 'constructor', '<img>']){
      const node=render(fenced(info,'unchanged'));
      check('unrecognized info is safe: '+info,!node.querySelector('.token,img')&&node.querySelector('pre code').textContent==='unchanged\n');
    }
    const inline=render('Use `SELECT * FROM users` here.');
    check('inline code stays inline',inline.querySelector('p code')?.textContent==='SELECT * FROM users'&&!inline.querySelector('.code-header'));
    safe.querySelector('.code-copy').click();await copyDone;
    check('copy returns source without header or tokens',copied===hostile+'\n');
    const full=fenced('java','first')+'\n\n'+fenced('sql',samples.sql);
    const partial=render(fenced('java','first')+'\n\n'+fenced('sql','SELECT'),{fullText:async()=>full});
    partial.querySelectorAll('.code-copy')[1].click();await copyDone;
    check('copy still reads the complete matching block',copied===samples.sql+'\n');
    const stream='```java\npublic class Shop {\n String title = "hello";\n}';
    for(let end=0;end<=stream.length;end++)render(stream.slice(0,end));
    check('incomplete streaming fences remain highlighted and readable',render(stream).querySelector('.token.keyword')?.textContent==='public');
    let calls=0;prism.tokenize=(...args)=>{calls++;return tokenize(...args);};
    const cached=fenced('java','private int cacheCheck() { return 937; }');
    render(cached);render(cached);
    check('unchanged blocks reuse tokenization during streaming',calls===1);
    calls=0;
    const evicted=Array.from({length:33},(_,index)=>fenced('java','private int cache_'+innerWidth+'_'+index+' = 1;'));
    for(const block of evicted)render(block);
    render(evicted[0]);render(evicted[32]);
    check('the token cache evicts old blocks while retaining recent ones',calls===34);
    calls=0;
    const large='x'.repeat(65537),manyLines='x\n'.repeat(4001);
    for(const source of [large,manyLines]){
      const node=render(fenced('java',source));
      check('large block keeps exact text without tokenization: '+source.length,node.querySelector('pre code').textContent===source+'\n'&&!node.querySelector('.token'));
    }
    check('large blocks do not call Prism',calls===0);
    const chunk='/*'+'x'.repeat(49996)+'*/';
    render([1,2,3,4].map(i=>fenced('java',chunk+i)).join('\n\n'));
    check('a message has a bounded highlighting budget',calls===2);
    prism.tokenize=()=>{throw Error('synthetic tokenizer failure');};
    const failed=render(fenced('java','private int failureCheck = 7;'));
    check('tokenizer failure preserves the original text',failed.querySelector('pre code').textContent==='private int failureCheck = 7;\n'&&!failed.querySelector('.token'));
    prism.tokenize=tokenize;
    let loads=0,finish;
    const loading=new Promise(resolve=>{finish=resolve;});
    window.Prism=undefined;
    window.BridgeFeatures={load:name=>{check('only syntax is loaded for highlighting',name==='syntax');loads++;return loading;}};
    const lazy=render(fenced('SQL',samples.sql)),detached=render(fenced('java',samples.java));detached.remove();
    check('code and label show before the optional component loads',!lazy.querySelector('.token')&&lazy.querySelector('.code-language').textContent==='SQL');
    window.Prism=prism;finish();await tick();
    check('lazy highlighting updates only attached code',lazy.querySelector('.token.keyword')&&!detached.querySelector('.token')&&loads===2);
    window.Prism=undefined;window.BridgeFeatures={load:()=>Promise.reject(Error('synthetic resource failure'))};
    const offline=render(fenced('java',samples.java));await tick();
    check('failed optional loading leaves code readable and copyable',offline.querySelector('pre code').textContent===samples.java+'\n'&&!offline.querySelector('.token'));
    window.Prism=prism;window.BridgeFeatures=originalFeatures;
    fixture.replaceChildren();
    const layout=render(fenced('java',samples.java+' '.repeat(10)+'long_identifier'.repeat(40))+'\n\n'+fenced('sql',samples.sql));
    const pre=layout.querySelector('pre'),header=layout.querySelector('.code-header');
    check('narrow code scrolls inside the block without page overflow',pre.scrollWidth>pre.clientWidth&&fixture.scrollWidth<=301&&layout.scrollWidth<=301);
    check('language and copy button stay above the scrolling code',header.getBoundingClientRect().bottom<=pre.getBoundingClientRect().top+1&&getComputedStyle(header.querySelector('button')).position==='static');
    const keyword=layout.querySelector('.token.keyword'),before=document.documentElement.dataset.theme;
    document.documentElement.dataset.theme='light';const light=getComputedStyle(keyword).color;
    document.documentElement.dataset.theme='dark';const dark=getComputedStyle(keyword).color;
    document.documentElement.dataset.theme=before||'light';
    check('syntax colors adapt to light and dark themes',light!==dark&&light!==getComputedStyle(pre).color);
    return {passed:checks.length,checks};
  } finally {
    fixture.remove();window.BridgeClipboard=originalClipboard;window.BridgeFeatures=originalFeatures;window.Prism=prism;prism.tokenize=tokenize;
  }
})();
