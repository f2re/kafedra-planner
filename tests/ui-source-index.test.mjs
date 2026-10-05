import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Каталог интерфейса соответствует всем текущим исходникам и ведомостям',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'tools/ui-audit/check.mjs'),root],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr||result.error?.message||result.stdout);
 assert.match(result.stdout,/Исходный реестр согласован/);
});
