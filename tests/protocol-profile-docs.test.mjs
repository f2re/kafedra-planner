import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('protocol profile contract documents real-sample acceptance boundary', async () => {
  const text = await readFile(new URL('../docs/PROTOCOL_PROFILES.md', import.meta.url), 'utf8');
  assert.match(text, /document_type = department_protocol/u);
  assert.match(text, /extraction_run\.result_json\.protocol\.profileFields/u);
  assert.match(text, /двух обезличенных реальных документов/u);
  assert.match(text, /LLM.*не используется/u);
});
