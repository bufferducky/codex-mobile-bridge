'use strict';
(() => {
  const markdown = window.markdownit({html:false, linkify:true, breaks:true});
  // Math delimiters must be consumed before Markdown removes backslash escapes.
  markdown.use(texmath, {engine:window.katex, delimiters:['brackets','dollars']});
  window.BridgeOutputDirectives?.install(markdown);
  const tags = new Set(['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','s','blockquote','hr','br','table','thead','tbody','tr','th','td']);
  const languages = {
    java:'Java', sql:'SQL', javascript:'JavaScript', typescript:'TypeScript', jsx:'JSX', tsx:'TSX',
    python:'Python', json:'JSON', yaml:'YAML', toml:'TOML', markup:'HTML / XML', css:'CSS',
    bash:'Bash', powershell:'PowerShell', batch:'Batch', kotlin:'Kotlin', c:'C', cpp:'C++',
    csharp:'C#', go:'Go', rust:'Rust', swift:'Swift', ruby:'Ruby', php:'PHP', docker:'Dockerfile',
    diff:'Diff', ini:'INI', graphql:'GraphQL'
  };
  const aliases = {
    js:'javascript', ts:'typescript', py:'python', jsonc:'json', yml:'yaml', html:'markup', xml:'markup', svg:'markup',
    sh:'bash', shell:'bash', shellscript:'bash', zsh:'bash', ps1:'powershell', bat:'batch', cmd:'batch',
    kt:'kotlin', 'c++':'cpp', 'c#':'csharp', cs:'csharp', golang:'go', rs:'rust', rb:'ruby',
    dockerfile:'docker', patch:'diff', mysql:'sql', postgresql:'sql', postgres:'sql', sqlite:'sql', plsql:'sql'
  };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const codeLanguage = info => {
    const name = markdown.utils.unescapeAll(info || '').trim().split(/\s+/)[0].toLowerCase();
    const language = own(aliases, name) ? aliases[name] : name;
    if (own(languages, language)) return {language, label:languages[language]};
    const plain = !name || /^(?:text|txt|plaintext|plain|none)$/.test(name);
    return {language:null, label:plain || !/^[\w+#.-]{1,40}$/.test(name) ? null : name};
  };
  // Cache unchanged blocks during streaming; keep both work and retained source bounded.
  const codeCache = new Map();
  let cachedCharacters = 0;
  function highlightCode(code, text, language) {
    if (!language || text.length > 65536 || text.split('\n').length > 4000) return;
    const render = () => {
      const prism = window.Prism, grammar = prism?.languages[language];
      if (!grammar) return;
      try {
        const key = language + '\0' + text;
        let cached = codeCache.get(key);
        if (!cached) {
          cached = {tokens:prism.tokenize(text, grammar), characters:text.length};
          codeCache.set(key, cached); cachedCharacters += text.length;
          while (codeCache.size > 32 || cachedCharacters > 262144) {
            const [oldest, entry] = codeCache.entries().next().value;
            codeCache.delete(oldest); cachedCharacters -= entry.characters;
          }
        }
        const fragment = document.createDocumentFragment();
        const append = (parent, values) => {
          for (const token of Array.isArray(values) ? values : [values]) {
            if (typeof token === 'string') parent.append(document.createTextNode(token));
            else {
              const span = document.createElement('span');
              span.className = ['token', token.type, ...[].concat(token.alias || [])].join(' ');
              append(span, token.content); parent.append(span);
            }
          }
        };
        append(fragment, cached.tokens); code.replaceChildren(fragment);
      } catch (_) { /* Keep the original readable code if tokenization fails. */ }
    };
    if (window.Prism) render();
    else window.BridgeFeatures?.load('syntax').then(() => {
      if (code.isConnected) render();
    }).catch(() => { /* The next message render can retry the optional resource. */ });
  }

  // Build nodes from parsed tokens; model output never becomes executable HTML.
  window.renderMarkdown = function(node, text, files = [], fileUrl = () => '', options = {}) {
    const body = document.createElement('div');
    body.className = 'markdown-body';
    const artifacts = new Map(files.flatMap(file =>
      [file.reference, ...(file.references || [])].flatMap(reference =>
        [reference, markdown.utils.unescapeAll(reference)].map(value => [markdown.normalizeLink(value), file]))));
    function parse(source) {
      const validate = markdown.validateLink;
      // Only server-authorized file URLs may pass the parser's local-URL filter.
      // Rendering still replaces them with authenticated gateway routes below.
      markdown.validateLink = reference => validate(reference) || /^file:\/\//i.test(reference) && artifacts.has(reference);
      try { return markdown.parse(source, {}); }
      finally { markdown.validateLink = validate; }
    }
    function target(reference) {
      const file = artifacts.get(reference);
      if (file) return {url:fileUrl(file), file};
      if (window.BridgeOutputDirectives?.isReviewTarget(reference)) return {url:reference, review:true};
      if (/^https?:\/\//i.test(reference)) return {url:reference};
      return null;
    }
    function link(url, title) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      if (window.BridgeOutputDirectives?.isReviewTarget(url)) anchor.onclick=event=>{event.preventDefault();window.BridgeOutputDirectives?.review(url);};
      if (title) anchor.title = title;
      return anchor;
    }
    let codeIndex=0, highlightBudget=131072;
    const lines=String(text || '').split(/\r?\n/);
    function completeFence(token) {
      if (!token.map || !token.markup) return false;
      const last=(lines[token.map[1]-1] || '').replace(/^[ \t]*(?:>[ \t]*)+/, '');
      const marker=token.markup[0], count=token.markup.length;
      return new RegExp('^[ \\t]*'+(marker==='`'?'`':'~')+'{'+count+',}[ \\t]*$').test(last);
    }
    function appendTokens(tokens, root) {
      const parents = [root];
      for (const token of tokens) {
        if (token.hidden) continue;
        const parent = parents[parents.length - 1];
        if (token.type === 'inline') {
          appendTokens(token.children || [], parent);
        } else if (token.type.startsWith('math_')) {
          const display = token.block || token.type === 'math_inline_double';
          const formula = document.createElement(token.block ? 'div' : 'span');
          formula.className = display ? 'math-display' : 'math-inline';
          const expression = document.createElement('span');
          formula.append(expression);
          const source = () => { const code=document.createElement('code');code.textContent=token.content;expression.replaceChildren(code); };
          const render = () => {
            try { window.katex.render(token.content, expression, {
              displayMode:display, throwOnError:true, trust:false,
              maxExpand:1000, maxSize:20, strict:'ignore'
            }); } catch { source(); }
          };
          if(window.katex)render();
          else {
            source();
            // Only replace this formula, never rerender the message or composer.
            const load = () => window.BridgeFeatures?.load('math').then(() => {
              if(formula.isConnected)render();
            }).catch(() => {
              if(!formula.isConnected)return;
              const retry=document.createElement('button');retry.type='button';retry.className='plain';
              retry.textContent=typeof BridgeI18n==='undefined'?'重试':BridgeI18n.t('重试');
              retry.onclick=()=>{retry.remove();load();};expression.append(retry);
            });
            load();
          }
          if (token.type.endsWith('_eqno')) {
            const number = document.createElement('span');
            number.className = 'math-number';
            number.textContent = '(' + token.info + ')';
            formula.append(number);
          }
          parent.append(formula);
        } else if (token.type === 'output_directive') {
          parent.append(window.BridgeOutputDirectives.create(token.meta, reference => {
            const file=artifacts.get(markdown.normalizeLink(reference));
            return file ? {url:fileUrl(file),file} : null;
          }));
        } else if (token.type === 'text') {
          parent.append(document.createTextNode(token.content));
        } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
          parent.append(document.createElement('br'));
        } else if (token.type === 'code_inline' || token.type === 'code_block' || token.type === 'fence') {
          const code = document.createElement('code');
          code.textContent = token.content;
          if (token.type === 'code_inline') parent.append(code);
          else {
            const index=codeIndex++;
            const getSource=()=>{
              if(!options.fullText)return token.content;
              const extract=complete=>{
                const blocks=parse(complete).filter(t=>t.type==='fence'||t.type==='code_block');
                if(!blocks[index])throw Error('读取完整正文失败，请重试');
                return blocks[index].content;
              };
              const complete=options.fullText();
              return typeof complete==='string'?extract(complete):Promise.resolve(complete).then(extract);
            };
            if(token.type==='fence' && /^mermaid(?:\s|$)/i.test(token.info.trim()) && completeFence(token) && window.BridgeMermaidCards){
              parent.append(window.BridgeMermaidCards.create(token.content,{owner:node,index,getSource}));
              continue;
            }
            const pre = document.createElement('pre');
            pre.append(code);
            const wrapper=document.createElement('div');wrapper.className='code-block';
            const {language,label}=codeLanguage(token.info);
            const header=document.createElement('div');header.className='code-header';
            const badge=document.createElement('span');badge.className='code-language';
            badge.textContent=label || (typeof BridgeI18n==='undefined'?'纯文本':BridgeI18n.t('纯文本'));
            if(!label)badge.dataset.i18n='纯文本';
            if(language){
              code.className='language-'+language;
              if(token.content.length<=highlightBudget){highlightBudget-=token.content.length;highlightCode(code,token.content,language);}
            }
            const button=document.createElement('button');button.className='plain code-copy';button.type='button';button.textContent=typeof BridgeI18n==='undefined'?'复制代码':BridgeI18n.t('复制代码');
            button.onclick=()=>window.BridgeClipboard?.copy(getSource,button);
            header.append(badge,button);wrapper.append(header,pre);parent.append(wrapper);
          }
        } else if (token.type === 'image') {
          const destination = target(token.attrGet('src') || '');
          const label = token.content || destination?.file?.name || '图片';
          if (destination?.file?.image) {
            const image = document.createElement('img');
            image.className = 'artifact-image';
            image.src = destination.url;
            image.alt = label;
            image.loading = 'lazy';
            image.dataset.imagePreview = destination.url; image.dataset.imageName = label;
            image.tabIndex = 0; image.setAttribute('role', 'button');
            parent.append(image);
          } else if (destination) {
            // Remote images remain links instead of making background requests.
            const anchor = link(destination.url, token.attrGet('title'));
            anchor.textContent = label;
            parent.append(anchor);
          } else parent.append(document.createTextNode(label));
        } else if (token.nesting === -1) {
          parents.pop();
        } else {
          let element;
          if (token.type === 'link_open') {
            const destination = target(token.attrGet('href') || '');
            element = destination ? link(destination.url, token.attrGet('title')) : document.createElement('span');
            if (destination?.file?.image) { element.dataset.imagePreview = destination.url; element.dataset.imageName = destination.file.name; }
          } else if (tags.has(token.tag)) {
            element = document.createElement(token.tag);
            if (token.tag === 'ol' && token.attrGet('start')) element.start = Number(token.attrGet('start'));
            const alignment = /^text-align:(left|center|right)$/.exec(token.attrGet('style') || '');
            if (alignment) element.className = 'align-' + alignment[1];
          } else continue;
          if (token.tag === 'table') {
            const scroll = document.createElement('div');
            scroll.className = 'markdown-table';
            scroll.tabIndex = 0;
            scroll.setAttribute('role', 'region');
            scroll.setAttribute('aria-label', '表格，可横向滚动');
            scroll.append(element);
            parent.append(scroll);
          } else parent.append(element);
          if (token.nesting === 1) parents.push(element);
        }
      }
    }
    appendTokens(parse(String(text || '')), body);
    node.append(body);
  };
})();
