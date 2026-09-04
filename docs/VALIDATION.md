# Автоматическая проверка release candidate

Актуальный рубеж: `0.4.3`, схема SQLite **31**. Автоматический gate проверяет код, данные, desktop/mobile UX и поставочный контракт, но не подменяет фактическую приёмку #27 на Astra Linux/Debian.

## Обычный pull request

Обычный PR проверяется по риску изменения. Базовый контур:

- `npm run check`;
- полный unit/integration suite через `npm test`;
- `npm run smoke`;
- regression затронутого пользовательского сценария;
- для UI — targeted Playwright desktop/mobile только там, где затронуты обе компоновки.

Schema/storage, auth/ACL и deployment получают дополнительные тяжёлые gates только когда соответствующий риск реально затронут. Feature PR не запускает тяжёлый release gate только ради будущего выпуска.

## Unit/integration инварианты

Проверки подтверждают:

- последовательные migrations до schema 31 и отсутствие destructive reset;
- `PRAGMA quick_check` и `PRAGMA foreign_key_check` в recovery/release контуре;
- immutable blobs, SHA-256, `document_version` и evidence/locator;
- планы, реальные source rows/cells и идемпотентные назначения;
- lifecycle документов/планов без перепривязки истории;
- шаблоны заседаний и точные исторические версии;
- academic performance и сохранность метаполей;
- Docomator URL normalization, current/legacy readiness, classified failures и partial/idempotent import;
- годовой импорт протоколов: multi-file partial success, year mismatch review, empty-source recovery, selective review resolution и неизменность raw extraction после ручной правки;
- archive staging из user-owned каталога без archived owners/permissions;
- active UI file verification и `Cache-Control: no-store`.

## Browser suites

Обычный проектный CI сохраняет существующие специализированные команды:

```bash
npm run test:browser:plans
npm run test:browser:core
npm run test:browser:academic
npm run test:browser:reports-science
npm run test:browser:plan-fact
npm run test:browser:auth
npm run test:browser:release
npm run test:browser:acl
```

Ключевой новый сценарий `tests/browser/protocol-import.spec.mjs` проверяет desktop/mobile путь `год → несколько протоколов → пофайловая сводка → исправить исключение → reload → повтор без дублей`.

## Release gate

Универсальный workflow **Release gate** не содержит номер версии и запускается только на `main` либо вручную. Он агрегирует три независимых результата:

1. `release-quality` — `npm run check`, полный `npm test`, smoke;
2. `release-recovery` — существующие migration/recovery regressions, backup/restore и backup self-test;
3. `release-browser-critical` — критические desktop/mobile пользовательские сценарии, включая годовой импорт протоколов, заседания, планы, назначения, Оформлятор, учебный процесс, PIN и ACL.

`failure`, `cancelled`, `pending`, `missing` или неожиданно `skipped` не считаются успешным release evidence.

## Publisher: без дублирования CI

`Публикация GitHub Release` запускается после успешного `Release gate` на push в `main` или вручную для текущего `main`.

Publisher **не**:

- ждёт отдельные workflows науки, оргструктуры, GRACE или обычного CI;
- выполняет `gh workflow run` для их повторного запуска;
- повторяет `npm test` или Playwright, уже доказанные gate на exact SHA.

Перед сборкой и непосредственно перед публикацией publisher сверяет `SOURCE_SHA` с фактическим `main`.

## Build once → verify → publish same artifact

Publisher один раз собирает полный Debian 12 offline bundle. Дальше тот же output без пересборки проходит:

1. внешний SHA-256 и внутренний manifest verification;
2. disposable Debian 12 systemd clean install;
3. повторный update тем же archive;
4. upgrade legacy `current` layout с сохранением PIN/data;
5. `forced-core-rollback`: намеренная порча обязательного файла уже переключённого нового release должна быть замечена post-update verification, после чего transactional installer обязан вернуть предыдущий `current`, данные/PIN и работающие API/worker;
6. Project Control package строится из того же проверенного archive;
7. формируется общий `SHA256SUMS`.

Docker используется только как CI reference VM. Production bundle и целевая установка Docker не требуют.

## Проверка GitHub Release

Для `v0.4.3` publisher создаёт draft на exact `SOURCE_SHA`, загружает ровно семь assets и проверяет их до публикации:

- `kafedra-planner-0.4.3-*.tar.gz`;
- соответствующий `.tar.gz.sha256`;
- `install-kafedra-planner.sh`;
- `README-INSTALL.txt`;
- `kafedra-planner-0.4.3-project-control.f2re.zip`;
- соответствующий `.f2re.zip.sha256`;
- `SHA256SUMS`.

После проверки draft переводится в public non-prerelease release. Tag `v0.4.3` обязан разрешаться в exact `SOURCE_SHA`. Старые теги и assets не перемещаются и не перезаписываются.

## Что остаётся ручным

Только целевая эксплуатационная приёмка #27:

- настоящая Astra Linux и контрольная Debian;
- vendor package revisions;
- реальные ведомственные документы;
- реальные права каталогов и systemd hardening;
- чистая установка, upgrade, restore и forced rollback на целевой инфраструктуре;
- при наличии — реальный Оформлятор и настоящий llama-server/GGUF.
