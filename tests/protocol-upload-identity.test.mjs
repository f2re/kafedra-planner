import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { protocolUploadIdentity, sha256Bytes } from '../public/protocol-upload-identity.js';
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
test('идентичность массовой загрузки определяется байтами на HTTP и изолирована по рабочей области',async()=>{
  for(const length of [0,1,55,56,63,64,65,8192,9000]){const bytes=Uint8Array.from({length},(_,i)=>i%256);assert.equal(sha256Bytes(bytes),hash(bytes));}
  const file=new Blob(['Проверка UTF-8\u0000\u00ff']);const other=new Blob(['Проверка UTF-8\u0001\u00ff']);
  const key=await protocolUploadIdentity(file,2026,'ws_main');assert.match(key,/^protocol-year:2026:[a-f0-9]{64}$/u);
  assert.equal(await protocolUploadIdentity(file,2026,'ws_main'),key);
  assert.notEqual(await protocolUploadIdentity(other,2026,'ws_main'),key);assert.notEqual(await protocolUploadIdentity(file,2026,'another'),key);
  const sha256=hash(new Uint8Array(await file.arrayBuffer()));
  const legacy={sha256,import_year:2026,upload_key:`protocol-year:2026:${sha256}`};
  assert.equal(await protocolUploadIdentity(file,2026,'ws_main',[legacy]),legacy.upload_key);
  await assert.rejects(()=>protocolUploadIdentity(file,2026,''),/область/);
});
