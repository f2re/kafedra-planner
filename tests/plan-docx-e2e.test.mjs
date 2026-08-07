import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitFor(url, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (!predicate || predicate(body)) return body;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
}

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map(cell).join('')}</w:tr>`;
}

function templateXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на </w:t></w:r><w:r><w:t>2026</w:t></w:r><w:r><w:t>/</w:t></w:r><w:r><w:t>2027</w:t></w:r><w:r><w:t> учебный год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Образец мероприятия', '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}

async function createTemplate(path) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml()
  });
}

test('сквозной DOCX-шаблон: анализ → сохранение → год и строки → worker → план и календарь', { timeout: 40_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-plan-template-e2e-'));
  const sourcePath = join(dataDir, 'template.docx');
  await createTemplate(sourcePath);
  const port = await freePort();
  const env = {
    ...process.env,
    KAFEDRA_DATA_DIR: dataDir,
    KAFEDRA_DATABASE_PATH: join(dataDir, 'e2e.sqlite3'),
    KAFEDRA_PORT: String(port),
    KAFEDRA_HOST: '127.0.0.1',
    KAFEDRA_WORKER_POLL_MS: '50',
    KAFEDRA_LOG_LEVEL: 'error',
    KAFEDRA_AUTH_ENABLED: 'false',
    KAFEDRA_PREVIEW_ENABLED: 'false'
  };
  const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const worker = spawn(process.execPath, ['apps/worker/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${port}/api/system/health`, (body) => body.status === 'ok');
    const upload = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'x-file-name': encodeURIComponent('Образец плана кафедры.docx'),
        'x-document-type': 'plan',
        'idempotency-key': 'plan-template-source'
      },
      body: await readFile(sourcePath)
    });
    assert.equal(upload.status, 202);
    const accepted = await upload.json();
    await waitFor(
      `http://127.0.0.1:${port}/api/documents/${accepted.documentId}`,
      (body) => ['processed', 'needs_review'].includes(body.processing_status)
    );

    const analyzedResponse = await fetch(`http://127.0.0.1:${port}/api/plan-templates/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: accepted.documentId, planKind: 'department' })
    });
    assert.equal(analyzedResponse.status, 200);
    const analyzed = await analyzedResponse.json();
    assert.equal(analyzed.ready, true);
    assert.equal(analyzed.detectedPeriod.kind, 'academic');
    assert.equal(analyzed.suggestedConfig.columns.title, 2);

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/plan-templates`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: accepted.documentId, name: 'План кафедры', planKind: 'department' })
    });
    assert.equal(createResponse.status, 201);
    const template = await createResponse.json();
    assert.equal(template.plan_kind, 'department');

    const request = {
      idempotencyKey: 'department-2027-28-v1',
      targetPeriod: { periodKind: 'academic', periodKey: '2027/28' },
      items: [
        {
          title: 'Провести установочное заседание кафедры',
          startsAt: '2027-09-10', responsibleRaw: 'Иванов Иван Иванович',
          expectedResult: 'Протокол', direction: 'organizational'
        },
        {
          title: 'Подготовить годовой отчёт по НИР',
          dueDate: '2027-10-20', responsibleRaw: 'Петров Пётр Петрович',
          expectedResult: 'Отчёт', direction: 'science'
        }
      ]
    };
    const generationResponse = await fetch(`http://127.0.0.1:${port}/api/plan-templates/${template.id}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    assert.equal(generationResponse.status, 202);
    const generation = await generationResponse.json();
    assert.equal(generation.status, 'completed');
    assert.ok(generation.generated_document_id);
    const generatedDocument = await waitFor(
      `http://127.0.0.1:${port}/api/documents/${generation.generated_document_id}`,
      (body) => ['processed', 'needs_review', 'failed'].includes(body.processing_status)
    );
    assert.notEqual(generatedDocument.processing_status, 'failed');
    assert.equal(generatedDocument.document_type, 'department_plan');

    const plans = await (await fetch(`http://127.0.0.1:${port}/api/plans?periodKey=2027%2F28`)).json();
    assert.equal(plans.items.length, 1);
    assert.equal(plans.items[0].item_count, 2);
    const plan = await (await fetch(`http://127.0.0.1:${port}/api/plans/${plans.items[0].id}`)).json();
    assert.ok(plan.items.some((item) => item.starts_at === '2027-09-10'));
    assert.ok(plan.items.some((item) => item.due_date === '2027-10-20'));

    const calendar = await (await fetch(`http://127.0.0.1:${port}/api/calendar?from=2027-09-01&to=2027-10-31`)).json();
    const generatedCalendar = calendar.items.filter((item) => item.origin_document_id === generation.generated_document_id);
    assert.equal(generatedCalendar.length, 2);
    assert.ok(generatedCalendar.some((item) => item.item_kind === 'task' && item.starts_at === '2027-10-20'));

    const duplicateResponse = await fetch(`http://127.0.0.1:${port}/api/plan-templates/${template.id}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    assert.equal(duplicateResponse.status, 200);
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.duplicateRequest, true);
    assert.equal(duplicate.generated_document_id, generation.generated_document_id);

    const conflictResponse = await fetch(`http://127.0.0.1:${port}/api/plan-templates/${template.id}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, items: [{ ...request.items[0], title: 'Другой план' }] })
    });
    assert.equal(conflictResponse.status, 409);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.error.code, 'plan_generation_idempotency_conflict');

    const runs = await (await fetch(`http://127.0.0.1:${port}/api/plan-templates/${template.id}/generations`)).json();
    assert.equal(runs.items.length, 1);
    assert.equal(runs.items[0].status, 'completed');
  } finally {
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await Promise.allSettled([
      new Promise((resolveExit) => api.once('exit', resolveExit)),
      new Promise((resolveExit) => worker.once('exit', resolveExit))
    ]);
    await rm(dataDir, { recursive: true, force: true });
  }
});
