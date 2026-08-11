import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOTS = ['apps', 'packages', 'scripts'];
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const BARE_IMPORT = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu;

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full));
    else if (entry.isFile() && JS_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

test('production runtime has no external npm imports', async () => {
  const external = [];
  for (const root of ROOTS) {
    for (const file of await collectFiles(root)) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(BARE_IMPORT)) {
        const specifier = match[1];
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
        external.push(`${file}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(external, [], `Runtime unexpectedly depends on npm packages:\n${external.join('\n')}`);
});
