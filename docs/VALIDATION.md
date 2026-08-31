# Автоматическая проверка release candidate

Актуальный рубеж: `0.4.0`, схема SQLite **31**. Автоматический gate проверяет код, данные, desktop/mobile UX и поставочный контракт, но не подменяет фактическую приёмку #27 на Astra Linux/Debian.

## Статические и Node-проверки

На PR и push в `main` выполняются:

- `npm run check`: синтаксис, документация, реальные scripts/paths и единая версия выпуска;
- `npm test`: полный unit/integration suite;
- `npm run smoke`;
- backup create/verify/restore self-test;
- shell/Python syntax поставочных сценариев;
- system preflight;
- тот же код на минимальном Node 24.15;
- runtime-only builder под host Node 25, чтобы host/runtime оставались разделены.

Unit/integration подтверждают:

- последовательные миграции до schema 31 и отсутствие конфликтующих номеров;
- `PRAGMA quick_check` и `foreign_key_check`;
- immutable blob, SHA-256 и сохранение evidence/locator;
- планы, исходные строки/ячейки, разложение в несколько задач и идемпотентные назначения;
- lifecycle документов/планов и отсутствие перепривязки исторических источников;
- визуальные профили DOCX-шаблонов заседаний;
- версии, default, точную старую версию, тестовую генерацию, impact, archive/restore шаблонов;
- сохранение тестового DOCX при ошибке необязательного LibreOffice preview;
- health/readiness/auth/data Оформлятора;
- discovery property definitions, выбор e-mail/должности/дополнительных полей;
- отказ до локальных изменений при исчезновении выбранного remote property;
- первый и повторный импорт сотрудников без дублей;
- включение `meeting_template_catalog`, `meeting_template_test_runs`, `docomator_field_mappings` и `docomator_person_fields` в acceptance digest и backup/restore;
- schema 31, метаполя ведомости из ячеек/ручного ввода, текущая версия группы/периода и academic backup/restore;
- расчёт категорий и среднего только по исходным оценкам `2–5`, без двойного учёта старых ведомостей.

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

Desktop/mobile сценарии включают:

- импорт плана и безопасное исправление неоднозначной строки;
- ручной план → поручение → отчёт → подтверждение → DOCX;
- одна исходная строка → несколько задач → несколько исполнителей;
- точное автоматическое назначение и отсутствие угадывания неоднозначного ФИО;
- переименование, impact, архив, логический преемник и восстановление документов/планов;
- обычный DOCX → визуальные поля/повторяемый блок → протокол;
- библиотека шаблонов → тест двумя вопросами → новая версия → основной → точная старая версия → impact → архив → восстановление;
- Оформлятор → host/port → space/group → выбор remote fields → preview → идемпотентный импорт;
- оргструктуру, науку, отчёты, `План / факт`, PIN/accounts, release readiness и ACL;
- ведомость → ручные/ячеечные метаполя → учебный год/семестр/группа → сводка → исходная ячейка;
- геометрически стабильный режим задач на desktop/mobile.

## Release gate 0.4.0

Обязательный агрегирующий workflow требует успеха трёх независимых контуров:

1. `release-quality`: check, полный unit/integration suite и smoke;
2. `release-migrations-backup`: миграции старых схем, meeting-template library, Docomator field mapping, acceptance evidence и restore;
3. `release-browser-desktop-mobile`: ключевые пользовательские сценарии обеих компоновок.

Failure, cancelled, pending или неожиданно skipped не считаются зелёным результатом.

## Full offline и systemd

CI дополнительно проверяет:

- сборку полного Debian 12 bundle и manifest/checksums;
- additive APT policy без `package=version`, remove, upgrade и `apt --fix-broken`;
- реальную air-gap systemd-установку API/worker;
- повторное обновление и forced rollback;
- отдельную offline `llama.cpp/GGUF` установку;
- работу ядра после отключения LLM;
- сборку и проверку F2RE Project Control update.

Публикационные шаги bundle/update в PR ожидаемо skipped; на `main` они выполняются только в предусмотренном workflow-контексте.

## Post-merge и публикация

Publisher проверяет фактические jobs, а не только top-level conclusion:

- queued/in-progress jobs ожидаются;
- все completed обязательные jobs должны иметь `success`;
- реальная failure/cancelled/unexpected skipped немедленно останавливает выпуск;
- run без выполняемых jobs допускает один explicit retry;
- второй инфраструктурный отказ не скрывается;
- перед retry, сборкой, тегированием и публикацией `main` должен точно совпадать с `SOURCE_SHA`.

Для уже опубликованной версии workflow выполняет штатный no-op, если существующий тег является предком нового `main`; тег не переносится. Новая версия публикуется только когда `VERSION` отличается от родительского commit и тег/release ещё отсутствуют.

## Проверка GitHub Release

Для `v0.4.0` после post-merge CI должны быть подтверждены:

- public non-prerelease release;
- тег указывает на точный squash-commit `main`;
- полный автономный `.tar.gz` и его `.sha256`;
- `install-kafedra-planner.sh`;
- `README-INSTALL.txt`;
- F2RE Project Control package и его `.sha256`;
- общий `SHA256SUMS`;
- успешная повторная проверка checksums и bundle contract.

## Что остаётся ручным

Только целевая эксплуатационная приёмка #27:

- настоящая Astra Linux и контрольная Debian;
- vendor package revisions;
- реальные ведомственные документы;
- права каталогов и systemd hardening;
- обновление существующей установки и rollback;
- при наличии — реальный Оформлятор и настоящий llama-server/GGUF.
