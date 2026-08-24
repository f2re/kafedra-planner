import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entrypoint = await readFile(new URL('../deploy/install.sh', import.meta.url), 'utf8');
const core = await readFile(new URL('../deploy/install-core.sh', import.meta.url), 'utf8');
const builder = await readFile(new URL('../scripts/offline/build-bundle.sh', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../scripts/offline/doctor.sh', import.meta.url), 'utf8');

test('transactional entrypoint serializes updates and can recover an interrupted transaction', () => {
  assert.match(entrypoint, /flock -n 9/u);
  assert.match(entrypoint, /kafedra-planner-install\.lock/u);
  assert.match(entrypoint, /previous-current-kind/u);
  assert.match(entrypoint, /previous-current-target/u);
  assert.match(entrypoint, /config\.before/u);
  assert.match(entrypoint, /database\.existed/u);
  assert.match(entrypoint, /recover_transaction/u);
  assert.match(entrypoint, /rollback-failed/u);
  assert.match(entrypoint, /STALE_PHASE.*committed/su);
  assert.match(entrypoint, /health_request/u);
  assert.match(entrypoint, /trap on_unexpected_error ERR/u);
  assert.match(entrypoint, /SIGTERM во время обновления/u);
});

test('transactional entrypoint converts a legacy current directory only after verified service stop', () => {
  const flowStart = entrypoint.lastIndexOf('preflight_bundle\n');
  const stopIndex = entrypoint.indexOf('stop_services_verified', flowStart);
  const legacyIndex = entrypoint.indexOf('migrate_legacy_current', flowStart);
  const coreIndex = entrypoint.indexOf('run_core_installer', flowStart);
  assert.ok(flowStart >= 0 && stopIndex > flowStart && legacyIndex > stopIndex && coreIndex > legacyIndex);
  assert.match(entrypoint, /mv "\$APP_ROOT\/current" "\$legacy"/u);
  assert.match(entrypoint, /ln -s "\$legacy" "\$temp"/u);
  assert.match(entrypoint, /write_state backup-path/u);
  assert.match(entrypoint, /Данные восстановлены из проверенной точки отката/u);
});

test('bundle stages both the transactional entrypoint and immutable core installer', () => {
  assert.match(builder, /install -m 0755 "\$ROOT\/deploy\/install\.sh" "\$BUNDLE_ROOT\/install\.sh"/u);
  assert.match(builder, /install -m 0755 "\$ROOT\/deploy\/install-core\.sh" "\$BUNDLE_ROOT\/install-core\.sh"/u);
});

test('core installer identifies releases by version plus build identity and stages atomically', () => {
  assert.match(core, /RELEASE_ID=.*GIT_COMMIT/u);
  assert.match(core, /node\$\{RELEASE_NODE_VERSION#v\}/u);
  assert.match(core, /\.staging\.\$\$/u);
  assert.doesNotMatch(core, /RELEASE_DIR="\$APP_ROOT\/releases\/\$VERSION"/u);
});

test('core installer retries an existing release and verifies both services without curl', () => {
  assert.match(core, /уже (?:скопирован|выбран как current)/u);
  assert.match(core, /systemctl is-active --quiet "\$API_SERVICE"/u);
  assert.match(core, /systemctl is-active --quiet "\$WORKER_SERVICE"/u);
  assert.match(core, /require\("node:http"\)/u);
  assert.doesNotMatch(core, /\bcurl\b/u);
});

test('core treats operator config as data and validates deployment paths before its own service stop', () => {
  assert.match(core, /environment-file\.sh/u);
  assert.match(core, /kafedra_read_environment_file/u);
  assert.doesNotMatch(core, /source\s+["']?\$CONFIG_FILE/u);
  assert.doesNotMatch(core, /eval\s/u);
  assert.match(core, /validate_managed_deployment_paths/u);
  const validateIndex = core.indexOf('validate_managed_deployment_paths');
  const stopIndex = core.indexOf('systemctl stop "$API_SERVICE" "$WORKER_SERVICE"');
  assert.ok(validateIndex >= 0 && stopIndex >= 0 && validateIndex < stopIndex, 'path validation must happen before services are stopped');
});

test('offline doctor treats operator config as data', () => {
  assert.match(doctor, /environment-file\.sh/u);
  assert.match(doctor, /kafedra_read_environment_file/u);
  assert.doesNotMatch(doctor, /source\s+["']?\$CONFIG(?:\s|$)/u);
  assert.doesNotMatch(doctor, /eval\s/u);
});
