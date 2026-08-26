# Автоматическая проверка release candidate

Актуальный рубеж: `0.3.4`, схема SQLite **29**. Автоматический gate проверяет код, данные, browser UX и поставочный контракт, но не подменяет фактическую приёмку #27 на Astra Linux/Debian.

## Статические и Node-проверки

На PR и push в `main` выполняются:

- `npm run check`: синтаксис JavaScript, согласованность README/docs с реальными scripts/paths и единая текущая версия в `VERSION`, `package.json`, RU/EN README, ROADMAP, release/validation/UX-документах и workflow;
- `npm test`: полный unit/integration suite;
- `npm run smoke`;
- backup create/verify/restore self-test;
- shell/Python syntax поставочных скриптов;
- system preflight;
- тот же набор на минимальном Node 24.15;
- runtime-only builder под host Node 25, чтобы host/runtime оставались разделены.

Unit/integration отдельно проверяют:

- миграции старых поддерживаемых схем до 29;
- `PRAGMA quick_check` и `foreign_key_check`;
- immutable blob и SHA-256;
- сохранение `source_document_version_id`, `plan_item`, calendar origin, assignment и evidence;
- исходные строки плана и идемпотентное разложение одной строки на несколько задач;
- точное автоматическое сопоставление ответственного, контролирующего из оргструктуры, отсутствие назначения при неоднозначности и сохранение terminal assignment;
- impact summary, archive/restore, self/cross-workspace/cycle guards;
- настройки Оформлятора без PIN, внешние связи сотрудников, upgrade `27 → 28` и field mapping `28 → 29`;
- mock health/readiness/auth/data, discovery property definitions, выбор e-mail/должности/дополнительных полей, первый и повторный импорт, rename/inactive без дублей;
- backup/restore и logical digest lifecycle/replacement/integration-состояния.

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

`test:browser:plans` включает desktop/mobile сценарии:

- DOCX с русским именем → исходные строки/ячейки → автоматические поля;
- одна строка → две задачи → несколько исполнителей;
- импорт плана → следующий период → календарь → источник;
- ручной план → поручение → отчёт → подтверждение → DOCX;
- документ → русские состояния → переименование → impact → архив с заменой → восстановление;
- план → impact → архив с преемником → проверка неизменных календарных/предметных ссылок → восстановление.

Дополнительные desktop/mobile сценарии проверяют:

- точную цепочку `upload documentId → source planId → конкретный сотрудник → поручение` при уже существующих данных;
- Оформлятор: адрес → порт → health/readiness/data → пространство → группа → preview → идемпотентный импорт.

Lifecycle-действия и код внешней системы не считаются обучаемым выбором. Desktop и mobile проходят один предметный сценарий с разной компоновкой.

## Release gate 0.3.3

Обязательный агрегирующий workflow требует успешного завершения:

- quality: check, unit/integration и smoke;
- migrations/backup: организация, Оформлятор, наука, source rows, lifecycle, acceptance evidence и restore;
- browser: организация, импорт сотрудников, научные сценарии, source rows, lifecycle и автоматические назначения.

Failure, cancelled, pending или неожиданно skipped не считаются зелёным результатом.

Все обязательные post-merge workflow поддерживают `workflow_dispatch`. Publisher классифицирует результат по фактическим jobs:

- queued/in-progress jobs ожидаются;
- все completed jobs должны иметь `success`;
- top-level `startup_failure`/`failure` с фактически успешными jobs не подменяет результат jobs;
- реальная job failure/cancelled/skipped немедленно останавливает выпуск и не повторяется автоматически;
- run без выполняемых jobs допускает только один explicit dispatch;
- второй инфраструктурный отказ не скрывается;
- перед retry и публикацией `main` должен точно совпадать с `SOURCE_SHA`.

## Full offline gate

После базовых jobs CI:

1. собирает target-specific Debian 12 full bundle;
2. проверяет ordinary APT plan и настоящий bundled `file:` fallback;
3. проверяет managed Python, Tesseract `rus+eng`, Poppler, LibreOffice, migrations и HTTP health;
4. разворачивает ordinary bundle в чистой systemd-среде без сети;
5. проверяет повторную idempotent установку/update;
6. отдельно собирает LLM-вариант с fake `llama-server` и двумя fake GGUF;
7. разворачивает LLM bundle без сети и проверяет systemd, health/models, повторный install, forced rollback с сохранением model cache и отключение LLM при работающих API/worker.

Fake LLM fixture и mock Оформлятора не публикуются как production assets и не заменяют реальную целевую приёмку.

## Публикация

На PR release artifact не публикуется. После squash merge workflow публикации привязывается к точному SHA нового `main` и ждёт успешного завершения всех обязательных post-merge workflows:

- `Проверка`;
- `Release gate 0.3.3`;
- `Оргструктура`;
- `Научные отчёты`;
- `Научный жизненный цикл`;
- `Массовый импорт науки`.

Только после этого повторно запускаются check/test/smoke/backup, browser plans, automatic-assignment и Docomator E2E, собираются full offline bundle и F2RE Project Control package, проверяются SHA-256, создаётся GitHub Release `v0.3.3` и подтверждается, что тег указывает на тот же SHA `main`.

Существующий тег с другим SHA считается ошибкой и не перезаписывается молча.

## Граница автоматической проверки

До stable на реальной целевой машине нужно подтвердить:

- embedded Node/glibc совместимость;
- реальный OCR/LibreOffice на ведомственных файлах;
- install/update существующей базы до схемы 28;
- сохранение plan source rows, lifecycle, replacement, automatic assignment evidence, Docomator links и blob;
- зашифрованный backup/restore и equality acceptance evidence;
- forced rollback;
- права каталогов и systemd hardening;
- desktop/mobile UX оператором;
- при доступной интеграции — реальный Оформлятор в локальной сети;
- при использовании LLM — настоящий `llama-server` и GGUF.

Процедура: [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md).
