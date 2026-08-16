import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../deploy/install.sh', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../scripts/offline/doctor.sh', import.meta.url), 'utf8');

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

test('installer treats operator config as data and validates deployment paths before service stop', () => {
  assert.match(script, /environment-file\.sh/u);
  assert.match(script, /kafedra_read_environment_file/u);
  assert.doesNotMatch(script, /source\s+["']?\$CONFIG_FILE/u);
  assert.doesNotMatch(script, /eval\s/u);
  assert.match(script, /validate_managed_deployment_paths/u);
  const validateIndex = script.indexOf('validate_managed_deployment_paths');
  const stopIndex = script.indexOf('systemctl stop "$API_SERVICE" "$WORKER_SERVICE"');
  assert.ok(validateIndex >= 0 && stopIndex >= 0 && validateIndex < stopIndex, 'path validation must happen before services are stopped');
});

test('offline doctor treats operator config as data', () => {
  assert.match(doctor, /environment-file\.sh/u);
  assert.match(doctor, /kafedra_read_environment_file/u);
  assert.doesNotMatch(doctor, /source\s+["']?\$CONFIG(?:\s|$)/u);
  assert.doesNotMatch(doctor, /eval\s/u);
});
