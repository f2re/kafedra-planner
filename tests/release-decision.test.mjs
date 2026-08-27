import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decideRelease, githubOutput } from '../scripts/release/release-decision.mjs';

const source = '2a7f485fb4f88713d11222c5123bab4ae4ac7634';
const released = '12778e50f0eb2cd8d283b579dac986ab87aa41fb';

function base(overrides = {}) {
  return {
    version: '0.3.3',
    sourceSha: source,
    parentVersion: '0.3.3',
    releaseExists: false,
    tagExists: false,
    tagSha: '',
    tagIsAncestor: false,
    ...overrides
  };
}

test('отсутствующий release требует публикации', () => {
  const decision = decideRelease(base());
  assert.equal(decision.publish, true);
  assert.equal(decision.exists, false);
  assert.equal(decision.reason, 'new_version');
  assert.match(githubOutput(decision), /publish=true/u);
});

test('release текущего commit является идемпотентным no-op', () => {
  const decision = decideRelease(base({ releaseExists: true, tagExists: true, tagSha: source }));
  assert.equal(decision.publish, false);
  assert.equal(decision.reason, 'already_published_current');
});

test('неизменившаяся версия сохраняет release предыдущего commit-предка', () => {
  const decision = decideRelease(base({
    releaseExists: true,
    tagExists: true,
    tagSha: released,
    tagIsAncestor: true
  }));
  assert.equal(decision.publish, false);
  assert.equal(decision.exists, true);
  assert.equal(decision.reason, 'version_already_published');
  assert.equal(decision.releaseSha, released);
});

test('повторное использование опубликованной версии блокируется', () => {
  assert.throws(() => decideRelease(base({
    parentVersion: '0.3.2',
    releaseExists: true,
    tagExists: true,
    tagSha: released,
    tagIsAncestor: true
  })), (error) => error?.code === 'release_version_reused');
});

test('release без тега и тег без release считаются повреждением', () => {
  assert.throws(() => decideRelease(base({ releaseExists: true })),
    (error) => error?.code === 'release_without_tag');
  assert.throws(() => decideRelease(base({ tagExists: true, tagSha: released })),
    (error) => error?.code === 'release_tag_without_release');
});

test('release из другой истории не скрывается как обычный no-op', () => {
  assert.throws(() => decideRelease(base({
    releaseExists: true,
    tagExists: true,
    tagSha: released,
    tagIsAncestor: false
  })), (error) => error?.code === 'release_tag_not_ancestor');
});


test('workflow публикует только при явном решении publish=true', async () => {
  const workflow = await readFile(resolve('.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /scripts\/release\/release-decision\.mjs/u);
  assert.match(workflow, /contents\/VERSION\?ref=\$PARENT_SHA/u);
  assert.match(workflow, /if: steps\.release\.outputs\.publish == 'true'/u);
  assert.doesNotMatch(workflow, /steps\.release\.outputs\.exists != 'true'/u);
});
