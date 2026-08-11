import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../deploy/install.sh', import.meta.url), 'utf8');

test('installer identifies releases by version plus build identity and stages atomically', () => {
  assert.match(script, /RELEASE_ID=.*GIT_COMMIT/u);
  assert.match(script, /node\$\{RELEASE_NODE_VERSION#v\}/u);
  assert.match(script, /\.staging\.\$\$/u);
  assert.doesNotMatch(script, /RELEASE_DIR="\$APP_ROOT\/releases\/\$VERSION"/u);
});

test('installer retries an existing release and verifies both services without curl', () => {
  assert.match(script, /уже (?:скопирован|выбран как current)/u);
  assert.match(script, /systemctl is-active --quiet "\$API_SERVICE"/u);
  assert.match(script, /systemctl is-active --quiet "\$WORKER_SERVICE"/u);
  assert.match(script, /require\("node:http"\)/u);
  assert.doesNotMatch(script, /\bcurl\b/u);
});
