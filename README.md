# Кафедра Planner

Автономная система повседневной работы кафедры: календарь, годовые планы, поручения, документы, заседания, отчётность, научная деятельность и проверяемые доказательства.

> Текущий рубеж: **`0.2.0`**, схема SQLite **25**. Основные пользовательские контуры работают без обязательного Интернета, LLM, Docker и внешних облачных сервисов. До stable остаётся реальная эксплуатационная приёмка установки, обновления, восстановления и rollback на Astra Linux/Debian по [`docs/TARGET_ACCEPTANCE.md`](docs/TARGET_ACCEPTANCE.md) и issue #27.

## Основной принцип

Исходный PDF/DOCX/ODT/XLSX/ODS/скан не подменяется распознанным текстом или выводом ИИ. Автоматически извлечённый факт хранит источник и локатор; ручное исправление хранится отдельно с причиной и историей.

```text
исходный документ / ручной ввод
              ↓
        предметная запись
              ↓
 календарь · поручение · поиск · отчёт
              ↓
 подтверждение, история и доказательства
```

Ошибка одного файла, пункта плана, внешнего адаптера или дополнительного системного конвертера не должна блокировать остальные документы и пользовательские действия.

## Что видит пользователь

При первом открытии установленной системы пользователь задаёт PIN-код из четырёх цифр. Логин, регистрация и временный пароль в штатном режиме не нужны. При следующих посещениях система просит только PIN. После входа открывается календарь. На большом экране используется боковая навигация, на мобильном — нижние вкладки. Стартовый режим можно явно выбрать: `Автоматически / Месяц / Неделя / Задачи`; явная настройка имеет приоритет над обучаемым UX.

![Календарь кафедры](docs/screenshots/calendar.webp)

Основные разделы:

- **Календарь** — месяц, неделя, задачи, сроки, напоминания и происхождение записей;
- **Документы** — загрузка, исходник, обработка, версии, OCR/preview и доказательства;
- **Планы** — импорт готового плана или ручной годовой план из календаря;
- **Поручения** — исполнители, прогресс, отчёт, подтверждение или возврат;
- **План / факт** — плановые и фактические показатели, доказательства и риск срока;
- **Заседания** — повестка, решения, протоколы и выписки;
- **Наука** — статьи и другие научные материалы на общем контуре документов/поиска;
- **Проверка** — только неоднозначности, которые система не может безопасно разрешить сама.

## Годовой план и исполнение

План кафедры, факультета, подразделения, организации или сотрудника можно импортировать из DOCX/ODT/XLSX/ODS/PDF/текста либо создать вручную. Для ручного пункта доступны режимы:

- **Контрольная точка** (`track`) — календарное событие/срок без обязательного отчёта;
- **Поручение** (`assigned`) — выбранные исполнители, контролирующий, прогресс и отчёт;
- **Открытая задача** (`open`) — сотрудник атомарно принимает её в работу сам.

Один пункт создаёт не более одного связанного поручения. Повторное сохранение обновляет существующую связь, а не создаёт дубль. Подтверждённое выполнение синхронизируется с пунктом плана, календарём и `План / факт`.

![Годовой план кафедры](docs/screenshots/annual-plan.webp)

Подробно: [`docs/PLANS.md`](docs/PLANS.md) и [`docs/MANUAL_PLANS.md`](docs/MANUAL_PLANS.md).

## Заседания

![Заседание кафедры](docs/screenshots/meeting.webp)

Заседание существует как самостоятельная запись до появления итогового файла. Повестка формируется вручную, из пункта плана или задачи. Для каждого вопроса фиксируются фактические `Слушали / Обсудили / Решили`; затем система формирует полный протокол либо выписку по выбранным вопросам. Сформированный DOCX регистрируется как обычный неизменяемый документ, а повтор неизменённого запроса не создаёт копию.

Подробно: [`docs/MEETINGS.md`](docs/MEETINGS.md).

## Поручения, отчёты и «План / факт»

Поручение может возникнуть из распоряжения или пункта ручного плана. Для него сохраняются исполнители, контролирующий, срок, ожидаемый результат, прогресс и отчётные документы. Руководитель подтверждает результат либо возвращает его на доработку.

![Задачи по плану](docs/screenshots/plan-tasks.webp)

![План / факт кафедры](docs/screenshots/department-plan-fact.webp)

Подробно: [`docs/PLAN_FACT.md`](docs/PLAN_FACT.md) и [`docs/PLAN_FACT_OPERATIONS.md`](docs/PLAN_FACT_OPERATIONS.md).

## Документы и локальная обработка

- потоковая загрузка с ограничением размера;
- SHA-256 и content-addressed blob-хранилище;
- неизменяемые версии и дедупликация без потери истории;
- устойчивая очередь с арендой и повтором после перезапуска;
- DOCX, ODT, XLSX, ODS, PDF, TXT, Markdown, CSV и JSON;
- локальные `unzip`, Poppler, Tesseract и LibreOffice в полном offline bundle;
- структурные абзацы, таблицы, листы, страницы и локаторы источника;
- FTS5 и фасетный поиск;
- ручная коррекция без уничтожения машинного результата.

В `rc.7` внешние document converters являются дополнительными capabilities. На здоровой поддерживаемой ОС full bundle устанавливает и строго проверяет их все. Если target уже имеет конфликтный APT, installer не исправляет и не меняет системные пакеты автоматически: API/worker устанавливаются в degraded mode, исходные документы сохраняются, а недоступные OCR/PDF/Office функции явно показываются диагностикой.

