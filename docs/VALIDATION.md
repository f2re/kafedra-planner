# Автоматическая проверка release candidate

Актуальный рубеж: `0.4.2`, схема SQLite **31**. Автоматический gate проверяет код, данные, desktop/mobile UX и поставочный контракт, но не подменяет фактическую приёмку #27 на Astra Linux/Debian.

## Статические и Node-проверки

На pull request и push в `main` выполняются:

- `npm run check` — синтаксис, документация, design governance, реальные scripts/paths и единая версия выпуска;
- `npm run docs:check` — ссылки, команды и release markers;
- `npm test` — полный unit/integration suite;
- `npm run smoke`;
- backup create/verify/restore self-test;
- shell/Python syntax поставочных сценариев;
- system preflight;
- минимальный Node 24.15 и отдельный builder под host Node 25.

Unit/integration подтверждают:

- последовательные migrations до schema 31 и отсутствие конфликтующих номеров;
- `PRAGMA quick_check` и `PRAGMA foreign_key_check`;
- immutable blobs, SHA-256 и evidence/locator;
- планы, исходные строки/ячейки и идемпотентные назначения;
- lifecycle документов/планов без перепривязки истории;
- шаблоны заседаний и точные исторические версии;
- academic performance и сохранность метаполей;
- direct Docomator URL normalization без новой migration;
- `/readyz` со `status: ok` и legacy `ready`;
- безопасные DNS/refused/timeout/TLS/service/readiness/access/protocol errors;
- field mapping, idempotent remote links и partial success;
- archive staging из user-owned каталога без archived owners/permissions;
- active UI file verification и `Cache-Control: no-store`.

## Browser suites

Полный CI запускает:

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

Ключевые desktop/mobile сценарии:

- импорт плана и исправление неоднозначной строки;
- одна исходная строка → несколько задач → несколько исполнителей;
- точное автоматическое назначение без угадывания ФИО;
- архив/восстановление документов и планов;
- заседание и библиотека версий шаблонов;
- ведомость → доказуемые метаполя → сводка → исходная ячейка;
- Оформлятор → вставить один URL → Подключить → current/legacy readiness → код → space/group → поля → preview → partial/idempotent import;
- DNS и другие classified errors без блокировки локального справочника;
- desktop/mobile layout, focus, target size и `prefers-reduced-motion`;
- PIN/accounts, ACL, наука, отчёты и `План / факт`.

## Release gate 0.4.2

Агрегирующий workflow требует успеха трёх независимых контуров:

1. `release-quality` — check, полный unit/integration suite и smoke;
2. `release-migrations-backup` — upgrade schema 31, acceptance evidence и restore;
3. `release-browser-desktop-mobile` — ключевые пользовательские сценарии обеих компоновок.

Failure, cancelled, pending, missing или неожиданно skipped не считаются успешным результатом.

## Full offline и systemd

CI дополнительно проверяет:

- сборку полного Debian 12 bundle и manifest/checksums;
- additive package policy без `package=version`, remove, upgrade и `apt --fix-broken`;
- реальную air-gap systemd-установку API/worker;
- обновление существующей установки и forced rollback;
- запуск wrapper из user-owned каталога;
- root-owned installed release и service-owned data;
- сравнение обязательных active UI files с выбранным bundle;
- отдельную offline `llama.cpp/GGUF` установку и работу ядра после отключения LLM;
- F2RE Project Control update package.

Публикационные шаги в pull request ожидаемо не выполняются; на `main` publisher запускается только после успешного post-merge `Release gate 0.4.2`.

## Post-merge и публикация

Publisher проверяет фактические jobs, а не только top-level conclusion:

- queued/in-progress jobs ожидаются;
- все completed обязательные jobs должны иметь `success`;
- failure/cancelled/unexpected skipped немедленно останавливает выпуск;
- run без выполняемых jobs допускает один explicit retry;
- второй инфраструктурный отказ не скрывается;
- перед retry, сборкой, тегированием и публикацией `main` должен точно совпадать с `SOURCE_SHA`.

Новая версия публикуется только когда `VERSION` отличается от родительского commit и тег/release ещё отсутствуют. Для уже опубликованной версии выполняется no-op; существующий тег и assets не перемещаются и не заменяются.

## Проверка GitHub Release

Для `v0.4.2` после post-merge CI должны быть подтверждены:

- public non-prerelease release;
- тег указывает на exact squash-commit выпуска;
- полный автономный `.tar.gz` и его `.sha256`;
- `install-kafedra-planner.sh`;
- `README-INSTALL.txt`;
- F2RE Project Control package и его `.sha256`;
- общий `SHA256SUMS`;
- повторная проверка checksums, embedded `VERSION`, release identity и bundle contract.

## Что остаётся ручным

Только целевая эксплуатационная приёмка #27:

- настоящая Astra Linux и контрольная Debian;
- vendor package revisions;
- реальные ведомственные документы;
- реальные права каталогов и systemd hardening;
- чистая установка, upgrade, restore и forced rollback;
- обновление сайта без stale cache;
- при наличии — реальный Оформлятор и настоящий llama-server/GGUF.

## Release 0.4.2

Выпуск допускается только на одном exact head после GRACE final и полного project CI. Обязательны direct Docomator URL, current readiness, classified failures, partial/idempotent import, desktop/mobile UX, user-owned archive source, active UI verification, static no-store, release workflow/assets tests, clean install и upgrade schema 31, backup/restore, full offline Debian 12, systemd, offline LLM/GGUF и Project Control.
