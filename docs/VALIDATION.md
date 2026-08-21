# Автоматическая проверка release candidate

Актуальный рубеж: `0.1.0-rc.6`, схема SQLite **19**. Автоматический gate проверяет код и поставочный контракт, но не подменяет фактическую приёмку #27 на Astra Linux/Debian.

## Статические и Node-проверки

На PR и push в `main` выполняются:

- `npm run check`: syntax check JavaScript + согласованность README/docs с реальными scripts/paths;
- `npm test`: unit/integration;
- `npm run smoke`;
- backup create/verify/restore self-test;
- shell/Python syntax поставочных скриптов;
- system preflight;
- тот же набор на минимальном Node 24.15;
- runtime-only builder под host Node 25, чтобы host/runtime оставались разделены.

## Browser release gate

Реальный Chromium проверяет:

```bash
npm run test:browser:plans
npm run test:browser:core
npm run test:browser:reports-science
npm run test:browser:plan-fact
npm run test:browser:auth
npm run test:browser:release
npm run test:browser:acl
```

Проверяются desktop/mobile, планы, календарь, документы, заседания, plan/fact, auth, release readiness и объектный доступ.

## Full offline gate

После базовых jobs CI:

1. собирает target-specific Debian 12 full bundle;
2. проверяет ordinary APT plan и настоящий bundled `file:` fallback;
3. проверяет managed Python, Tesseract `rus+eng`, Poppler, LibreOffice, migrations и HTTP health;
4. разворачивает ordinary bundle в чистой systemd-среде без сети;
5. проверяет повторную idempotent установку/update;
6. отдельно собирает LLM-вариант с fake `llama-server` и двумя fake GGUF;
7. разворачивает LLM bundle без сети и проверяет systemd, health/models, повторный install, forced rollback с сохранением model cache и отключение LLM при работающих API/worker.

Fake LLM fixture не публикуется как production artifact и не заменяет реальную LLM/Astra приёмку.

## Публикация

На PR artifact не публикуется. Full ordinary offline artifact публикуется только на `push` в `main`/ручном workflow, после успешного full-offline job.

## Граница автоматической проверки

До stable на реальной целевой машине нужно подтвердить:

- embedded Node/glibc совместимость;
- реальный OCR/LibreOffice на ведомственных файлах;
- install/update существующей базы;
- зашифрованный backup/restore и equality acceptance evidence;
- forced rollback;
- права каталогов и systemd hardening;
- desktop/mobile UX оператором;
- при использовании LLM — настоящий `llama-server` и GGUF.

Процедура: [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md).
