import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const scanner=path.join(dir,'inventory.mjs');
const checker=path.join(dir,'check.mjs');
function fixture(t) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'kafedra-ui-test-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 fs.mkdirSync(path.join(base,'public/nested'),{recursive:true});
 fs.mkdirSync(path.join(base,'apps/api/src'),{recursive:true});
 fs.writeFileSync(path.join(base,'public/index.html'),'<script type="module" src="/entry.js"></script><button id="root">Начать</button>');
 fs.writeFileSync(path.join(base,'public/entry.js'),"import './nested/child.js';\nexport const markup = `<form id=\"form\"><button>${['x'].map(x=>`<button data-choice>${x}</button>`).join('')}</button><select><option>A</option></select></form>`;\n");
 fs.writeFileSync(path.join(base,'public/nested/child.js'),"export function openDialog() { const node=document.createElement('div'); node.setAttribute('role','dialog'); node.id='programmed'; node.innerHTML='<button aria-label=\"Закрыть\">×</button><div role=\"status\">Готово</div>'; node.addEventListener('click',e=>e.target.closest('.row')); return node; }\nexport const row='<article class=\"row\">Запись</article>';\nopenDialog().catch(()=>{});\n");
 fs.writeFileSync(path.join(base,'public/injected.js'),"export const markup='<input type=\"file\" name=\"file\">';\n");
 fs.writeFileSync(path.join(base,'public/unused.js'),"export const hidden='<button>Старая</button>';\n");
 fs.writeFileSync(path.join(base,'apps/api/src/http-utils.mjs'),'export const html = `<script type="module" src="/injected.js"></script>`;\n');
 return base;
}
function run(base,out) {
 return spawnSync(process.execPath,[scanner,base,out],{encoding:'utf8',timeout:15000});
}
test('Учитываются серверные входы, вложенные шаблоны, DOM-окна и кандидаты',t=>{
 const base=fixture(t),out=path.join(base,'out');
 const r=run(base,out);assert.equal(r.status,0,r.stderr);
 const data=JSON.parse(fs.readFileSync(path.join(out,'inventory.json'),'utf8'));
 assert.equal(data.files.find(f=>f.file==='public/injected.js').reachable,true);
 assert.equal(data.files.find(f=>f.file==='public/nested/child.js').reachable,true);
 assert.equal(data.files.find(f=>f.file==='public/unused.js').reachable,false);
 assert.ok(data.elements.some(e=>e.attributes['data-choice']!==undefined&&e.tag==='button'));
 assert.ok(data.elements.some(e=>e.selector==='#programmed'&&e.kind==='window'));
 assert.ok(data.elements.some(e=>e.kind==='form'&&e.acceptance==='F01'));
 assert.ok(data.elements.some(e=>e.kind==='surface'&&e.acceptance==='S02'));
 assert.ok(data.elements.some(e=>e.kind==='candidate'&&e.attributes.class==='row'));
 assert.equal(new Set(data.calls.map(c=>c.id)).size,data.calls.length);
 assert.ok(data.elements.every(e=>e.runtimeEvidence===null));
});
test('Один исходник воспроизводит те же ведомости и индекс',t=>{
 const base=fixture(t),a=path.join(base,'a'),b=path.join(base,'b');
 assert.equal(run(base,a).status,0);assert.equal(run(base,b).status,0);
 for(const name of fs.readdirSync(a))assert.equal(fs.readFileSync(path.join(a,name),'utf8'),fs.readFileSync(path.join(b,name),'utf8'),name);
});
test('Неверный JavaScript останавливает сборку, а не пропускается',t=>{
 const base=fixture(t);fs.writeFileSync(path.join(base,'public/broken.js'),'export function {');
 const r=run(base,path.join(base,'out'));assert.notEqual(r.status,0);assert.match(r.stderr,/SyntaxError/);
});
test('Проверка обнаруживает изменение источника без обновления реестра',t=>{
 const base=fixture(t),out=path.join(base,'docs/design/full-interface');
 assert.equal(run(base,out).status,0);
 let r=spawnSync(process.execPath,[checker,base,out],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 fs.appendFileSync(path.join(base,'public/entry.js'),'\n// changed\n');
 r=spawnSync(process.execPath,[checker,base],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Исходник изменён/);
});
