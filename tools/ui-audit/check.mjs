import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]||'.');
const generated=process.argv[3]&&path.resolve(process.argv[3]);
const dir=path.join(root,'docs/design/full-interface');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const walk=(d,p='')=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name),p+e.name+'/'):[p+e.name]);
function expand(file) {
 const data=read(file);
 if(data.fileParts) {
  data.files=data.fileParts.flatMap(part=>{
   assert.match(part,/^source-index-[1-9][0-9]*\.json$/);
   return read(path.join(path.dirname(file),part));
  });
  delete data.fileParts;
 }
 return data;
}
try {
 const catalog=expand(path.join(dir,'source-index.json'));
 const actual=walk(path.join(root,'public')).filter(f=>/\.(js|html|css)$/.test(f)).map(f=>'public/'+f).concat('apps/api/src/http-utils.mjs').sort();
 assert.deepEqual(catalog.files.map(f=>f.file).sort(),actual,'Перечень исходников изменён: обновите реестр');
 const kinds=new Set(Object.values(catalog.kindCodes));
 const counts={}; let elements=0,calls=0;
 for(const file of catalog.files) {
  assert.match(file.owner,/^D[1-7]$/);
  const content=fs.readFileSync(path.join(root,file.file));
  assert.equal(hash(content),file.sha256,`Исходник изменён: ${file.file}`);
  const lines=content.toString('utf8').split('\n');
  for(const section of ['elements','calls']) {
   const tokens=file[section].trim().split(/\s+/).filter(Boolean);
   for(const token of tokens) {
    const match=/^([a-z]):([1-9][0-9]*):([1-9][0-9]*)$/.exec(token);
    assert.ok(match,`Неверная запись: ${file.file} ${token}`);
    const [,kind,line,column]=match;
    assert.ok(kinds.has(kind));
    assert.ok(Number(line)<=lines.length && Number(column)<=lines[Number(line)-1].length+1,`Позиция вне исходника: ${file.file} ${token}`);
    if(section==='elements')counts[kind]=(counts[kind]||0)+1;
   }
   if(section==='elements')elements+=tokens.length;else calls+=tokens.length;
  }
 }
 assert.equal(hash(catalog.files.map(f=>f.file+':'+f.sha256).sort().join('\n')),catalog.sourceFingerprint);
 assert.equal(catalog.files.length,catalog.summary.files);
 assert.equal(elements,catalog.summary.elements);
 assert.equal(calls,catalog.summary.calls);
 assert.equal(catalog.actions.length,catalog.summary.actions);
 assert.equal(elements+calls+catalog.actions.length,catalog.summary.records);
 for(const [field,code] of Object.entries({controls:'c',choices:'o',screens:'s',windows:'w',forms:'f'}))assert.equal(counts[code]||0,catalog.summary[field],field);
 assert.equal(new Set(catalog.actions.map(a=>a.id)).size,catalog.actions.length);
 const tsvs=[...Array.from({length:7},(_,i)=>`buttons-D${i+1}.tsv`),'windows.tsv','screens.tsv','forms.tsv'];
 let buttons=0;
 for(const name of tsvs) {
  const text=fs.readFileSync(path.join(dir,name),'utf8');
  const records=text.trimEnd().split('\n').slice(1).map(l=>l.split('\t'));
  assert.equal(new Set(records.map(r=>r[0])).size,records.length,`Повтор ID в ${name}`);
  for(const row of records) {
   const m=/^(.+):(\d+):(\d+)$/.exec(row[1]);
   assert.ok(m,`${name}: отсутствует точная ссылка`);
   const file=catalog.files.find(f=>f.file===m[1]);
   assert.ok(file);
   const kind=name.startsWith('buttons-')?'c':name==='windows.tsv'?'w':name==='screens.tsv'?'s':'f';
   assert.ok(file.elements.split(' ').includes(`${kind}:${m[2]}:${m[3]}`),`${name}: запись отсутствует в индексе`);
  }
  if(name.startsWith('buttons-'))buttons+=records.length;
  else assert.equal(records.length,catalog.summary[name.replace('.tsv','')]);
  if(generated)assert.equal(text,fs.readFileSync(path.join(generated,name),'utf8'),`Не воспроизводится ${name}`);
 }
 if(generated)assert.deepEqual(expand(path.join(generated,'source-index.json')),catalog,'Сборщик и сохранённый индекс различаются');
 console.log(`Исходный реестр согласован: ${catalog.files.length} файлов, ${catalog.summary.records} записей, ${buttons} кнопок. Браузерная приёмка этим не подтверждается.`);
} catch(error) {
 console.error(error.stack||error.message);process.exitCode=1;
}
