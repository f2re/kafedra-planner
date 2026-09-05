import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchUploadMessage,
  protocolUploadCounts,
  uploadCountsText,
  uploadStateDescription
} from '../public/upload-feedback.js';

test('смешанный batch сообщает подтверждённый успех и ошибку отдельно', () => {
  assert.equal(uploadCountsText({ saved: 1, errors: 1 }), '1 сохранён, 1 ошибка');
  assert.equal(
    batchUploadMessage({ saved: 1, errors: 1 }),
    '1 сохранён, 1 ошибка. Обработка сохранённых документов продолжается.'
  );
});

test('ошибка без успешной загрузки не выдаётся за принятый документ', () => {
  assert.equal(batchUploadMessage({ saved: 0, errors: 2 }), '2 ошибки.');
  assert.doesNotMatch(batchUploadMessage({ saved: 0, errors: 2 }), /принят|сохранён/u);
});

test('протокольный summary считает сохранёнными только server-confirmed состояния', () => {
  const counts = protocolUploadCounts({
    ready: 1,
    needs_review: 1,
    processing: 2,
    failed: 1,
    uploading: 1
  });
  assert.deepEqual(counts, { saved: 4, errors: 1, uploading: 1 });
  assert.equal(uploadCountsText(counts), '4 сохранено, 1 ошибка, 1 загружается');
});

test('uploading и processing имеют разное происхождение результата', () => {
  assert.equal(
    uploadStateDescription({ state: 'uploading' }),
    'Файл загружается. Сохранение ещё не подтверждено сервером.'
  );
  assert.equal(
    uploadStateDescription({ state: 'processing' }),
    'Исходный файл сохранён; обработка продолжается.'
  );
  assert.equal(uploadStateDescription({ state: 'ready', agenda_count: 3 }), '3 вопросов распознано');
});
