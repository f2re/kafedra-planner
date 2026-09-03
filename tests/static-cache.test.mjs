import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveStatic } from '../apps/api/src/http-utils.mjs';

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = Buffer.alloc(0)) {
      this.body = Buffer.from(body);
    }
  };
}

test('нефингерпринтованные HTML, JS и CSS всегда перепроверяются после обновления', async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'kafedra-static-cache-'));
  try {
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><body>0.4.2</body>', 'utf8');
    await writeFile(join(publicDir, 'app.js'), 'window.release="0.4.2";', 'utf8');
    await writeFile(join(publicDir, 'app.css'), 'body{display:block}', 'utf8');

    for (const pathname of ['/', '/index.html', '/app.js', '/app.css']) {
      const response = responseRecorder();
      assert.equal(await serveStatic(response, publicDir, pathname), true);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.ok(response.body.length > 0);
    }
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test('статическая раздача не раскрывает путь за пределами public', async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'kafedra-static-safe-'));
  try {
    const response = responseRecorder();
    assert.equal(await serveStatic(response, publicDir, '/../VERSION'), false);
    assert.equal(response.status, null);
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});
