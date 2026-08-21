import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../packages/config/src/index.mjs';

const run = promisify(execFile);
const root = resolve('.');

async function fakeRuntime(base) {
  const runtime = join(base, 'runtime');
  await mkdir(join(runtime, 'bin'), { recursive: true });
  const server = join(runtime, 'bin', 'llama-server');
  await writeFile(server, `#!/bin/sh\nif [ "\${1}" = "--version" ]; then echo 'llama-server fake-b1'; exit 0; fi\nexit 0\n`);
  await chmod(server, 0o755);
  await writeFile(join(runtime, 'LICENSE'), 'MIT fixture');
  return runtime;
}

test('LLM payload сохраняет runtime и несколько GGUF с проверяемым manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-llm-payload-'));
  try {
    const runtime = await fakeRuntime(dir);
    const qwen = join(dir, 'qwen.gguf');
    const small = join(dir, 'small.gguf');
    await writeFile(qwen, Buffer.from('GGUF-qwen-fixture'));
    await writeFile(small, Buffer.from('GGUF-small-fixture'));
    const output = join(dir, 'payload');
    await run('bash', [join(root, 'scripts/offline/prepare-llm-payload.sh'),
      '--llama-runtime', runtime,
      '--model', `qwen=${qwen}`,
      '--model', `small=${small}`,
      '--default-model', 'qwen',
      '--context-size', '16384',
      '--threads', '4',
      '--parallel', '2',
      '--output', output
    ]);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'kafedra-planner-llm-payload');
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.enabledByDefault, true);
    assert.equal(manifest.defaultModel, 'qwen');
    assert.equal(manifest.server.host, '127.0.0.1');
    assert.equal(manifest.server.contextSize, 16384);
    assert.equal(manifest.server.threads, 4);
    assert.equal(manifest.server.parallel, 2);
    assert.equal(manifest.models.length, 2);
    assert.match(manifest.models[0].sha256, /^[0-9a-f]{64}$/u);
    await run(process.execPath, [join(root, 'scripts/offline/llm-contract.mjs'), 'verify', '--root', output]);
    const values = (await run(process.execPath, [join(root, 'scripts/offline/llm-contract.mjs'), 'values', '--root', output])).stdout.trim().split('\n');
    assert.equal(values[0], 'true');
    assert.equal(values[1], 'qwen');
    assert.equal(values[8], '2');

    await writeFile(join(output, 'models', 'qwen.gguf'), Buffer.from('tampered'));
    await assert.rejects(
      () => run(process.execPath, [join(root, 'scripts/offline/llm-contract.mjs'), 'verify', '--root', output]),
      /manifest не соответствует runtime\/models|сигнатуры GGUF/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('подготовщик требует лицензию и запускаемый llama-server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-llm-runtime-invalid-'));
  try {
    const runtime = join(dir, 'runtime');
    await mkdir(join(runtime, 'bin'), { recursive: true });
    const server = join(runtime, 'bin', 'llama-server');
    await writeFile(server, '#!/bin/sh\nexit 7\n');
    await chmod(server, 0o755);
    const model = join(dir, 'model.gguf');
    await writeFile(model, 'GGUF');
    await assert.rejects(
      () => run('bash', [join(root, 'scripts/offline/prepare-llm-payload.sh'),
        '--llama-runtime', runtime, '--model', `qwen=${model}`, '--output', join(dir, 'missing-license')]),
      /LICENSE|COPYING/u
    );
    await writeFile(join(runtime, 'LICENSE'), 'MIT fixture');
    await assert.rejects(
      () => run('bash', [join(root, 'scripts/offline/prepare-llm-payload.sh'),
        '--llama-runtime', runtime, '--model', `qwen=${model}`, '--output', join(dir, 'broken-server')]),
      /не запускается с --version/u
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('подготовщик отклоняет небезопасный alias и отсутствие GGUF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-llm-invalid-'));
  try {
    const runtime = await fakeRuntime(dir);
    const model = join(dir, 'model.gguf');
    await writeFile(model, 'fixture');
    await assert.rejects(
      () => run('bash', [join(root, 'scripts/offline/prepare-llm-payload.sh'),
        '--llama-runtime', runtime, '--model', `../escape=${model}`, '--output', join(dir, 'bad')]),
      /Некорректная модель/u
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('конфигурация managed LLM ограничивает числовые параметры', () => {
  const config = loadConfig({
    KAFEDRA_LLM_ENABLED: 'true', KAFEDRA_LLM_MANAGED: 'true',
    KAFEDRA_LLM_HOST: '127.0.0.1', KAFEDRA_LLM_PORT: '18081',
    KAFEDRA_LLM_MODEL: 'qwen', KAFEDRA_LLM_MODEL_PATH: '/var/lib/kafedra-planner/models/a.gguf',
    KAFEDRA_LLM_CONTEXT_SIZE: '16384', KAFEDRA_LLM_THREADS: '6', KAFEDRA_LLM_PARALLEL: '2',
    KAFEDRA_LLM_START_TIMEOUT_SECONDS: '240'
  }, '/tmp');
  assert.equal(config.llmEnabled, true);
  assert.equal(config.llmManaged, true);
  assert.equal(config.llmPort, 18081);
  assert.equal(config.llmContextSize, 16384);
  assert.equal(config.llmThreads, 6);
  assert.equal(config.llmParallel, 2);
  assert.equal(config.llmStartTimeoutSeconds, 240);
});

test('run-llama-server передаёт только локальный host, alias и путь модели', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-llm-runner-'));
  try {
    const app = join(dir, 'app');
    await mkdir(join(app, 'scripts', 'offline'), { recursive: true });
    await mkdir(join(app, 'runtime', 'llama', 'bin'), { recursive: true });
    await writeFile(join(app, 'scripts', 'offline', 'environment-file.sh'), await readFile(join(root, 'scripts/offline/environment-file.sh')));
    await writeFile(join(app, 'scripts', 'offline', 'run-llama-server.sh'), await readFile(join(root, 'scripts/offline/run-llama-server.sh')));
    await chmod(join(app, 'scripts', 'offline', 'run-llama-server.sh'), 0o755);
    const argsFile = join(dir, 'args.txt');
    const fake = join(app, 'runtime', 'llama', 'bin', 'llama-server');
    await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n`);
    await chmod(fake, 0o755);
    const model = join(dir, 'model.gguf');
    await writeFile(model, 'GGUF');
    const config = join(dir, 'kafedra.env');
    await writeFile(config, [
      'KAFEDRA_LLM_ENABLED=true', 'KAFEDRA_LLM_MANAGED=true', 'KAFEDRA_LLM_HOST=127.0.0.1',
      'KAFEDRA_LLM_PORT=18081', 'KAFEDRA_LLM_MODEL=qwen', `KAFEDRA_LLM_MODEL_PATH=${model}`,
      'KAFEDRA_LLM_CONTEXT_SIZE=4096', 'KAFEDRA_LLM_THREADS=3', 'KAFEDRA_LLM_PARALLEL=2'
    ].join('\n') + '\n');
    await run('bash', [join(app, 'scripts', 'offline', 'run-llama-server.sh')], {
      env: { ...process.env, KAFEDRA_APPLICATION_DIR: app, KAFEDRA_CONFIG_PATH: config }
    });
    const args = (await readFile(argsFile, 'utf8')).trim().split('\n');
    assert.deepEqual(args, ['--host','127.0.0.1','--port','18081','--model',model,'--alias','qwen','--ctx-size','4096','--parallel','2','--threads','3']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
