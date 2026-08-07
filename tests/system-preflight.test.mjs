import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectSystem, renderPreflight, systemRequirements } from '../packages/system/src/preflight.mjs';

async function fakePath(commands) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-preflight-'));
  for (const command of commands) {
    const path = join(dir, command);
    await writeFile(path, '#!/bin/sh\nexit 0\n');
    await chmod(path, 0o755);
  }
  return dir;
}

const required = systemRequirements.filter((item) => item.required).map((item) => item.names[0]);

test('preflight блокирует установку при отсутствии обязательной системной команды', async () => {
  const pathEnv = await fakePath(required.filter((name) => name !== 'pdftotext'));
  try {
    const result = inspectSystem({ pathEnv, platform: 'linux' });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.requiredMissing, ['pdftotext']);
    assert.equal(result.capabilities.pdfText, false);
    assert.equal(result.runtime.nodeVersion, process.version);
    assert.equal(result.runtime.arch, process.arch);
    assert.match(renderPreflight(result), /Runtime:/);
    assert.match(renderPreflight(result), /установка заблокирована/i);
  } finally {
    await rm(pathEnv, { recursive: true, force: true });
  }
});

test('preflight отличает рабочее ядро от необязательных OCR/preview возможностей', async () => {
  const pathEnv = await fakePath(required);
  try {
    const result = inspectSystem({ pathEnv, platform: 'linux' });
    assert.equal(result.status, 'degraded');
    assert.equal(result.requiredMissing.length, 0);
    assert.equal(result.capabilities.backup, true);
    assert.equal(result.capabilities.serviceInstall, true);
    assert.equal(result.capabilities.officeExtract, true);
    assert.equal(result.capabilities.pdfText, true);
    assert.equal(result.capabilities.ocr, false);
    assert.equal(result.capabilities.officePreview, false);
  } finally {
    await rm(pathEnv, { recursive: true, force: true });
  }
});

test('полный preflight готов при наличии OCR, LibreOffice и reverse proxy', async () => {
  const pathEnv = await fakePath([...required, 'pdftoppm', 'tesseract', 'soffice', 'nginx']);
  try {
    const result = inspectSystem({ pathEnv, platform: 'linux' });
    assert.equal(result.status, 'ready');
    assert.equal(result.optionalMissing.length, 0);
    assert.equal(result.capabilities.ocr, true);
    assert.equal(result.capabilities.officePreview, true);
    assert.equal(result.capabilities.reverseProxy, true);
    assert.match(renderPreflight(result), /зависимости: готовы/i);
  } finally {
    await rm(pathEnv, { recursive: true, force: true });
  }
});