Подробно: [`docs/OCR_AND_PREVIEW.md`](docs/OCR_AND_PREVIEW.md), [`docs/STRUCTURED_DOCUMENTS.md`](docs/STRUCTURED_DOCUMENTS.md) и [`docs/OFFLINE_INSTALL.md`](docs/OFFLINE_INSTALL.md).

## LLM / llama.cpp

LLM — только необязательное локальное улучшение. Основной deterministic-контур полностью работает при `KAFEDRA_LLM_ENABLED=false`.

Доступны два варианта:

1. внешний уже запущенный OpenAI-compatible `llama-server`;
2. полный offline bundle с локальным runtime `llama.cpp` и одной или несколькими GGUF-моделями.

Сборка LLM-варианта выполняется **на reference/build-машине**, а не на целевой Astra:

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/model.gguf \
  --default-model qwen \
  --output release-llm
```

Полный порядок: [`docs/LLAMA_OFFLINE_DEPLOYMENT.md`](docs/LLAMA_OFFLINE_DEPLOYMENT.md). Предметные ограничения и использование LLM: [`docs/DIRECTIVES_AND_LLM.md`](docs/DIRECTIVES_AND_LLM.md).

## Установка на Astra Linux / Debian

Эксплуатационная установка не требует `npm install` или `pip install` на целевой машине. Full bundle собирается на совместимой reference-системе:

```bash
npm run bundle:offline
```

На target переносятся архив, `.sha256`, `install-kafedra-planner.sh` и `README-INSTALL.txt`:

```bash
sudo ./install-kafedra-planner.sh
```

Для гарантированного air-gap режима:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

После установки откройте адрес, который напечатает installer, и задайте четырёхзначный PIN. Штатный PIN-режим не создаёт `/root/kafedra-planner-first-login.txt` и не требует поиска логина или временного пароля.

Package contract `rc.7` — `full-airgap-v2 / additive-only-v2`: перед изменением ОС выполняется `apt-get check`, запрашиваются только отсутствующие document packages, а `--no-upgrade --no-remove` и simulation guard не позволяют заменить уже установленную Astra/Debian версию. `apt --fix-broken` автоматически не вызывается.

После установки строгая проверка:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl status kafedra-planner-api kafedra-planner-worker --no-pager -l
```

Для заранее конфликтного APT, когда installer безопасно завершился с degraded document capabilities:

```bash
sudo KAFEDRA_DOCTOR_ALLOW_DEGRADED=true \
  /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Подробно: [`docs/OFFLINE_INSTALL.md`](docs/OFFLINE_INSTALL.md), [`docs/FULL_OFFLINE_DEPLOYMENT.md`](docs/FULL_OFFLINE_DEPLOYMENT.md), [`docs/SUPPORT_MATRIX.md`](docs/SUPPORT_MATRIX.md).

## Резервное копирование и восстановление

Штатный installer перед изменяющим обновлением создаёт и проверяет резервную копию, переключает versioned release атомарно и выполняет rollback при неуспешной миграции/health-check. Операторские команды установленной системы приведены в [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md).

GGUF-модели являются воспроизводимым deployment asset и не дублируются в стандартном backup; для disaster recovery сохраняйте исходный LLM release bundle вместе с резервными копиями.

## Авторизация и доступ

- штатный локальный режим — один PIN из четырёх цифр, задаваемый при первом открытии;
- PIN хранится только как параметризованный `scrypt`-хэш;
- после пяти ошибок вход временно блокируется;
- забытый PIN сбрасывается локально от `root`: `sudo /opt/kafedra-planner/current/scripts/reset-pin.sh`;
- HttpOnly-сессии и CSRF остаются обязательными;
- роли, объектные ACL, рекурсивная зона руководителя и аудит сохраняются внутри системы;
- расширенный режим отдельных аккаунтов `staff / manager / admin` включается явно через `KAFEDRA_AUTH_MODE=accounts`.

Подробно: [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md), [`docs/OBJECT_ACCESS.md`](docs/OBJECT_ACCESS.md).

## Разработка и проверка

Эти команды выполняются **в checkout исходников**:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
npm run test:browser:plans
npm run test:browser:core
npm run test:browser:reports-science
npm run test:browser:plan-fact
npm run test:browser:auth
npm run test:browser:release
npm run test:browser:acl
```

`npm run test:browser:auth` проверяет и legacy account/ACL regression, и штатный PIN-flow на desktop/mobile. `npm run check` включает проверку согласованности документации. CI дополнительно проверяет миграции, backup/restore, минимальный Node 24.15, host Node 25, desktop/mobile Chromium, full-offline Debian 12, additive APT policy и два systemd сценария: обычный и LLM/GGUF.

## Архитектура и эксплуатационные документы

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — слои и инварианты;
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — текущий рубеж и следующие этапы;
- [`docs/UX_FLOWS.md`](docs/UX_FLOWS.md) — пользовательские сценарии;
- [`docs/CALENDAR_START_MODE.md`](docs/CALENDAR_START_MODE.md) — стабильный стартовый режим календаря;
- [`docs/design.md`](docs/design.md) — общие принципы простого и стабильного интерфейса;
- [`docs/CODEX_AGENTS.md`](docs/CODEX_AGENTS.md) — роли Codex, handoff и критерии готовности;
- [`docs/RELEASE_CANDIDATE.md`](docs/RELEASE_CANDIDATE.md) — текущий RC и release-gates;
- [`docs/TARGET_ACCEPTANCE.md`](docs/TARGET_ACCEPTANCE.md) — реальная Astra/Debian приёмка перед stable.
