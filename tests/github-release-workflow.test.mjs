import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const workflowPath = resolve('.github/workflows/release.yml');

test('GitHub release workflow publishes only a verified standard offline bundle', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.match(workflow, /tags:\s*\[['"]v\*['"]\]/u);
  assert.match(workflow, /test "\$GITHUB_REF_NAME" = "v\$VERSION"/u);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/u);
  assert.match(workflow, /npm run backup:selftest/u);
  assert.match(workflow, /build-full-bundle\.sh/u);
  assert.match(workflow, /verify-bundle\.sh/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /gh release create/u);
  assert.match(workflow, /--prerelease/u);
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /install-kafedra-planner\.sh/u);
  assert.match(workflow, /README-INSTALL\.txt/u);
  assert.doesNotMatch(workflow, /bundle:offline:llm|GGUF|llama/iu);
});
