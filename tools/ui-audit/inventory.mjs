import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'acorn';
import { parseFragment } from 'parse5';
// Source candidates and coordinates are not proof of runtime behavior.
const root = path.resolve(process.argv[2] || '.');
const outputDir = path.resolve(process.argv[3] || 'ui-audit-output');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function walk(directory, prefix = '') {return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name),prefix+e.name+'/'):[prefix+e.name]);}
const sourceFiles = walk(path.join(root,'public')).filter(f=>/\.(js|html|css)$/.test(f)).sort();
const rawTags = [];
const result = {schema: 'kafedra-ui-inventory-v1', sourceCommit: null, files: [], elements: [], calls: [], actions: [], surfaces: []};
const imports = new Map();
const controlTags = new Set(['button','input','select','textarea','a','summary','option']);
const uiRoles = new Set(['button','tab','checkbox','radio','switch','menuitem','menuitemcheckbox','menuitemradio','link','combobox','slider','spinbutton','textbox','treeitem','gridcell']);
const windowRoles = new Set(['dialog','alertdialog','menu','listbox','tabpanel']);
function fnName(node, parent) {
 return node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id?.name : parent?.type === 'Property' ? parent.key?.name || parent.key?.value : null) || `callback@${node.loc.start.line}`;
}
function zone(file) {
 if (/academic/.test(file)) return 'D6';
 if (/science|reports/.test(file)) return 'D5';
 if (/meeting|protocol/.test(file)) return 'D3';
 if (/admin|auth|organization|docomator|notification-delivery/.test(file)) return 'D7';
 if (/plan|lifecycle/.test(file)) return 'D2';
 if (/work|assignment|supporting|directive|periodic|template-binding|structure-next|preview|upload/.test(file)) return 'D4';
 return 'D1';
}
function acceptance(kind, tag, attrs = {}) {
 if (kind === 'candidate' || kind === 'constructed') return 'H01';
 if (kind === 'window') return 'W01';
 if (kind === 'form') return 'F01';
 if (kind === 'surface') return 'S02';
 if (kind === 'screen') return 'S01';
 if (kind === 'choice') return 'C08';
 if (tag === 'input' && attrs.type === 'file' || tag === 'label' && /file-button/.test(attrs.class||'')) return 'C06';
 if (['input','textarea','select'].includes(tag)) return 'C05';
 if (tag === 'summary') return 'C04';
 if (tag === 'a') return 'C03';
 const value = JSON.stringify(attrs);
 if (/archive|delete|remove|restore/.test(value)) return 'C02';
 return 'C01';
}
for (const name of sourceFiles) {
 const file = `public/${name}`;
 const text = fs.readFileSync(path.join(root, file), 'utf8');
 const lines = [0]; for (let i=0;i<text.length;i++) if(text[i] === '\n') lines.push(i+1);
 const locate = offset => {let lo=0,hi=lines.length;while(lo+1<hi){let m=(lo+hi)>>1;if(lines[m]<=offset)lo=m;else hi=m;}return {line:lo+1,column:offset-lines[lo]+1};};
 const meta={file,sha256:hash(text),bytes:Buffer.byteLength(text),lines:lines.length,zone:zone(file),imports:[],dynamicImports:[],status:'source-indexed/runtime-pending'};
 result.files.push(meta); imports.set(file,meta.imports);
 const seen = new Set();
 function emit(kind,tag,attrs,offset,scope,label,origin,extra={}) {
   const key=`${kind}:${offset}:${tag}`; if(seen.has(key))return;seen.add(key);
   const pos=locate(offset);
   const selectors = attrs.id ? `#${attrs.id}` : Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>`[${k}${v?`="${v}"`:''}]`).join('') || (attrs.name ? `${tag}[name="${attrs.name}"]` : '');
   const row={id:`UI-${hash(file+':'+offset+':'+kind+':'+tag).slice(0,10)}`,kind,tag,file,...pos,scope,zone:zone(file),selector:selectors,label:attrs['aria-label']||label||attrs.title||attrs.name||'',attributes:attrs,origin,acceptance:acceptance(kind,tag,attrs),status:'planned',runtimeEvidence:null,...extra};
   result.elements.push(row);
 }
 function html(fragment, offset, scope, origin, original=null) {
   const dom=parseFragment(fragment,{sourceCodeLocationInfo:true});
   function inspect(n) {
    if(n.tagName && n.sourceCodeLocation?.startTag) {
     const at=n.sourceCodeLocation.startTag.startOffset; const attrs=Object.fromEntries(n.attrs.map(a=>[a.name,a.value]));
     const flatten=x=>x.nodeName==='#text'?x.value:(x.childNodes||[]).map(flatten).join(' ');
     const label=flatten(n).replace(/_{4,}/g,'{dynamic}').replace(/\s+/g,' ').trim().slice(0,200);
     let p=offset+at;
     if(original) {const needle=`<${n.tagName}`;let count=(fragment.slice(0,at).match(new RegExp(needle+'(?=[\\s>/])','g'))||[]).length;let found=-1;while(count-->=0)found=original.indexOf(needle,found+1);if(found>=0)p=offset+found;}
     rawTags.push({file,offset:p,scope,tag:n.tagName,attributes:attrs,origin,label,...locate(p)});
     const dynamic=/_{4,}|\$\{/.test(JSON.stringify(attrs)) || /\{dynamic\}/.test(label);
     if(controlTags.has(n.tagName)||(n.tagName==='label'&&('for' in attrs||/file-button/.test(attrs.class||'')))||uiRoles.has(attrs.role)||'contenteditable' in attrs||Object.keys(attrs).some(k=>/^on(click|change|submit|keydown|pointerdown)/.test(k))) {
       emit(n.tagName==='option'?'choice':'control',n.tagName,attrs,p,scope,label,origin,{dynamic});
     }
     if(n.tagName==='dialog'||windowRoles.has(attrs.role))emit('window',n.tagName,attrs,p,scope,label.slice(0,120),origin,{dynamic});
     if('data-view-panel' in attrs || ['month-view','week-view','tasks-view'].includes(attrs.id) || /auth-card/.test(attrs.class||''))emit('screen',n.tagName,attrs,p,scope,attrs['data-view-panel']||attrs.id||'auth-state',origin,{dynamic});
     if ((Object.keys(attrs).some(k=>k.startsWith('data-')) || 'tabindex' in attrs) && !controlTags.has(n.tagName) && !uiRoles.has(attrs.role))emit('candidate',n.tagName,attrs,p,scope,label.slice(0,120),origin,{dynamic});
     if(n.tagName==='form')emit('form',n.tagName,attrs,p,scope,label.slice(0,120),origin,{dynamic});
     if(n.tagName==='details'||n.tagName==='nav'||/popover|inspector|wizard-panel/.test(attrs.class||'')||attrs.role==='status'||attrs.role==='alert'||attrs.role==='progressbar'||'aria-live' in attrs||n.tagName==='progress')emit('surface',n.tagName,attrs,p,scope,label.slice(0,120),origin,{dynamic});
    }
    (n.childNodes||[]).forEach(inspect);if(n.content)inspect(n.content);
   }
   inspect(dom);
 }
 if (name.endsWith('.html')) {
   html(text,0,'document','html');
   for (const m of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g))meta.imports.push('public/'+m[1].replace(/^\//,''));
 } else if (name.endsWith('.js')) {
   const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
   function visit(node,parent,scope='module',fn=null,listener=null) {
    if(!node||typeof node!=='object')return;
    if(/Function/.test(node.type)) {const name=fnName(node,parent);scope=name.startsWith('callback@')&&scope!=='module'?scope+' / '+name:name;fn=node;}
    if(node.type==='ImportDeclaration'||node.type==='ExportNamedDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ImportExpression') {
      const src=node.source?.value;if(src&&/^[./]/.test(src))meta.imports.push(path.posix.normalize(src.startsWith('/')?'public/'+src.slice(1):path.posix.join(path.posix.dirname(file),src)));
      else if(node.type==='ImportExpression')meta.dynamicImports.push(text.slice(node.start,node.end));
    }
    if(node.type==='TemplateLiteral') {
      let fragment=text.slice(node.start+1,node.end-1).split('');
      for(const expr of node.expressions) {
       let begin=expr.start-2;while(begin>node.start&&text.slice(begin,begin+2)!=='${')begin--;
       let end=expr.end;while(end<node.end&&text[end]!=='}')end++;
       for(let i=begin;i<=end;i++)if(fragment[i-node.start-1]!=='\n'&&fragment[i-node.start-1]!=='\r')fragment[i-node.start-1]='_';
      }
      const value=fragment.join('');if(/<[a-z]/i.test(value))html(value,node.start+1,scope,'template');
    }
    if(node.type==='Literal'&&typeof node.value==='string'&&/<[a-z]/i.test(node.value))html(node.value,node.start+1,scope,'string',text.slice(node.start+1,node.end-1));
    if(node.type==='CallExpression') {
     const callee=text.slice(node.callee.start,node.callee.end);const method=node.callee.property?.name;
     const args=node.arguments.map(a=>a.type==='Literal'?a.value:text.slice(a.start,a.end).slice(0,250));
     let kind=null;
     if(method==='addEventListener'){kind='listener';listener=node;}
     else if(method==='createElement')kind='create-element';
     else if(['showModal','show','close','alert','confirm','prompt'].includes(method)||['alert','confirm','prompt'].includes(callee))kind='native-dialog';
     else if(method==='closest'||method==='matches')kind='delegated-selector';
     else if((/^(open|show|render|modal)/i.test(callee)||/(Dialog|Modal|Sheet|Inspector|Editor|Form|Preview)$/.test(callee))&&!/\.map$/.test(callee))kind='render-call';
     else if(/(?:fetch|api|request)$/i.test(callee))kind='request';
     if(kind){const row={id:`CALL-${hash(file+':'+node.start+':'+node.end+':'+kind).slice(0,10)}`,kind,file,...locate(node.start),scope,zone:zone(file),callee,args,listenerLine:listener?.loc.start.line||null,status:'planned',acceptance:kind==='native-dialog'?'W01':'H01'};result.calls.push(row);}
     if(method==='createElement') {
       const variable=parent?.type==='VariableDeclarator'?text.slice(parent.id.start,parent.id.end):parent?.type==='AssignmentExpression'?text.slice(parent.left.start,parent.left.end):null;
       const attrs={};
       function properties(n) {
        if(!n || typeof n!=='object')return;
        if(n!==fn && /Function/.test(n.type))return;
        if(n.start>node.end && n.type==='AssignmentExpression' && n.left.type==='MemberExpression' && variable && text.slice(n.left.object.start,n.left.object.end)===variable && n.right.type==='Literal') {
         const key=n.left.property.name||n.left.property.value;
         if(['id','className','type','name','textContent','title','tabIndex'].includes(key))attrs[key==='className'?'class':key]=String(n.right.value);
        }
        if(n.start>node.end && n.type==='CallExpression' && n.callee.type==='MemberExpression' && n.callee.property.name==='setAttribute' && variable && text.slice(n.callee.object.start,n.callee.object.end)===variable && n.arguments[0]?.type==='Literal' && n.arguments[1]?.type==='Literal')attrs[String(n.arguments[0].value)]=String(n.arguments[1].value);
        for(const [k,v] of Object.entries(n))if(!['loc','start','end'].includes(k)){if(Array.isArray(v))v.forEach(properties);else if(v?.type)properties(v);}
       }
       if(fn)properties(fn);
       const tag=node.arguments[0]?.type==='Literal'?String(args[0]):'{dynamic}';
       const kind=tag==='dialog'||windowRoles.has(attrs.role)?'window':controlTags.has(tag)||uiRoles.has(attrs.role)?'control':'constructed';
       emit(kind,tag,attrs,node.start,scope,attrs.textContent||'','createElement',{dynamic:true,variable});
     }
    }
    if(node.type==='AssignmentExpression' && node.left.type==='MemberExpression' && /^on(click|change|submit|input|keydown|keyup|pointer|mouse|touch)/.test(node.left.property?.name||''))result.calls.push({id:`CALL-${hash(file+':'+node.start+':property-handler').slice(0,10)}`,kind:'property-handler',file,...locate(node.start),scope,zone:zone(file),callee:text.slice(node.left.start,node.left.end),args:[],status:'planned',acceptance:'H01'});
    if(name==='action-registry.js'&&node.type==='ObjectExpression'){
     const props=Object.fromEntries(node.properties.filter(p=>p.value?.type==='Literal').map(p=>[p.key.name||p.key.value,p.value.value]));
     if(props.id&&props.group&&props.label)result.actions.push({...props,file,line:node.loc.start.line,status:'planned',zone:zone(file),acceptance:'C07'});
    }
    for(const [key,value] of Object.entries(node))if(!['loc','start','end'].includes(key)) {
     if(Array.isArray(value))value.forEach(child=>{if(child?.type)visit(child,node,scope,fn,listener);});
     else if(value?.type)visit(value,node,scope,fn,listener);
    }
   }
   visit(ast,null);
 }
 meta.imports=[...new Set(meta.imports)]; imports.set(file,meta.imports);
}
const serverFile='apps/api/src/http-utils.mjs';
const serverText=fs.readFileSync(path.join(root,serverFile),'utf8');
result.serverEntrypoints=[...serverText.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m=>({file:'public/'+m[1].replace(/^\//,''),source:serverFile,line:serverText.slice(0,m.index).split('\n').length}));
result.files.push({file:serverFile,sha256:hash(serverText),bytes:Buffer.byteLength(serverText),lines:serverText.split('\n').length,zone:'D1',imports:[],dynamicImports:[],status:'source-indexed/runtime-pending',entrypoint:true});
const reachable=new Set(['public/index.html',...result.serverEntrypoints.map(e=>e.file)]);const queue=[...reachable];while(queue.length){const f=queue.shift();for(const target of imports.get(f)||[])if(!reachable.has(target)){reachable.add(target);queue.push(target);}}
for(const row of [...result.files,...result.elements,...result.calls])row.reachable=row.file.endsWith('.css')||row.entrypoint?null:reachable.has(row.file);
const delegatedTokens=new Set(result.calls.filter(c=>c.kind==='delegated-selector').flatMap(c=>c.args.filter(a=>typeof a==='string').flatMap(a=>a.match(/[.#][a-zA-Z_][\w-]*/g)||[])));
const knownPositions=new Set(result.elements.map(e=>e.file+':'+e.line+':'+e.column));
for(const tag of rawTags) {
 const attrs=tag.attributes; const tokens=[attrs.id?'#'+attrs.id:'',...(attrs.class||'').split(/\s+/).filter(Boolean).map(v=>'.'+v)];
 if(tokens.some(t=>delegatedTokens.has(t)) && !knownPositions.has(tag.file+':'+tag.line+':'+tag.column)) {
  result.elements.push({id:'UI-'+hash(tag.file+':'+tag.offset+':candidate:'+tag.tag).slice(0,10),kind:'candidate',tag:tag.tag,file:tag.file,line:tag.line,column:tag.column,scope:tag.scope,zone:zone(tag.file),selector:tokens.filter(t=>delegatedTokens.has(t)).join(' '),label:attrs['aria-label']||tag.label,attributes:attrs,origin:tag.origin,acceptance:'H01',status:'planned',runtimeEvidence:null,dynamic:true,reachable:reachable.has(tag.file),reason:'delegated-selector-candidate'});
  knownPositions.add(tag.file+':'+tag.line+':'+tag.column);
 }
}
const byScope=new Map();
for(const row of result.elements){const key=`${row.file}::${row.scope}`;if(!byScope.has(key))byScope.set(key,{id:`SURF-${hash(key).slice(0,10)}`,file:row.file,scope:row.scope,zone:row.zone,reachable:row.reachable,elements:[],status:'planned',acceptance:'S01'});byScope.get(key).elements.push(row.id);}
result.surfaces=[...byScope.values()];
result.summary={files:result.files.length,js:result.files.filter(f=>f.file.endsWith('.js')).length,css:result.files.filter(f=>f.file.endsWith('.css')).length,controls:result.elements.filter(e=>e.kind==='control').length,choices:result.elements.filter(e=>e.kind==='choice').length,screens:result.elements.filter(e=>e.kind==='screen').length,windows:result.elements.filter(e=>e.kind==='window').length,forms:result.elements.filter(e=>e.kind==='form').length,surfaces:result.surfaces.length,calls:result.calls.length,actions:result.actions.length,unreachable:result.files.filter(f=>f.reachable===false).map(f=>f.file)};
result.elements.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line||a.column-b.column||a.kind.localeCompare(b.kind));
result.sourceFingerprint=hash(result.files.map(f=>f.file+':'+f.sha256).sort().join('\n'));
result.sourceClaim='working-tree; fingerprint identifies exact scanned bytes';
fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(path.join(outputDir,'inventory.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.summary,null,2));
const clean = value => String(value ?? '').replace(/[\t\r\n]/g,' ');
const source = row => `${row.file}:${row.line}:${row.column}`;
function tsv(name, header, rows) {
 fs.writeFileSync(path.join(outputDir,name),[header,...rows.map(row=>row.map(clean).join('\t'))].join('\n')+'\n');
}
for(const owner of ['D1','D2','D3','D4','D5','D6','D7']) {
 const rows=result.elements.filter(e=>e.kind==='control'&&e.tag==='button'&&e.zone===owner);
 tsv(`buttons-${owner}.tsv`,'id\tsource\tcontext\tlabel\tacceptance\tstatus',rows.map(e=>[e.id,source(e),e.scope,e.label||e.selector||'динамическая подпись',e.acceptance,e.reachable?'запланировано':'проверить подключение']));
}
for(const kind of ['window','screen','form']) {
 tsv(`${kind}s.tsv`,'id\tsource\towner\tcontext\tselector\tlabel\tstatus',result.elements.filter(e=>e.kind===kind).map(e=>[e.id,source(e),e.zone,e.scope,e.selector,e.label,e.reachable?'запланировано':'проверить подключение']));
}
const kindCodes={control:'c',choice:'o',candidate:'u',constructed:'d',surface:'p',screen:'s',window:'w',form:'f',listener:'l','create-element':'e','native-dialog':'n','delegated-selector':'q','render-call':'r',request:'a','property-handler':'h'};
const index={schema:'kafedra-ui-source-index-v1',sourceFingerprint:result.sourceFingerprint,kindCodes,recordFormat:'Each token is kind:line:column. Coordinates are 1-based UTF-16. File owner and planned status apply to every token. Reconstruct full labels, contexts, tags and acceptance with inventory.mjs; unknown runtime variants require R0.',status:'planned; runtime evidence pending',summary:{...result.summary,elements:result.elements.length,records:result.elements.length+result.calls.length+result.actions.length},files:result.files.map(f=>({file:f.file,sha256:f.sha256,owner:f.zone,reachable:f.reachable,elements:result.elements.filter(e=>e.file===f.file).map(e=>`${kindCodes[e.kind]}:${e.line}:${e.column}`).join(' '),calls:result.calls.filter(e=>e.file===f.file).map(e=>`${kindCodes[e.kind]}:${e.line}:${e.column}`).join(' ')})),actions:result.actions};
const indexText='{\n'+Object.entries(index).filter(([key])=>key!=='files').map(([key,value])=>JSON.stringify(key)+':'+JSON.stringify(value)).join(',\n')+',\n"files":[\n'+index.files.map(f=>JSON.stringify(f)).join(',\n')+'\n]}\n';
fs.writeFileSync(path.join(outputDir,'source-index.json'),indexText);
