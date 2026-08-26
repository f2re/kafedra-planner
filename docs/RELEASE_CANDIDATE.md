# Release candidate 0.3.1

## Статус

`0.3.1` — текущий эксплуатационный release candidate, схема SQLite **27**. Основные функциональные контуры работают автономно и проходят unit/integration/Chromium/full-offline gates. Stable не объявляется до фактической приёмки на целевых Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

Версия завершает два связанных пользовательских сценария:

1. реальный табличный план разбирается по исходным строкам и ячейкам, а одна строка может стать несколькими задачами с несколькими исполнителями;
2. ошибочно добавленный или устаревший документ/план можно переименовать, архивировать, связать с логическим преемником и восстановить без удаления либо подмены исторических источников.

## Что входит в 0.3.1

- первый вход по четырёхзначному PIN без регистрации, логина и временного пароля;
- `scrypt`-хэш PIN, блокировка после пяти неверных попыток, HttpOnly-сессии и CSRF;
- сохранённый расширенный account mode и объектные ACL;
- календарь `Месяц / Неделя / Задачи` и постоянный стартовый режим;
- неизменяемые документы, структурные источники, ручные ревизии, локальные OCR/preview при наличии системных конвертеров;
- распоряжения, поручения, прогресс, отчёты и подтверждение;
- импортированные и ручные годовые планы, `track / assigned / open`, связь `plan_item → assignment`;
- исходные строки и ячейки плана с locator/evidence;
- разложение одной строки на несколько задач и назначение нескольких исполнителей;
- рабочий/архивный список документов и планов, impact summary и безопасная навигационная замена;
- `План / факт`, сопроводительные документы, заседания и научный реестр;
- историческая оргструктура, жизненный цикл науки, массовый импорт и отчёты;
- backup/restore и транзакционный update/rollback;
- SMTP/Telegram и `llama.cpp` только как необязательные адаптеры;
- target-specific full offline bundle с Node 24.19, managed Python и `.deb` air-gap closure;
- package contract `full-airgap-v2 + additive-only-v2`.
- публичная GitHub-витрина: badges, MIT license, RU/EN entrypoints, download/install guide и проверяемый GitHub Release.

## Инварианты lifecycle

Архивирование не является удалением. После операции сохраняются:

- исходные `document_versions`, blob и SHA-256;
- `plan.source_document_version_id`;
- `plan_item.plan_id` и `evidence_json`;
- календарные `source_id` и `origin_id`;
- поручения, отчёты, сопроводительные документы и подтверждённые факты.

`replacement_document_id` и `replacement_plan_id` являются только навигацией к новому рабочему объекту. Self-reference, объект другого workspace, архивный преемник и циклическая цепочка замен блокируются. Восстановление возвращает объект в рабочий список и снимает ссылку на преемника.

Подробно: [`DOCUMENT_PLAN_LIFECYCLE.md`](DOCUMENT_PLAN_LIFECYCLE.md).

## Автономность

Основной deterministic-контур обязан работать при `KAFEDRA_LLM_ENABLED=false`. Отсутствие LLM, OCR или LibreOffice не должно останавливать API/worker. Недоступная документная возможность отображается как degraded capability; исходные файлы при этом продолжают сохраняться неизменяемо.

## Поставка

Full bundle собирается на совместимой и здоровой Debian/Astra reference-машине:

```bash
npm run bundle:offline
```

Collector перед выпуском package layer выполняет `dpkg --audit` и `apt-get check`. Старый package cache без `additive-only-v2` повторно использовать нельзя.

На target:

```bash
sudo ./install-kafedra-planner.sh
```

Для гарантированного air-gap режима:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

После установки пользователь открывает напечатанный installer адрес и задаёт PIN. Никаких предварительных реквизитов штатный PIN-режим не требует.

Target installer:

1. определяет только реально отсутствующие document capabilities;
2. до любой package-транзакции выполняет `dpkg --audit` и `apt-get check`;
3. использует `--no-remove --no-upgrade`, не передаёт `package=version` и не вызывает `--fix-broken`;
4. отклоняет simulation, которая меняет уже установленный пакет;
5. fallback на bundled repository выполняет только до первой изменяющей транзакции;
6. если APT уже конфликтует или безопасный additive plan невозможен, не меняет системные пакеты и продолжает установку ядра в degraded mode;
7. перед обновлением создаёт и проверяет backup, применяет миграции по порядку и автоматически возвращает предыдущий release/database при ошибке health-check.

На чистой поддерживаемой ОС full bundle обязан полностью установить и проверить `unzip`, Poppler, Tesseract `rus+eng` и LibreOffice.

## Bundle с llama.cpp/GGUF

На build/reference-машине:

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/model.gguf \
  --default-model qwen \
  --output release-llm
```

На target используется тот же installer. Managed-модель хранится content-addressed в `/var/lib/kafedra-planner/models`; отключение LLM не останавливает API/worker. Подробно: [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md).

## После установки

Строгая проверка полного document stack:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Если ОС уже имела APT-конфликт и установка завершилась в degraded mode, проверить рабочее ядро можно так:

```bash
sudo KAFEDRA_DOCTOR_ALLOW_DEGRADED=true \
  /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Забытый PIN сбрасывается локально:

```bash
sudo /opt/kafedra-planner/current/scripts/reset-pin.sh
```

## Автоматический release-gate

До merge проверяются:

- `npm run check`, включая согласованность документации;
- полный unit/integration suite на текущем Node и минимальном Node 24.15;
- миграции 19/25/26 → 27, `quick_check`, `foreign_key_check`, backup/restore и logical digest;
- smoke и backup/restore self-test;
- desktop/mobile Playwright для планов, исходных строк, нескольких задач/исполнителей, lifecycle документов и планов;
- отдельные browser suites для основного UX, науки, план-факта, auth, release readiness и ACL;
- сборка full Debian 12 bundle;
- `additive-only-v2` package contract и simulation guard;
- air-gap systemd установка обычного bundle, повторный update и forced rollback;
- отдельная LLM/GGUF air-gap установка с проверкой работы ядра после отключения LLM.

GitHub Release публикуется только после успешного squash merge и успешного завершения всех обязательных post-merge workflows для точного нового SHA `main`. Тег, bundle, Project Control package и SHA-256 должны указывать на этот же commit.

## Что остаётся до stable

На реальной Astra Linux и контрольной Debian необходимо подтвердить:

- чистую установку `0.3.1` и первый PIN-flow;
- обновление существующей базы до схемы 27;
- сохранность lifecycle/replacement, исходных строк плана, evidence и blob после backup/restore;
- forced rollback после искусственно сорванного update;
- поведение на Astra с vendor revisions пакетов;
- отсутствие package mutation при заранее конфликтном `apt-get check`;
- реальные Tesseract/Poppler/LibreOffice на ведомственных документах;
- права каталогов, systemd hardening и desktop/mobile сценарии;
- при использовании LLM — настоящий `llama-server`/GGUF и работу ядра после его отключения.

До фактического акта #27 проект остаётся release candidate независимо от состояния CI.
