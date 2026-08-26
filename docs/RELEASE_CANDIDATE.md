# Release candidate 0.3.3

## Статус

`0.3.3` — текущий эксплуатационный release candidate, схема SQLite **28**. Основные функциональные контуры работают автономно и проходят unit/integration/Chromium/full-offline gates. Stable не объявляется до фактической приёмки на целевых Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

Версия объединяет четыре законченных сценария:

1. реальный табличный план разбирается по исходным строкам и ячейкам, а одна строка может стать несколькими задачами с несколькими исполнителями;
2. ошибочно добавленный или устаревший документ/план можно переименовать, архивировать, связать с логическим преемником и восстановить без удаления либо подмены исторических источников;
3. при единственном точном совпадении ФИО ответственного с активным сотрудником пункт импортированного плана автоматически получает одно связанное поручение, а неоднозначность остаётся для проверки оператором;
4. администратор может проверить локальный Оформлятор, выбрать пространство/группу и идемпотентно импортировать сотрудников без сохранения кода доступа и без удаления локальной истории.

## Что входит в 0.3.3

- первый вход по четырёхзначному PIN без регистрации, логина и временного пароля;
- `scrypt`-хэш PIN, блокировка после пяти неверных попыток, HttpOnly-сессии и CSRF;
- сохранённый расширенный account mode и объектные ACL;
- календарь `Месяц / Неделя / Задачи` и постоянный стартовый режим;
- неизменяемые документы, структурные источники, ручные ревизии, локальные OCR/preview при наличии системных конвертеров;
- распоряжения, поручения, прогресс, отчёты и подтверждение;
- импортированные и ручные годовые планы, `track / assigned / open`, связь `plan_item → assignment`;
- исходные строки и ячейки плана с locator/evidence;
- разложение одной строки на несколько задач и назначение нескольких исполнителей;
- автоматическое поручение при точном однозначном совпадении ФИО и контролирующий из актуальной оргструктуры;
- рабочий/архивный список документов и планов, impact summary и безопасная навигационная замена;
- `План / факт`, сопроводительные документы, заседания и научный реестр;
- историческая оргструктура, жизненный цикл науки, массовый импорт и отчёты;
- интеграция Оформлятора: host/port, health/readiness/data, краткоживущий PIN, пространство/группа, preview и идемпотентная внешняя связь сотрудника;
- backup/restore и транзакционный update/rollback;
- SMTP/Telegram и `llama.cpp` только как необязательные адаптеры;
- target-specific full offline bundle с Node 24.19, managed Python и `.deb` air-gap closure;
- package contract `full-airgap-v2 + additive-only-v2`;
- публичная GitHub-витрина: badges, MIT license, RU/EN entrypoints, download/install guide и проверяемый GitHub Release.

## Инварианты интеграции Оформлятора

Сетевое подключение является необязательным. Основная система полностью работает при недоступном Оформляторе. Разрешены только HTTP/HTTPS; redirects не выполняются. Проверка различает недоступность процесса, неготовый runtime, требование кода и реальную доступность данных.

Код доступа используется только для текущего запроса и не сохраняется в SQLite, конфигурации или аудите. Каждый импортированный сотрудник связывается с `remote employee id`; первая синхронизация может сопоставить существующую запись по нормализованному ФИО. Повторная синхронизация обновляет ту же локальную запись и не удаляет планы, задачи, отчёты, назначения и историю.

Подробно: [`DOCOMATOR_PEOPLE_IMPORT.md`](DOCOMATOR_PEOPLE_IMPORT.md).

## Инварианты автоматического назначения

Автоматика использует только точное нормализованное совпадение с единственным активным сотрудником в том же рабочем пространстве. Она не угадывает сокращённые, неоднозначные или отсутствующие ФИО. Исходное `responsible_raw`, locator и evidence сохраняются. Повторная обработка не создаёт второй assignment и не переписывает завершённое поручение. Контролирующий определяется из основного назначения на дату задачи, затем из совместимого `manager_id`; отсутствие руководителя не блокирует создание работы.

Подробно: [`AUTOMATIC_ASSIGNMENTS.md`](AUTOMATIC_ASSIGNMENTS.md).

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

Основной deterministic-контур обязан работать при `KAFEDRA_LLM_ENABLED=false` и без Оформлятора. Отсутствие интеграции, LLM, OCR или LibreOffice не должно останавливать API/worker. Недоступная дополнительная возможность отображается предметной диагностикой; исходные файлы и локальные справочники продолжают работать.

## Поставка

Full bundle собирается на совместимой и здоровой Debian/Astra reference-машине:

```bash
npm run bundle:offline
```

На target:

```bash
sudo ./install-kafedra-planner.sh
```

Для гарантированного air-gap режима:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

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

## Автоматический release-gate

До merge проверяются:

- `npm run check`, включая согласованность документации и текущей версии выпуска;
- полный unit/integration suite на текущем Node и минимальном Node 24.15;
- миграции 19/25/26/27 → 28, `quick_check`, `foreign_key_check`, backup/restore и logical digest;
- mock Оформлятора: health/readiness/auth/data, первый и повторный импорт, rename/inactive;
- smoke и backup/restore self-test;
- desktop/mobile Playwright для планов, исходных строк, lifecycle, точного автоматического назначения и импорта сотрудников;
- отдельные browser suites для основного UX, науки, план-факта, auth, release readiness и ACL;
- сборка full Debian 12 bundle;
- `additive-only-v2` package contract и simulation guard;
- air-gap systemd установка обычного bundle, повторный update и forced rollback;
- отдельная LLM/GGUF air-gap установка с проверкой работы ядра после отключения LLM.

Все обязательные post-merge workflows допускают явный `workflow_dispatch`. Publisher ожидает фактические jobs, а не доверяет только top-level conclusion: незавершённые jobs ожидаются, все завершённые должны иметь `success`, реальная ошибка не повторяется автоматически. Только run без выполняемых jobs допускает один explicit retry. Перед retry и публикацией проверяется точный SHA `main`; выпуск устаревшего commit запрещён.

GitHub Release публикуется только после успешного squash merge и успешного завершения всех обязательных post-merge workflows для точного нового SHA `main`. Тег, bundle, Project Control package и SHA-256 должны указывать на этот же commit.

## Что остаётся до stable

На реальной Astra Linux и контрольной Debian необходимо подтвердить:

- чистую установку `0.3.3` и первый PIN-flow;
- обновление существующей базы до схемы 28;
- сохранность lifecycle/replacement, исходных строк плана, автоматических назначений, integration links, evidence и blob после backup/restore;
- forced rollback после искусственно сорванного update;
- поведение на Astra с vendor revisions пакетов;
- отсутствие package mutation при заранее конфликтном `apt-get check`;
- реальные Tesseract/Poppler/LibreOffice на ведомственных документах;
- права каталогов, systemd hardening и desktop/mobile сценарии;
- при доступном Оформляторе — реальный health/readiness/data/import без сохранения кода;
- при использовании LLM — настоящий `llama-server`/GGUF и работу ядра после его отключения.

До фактического акта #27 проект остаётся release candidate независимо от состояния CI.
