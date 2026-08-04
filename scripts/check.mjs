import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';

const roots = ['apps', 'packages', 'public', 'scripts', 'tests'];
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'release') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (['.mjs', '.js'].includes(extname(entry.name))) files.push(child);
  }
}
for (const root of roots) await walk(root);

for (const file of files) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${file}`)));
  });
}
console.log(`Проверено модулей: ${files.length}`);
