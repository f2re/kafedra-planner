import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the universal release includes the current search scenarios exactly once', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const path of ['tests/browser/search-assistant.spec.mjs', 'tests/browser/faceted-search.spec.mjs', 'tests/browser/search-routing.spec.mjs']) {
    assert.equal(workflow.split(path).length - 1, 1, path);
  }
  assert.match(workflow, /build-release-targets\.sh/u);
  assert.match(workflow, /verify-release-targets\.sh/u);
  assert.doesNotMatch(workflow, /workflow_run:|gh workflow run/u);
});
