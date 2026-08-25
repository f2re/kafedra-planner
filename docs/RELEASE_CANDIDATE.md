# Release candidate 0.2.0

## Статус

`0.2.0` — текущий эксплуатационный release candidate, схема SQLite **25**. Основные функциональные контуры работают автономно и проходят unit/integration/Chromium/full-offline gates. Stable не объявляется до фактической приёмки на целевых Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

`rc.9` упрощает штатный доступ к локальной системе: при первом открытии пользователь задаёт PIN-код из четырёх цифр, дальше входит только по PIN. Installer больше не требует от оператора искать логин и временный пароль; в штатном PIN-режиме файл `/root/kafedra-planner-first-login.txt` не создаётся. Внутренние роли/ACL и расширенный `KAFEDRA_AUTH_MODE=accounts` сохраняются для совместимости.

`rc.8` добавил гарантированный запуск с ранней проверкой Node.js runtime, поддержку серий Astra Linux 1.7.x/1.8.x и автоматическую диагностику/восстановление package layer. Package contract остаётся `full-airgap-v2 + additive-only-v2`.

## Что входит в rc.9

- первый вход по четырёхзначному PIN без регистрации, логина и временного пароля;
- `scrypt`-хэш PIN, блокировка после пяти неверных попыток, HttpOnly-сессии и CSRF;
- смена PIN в интерфейсе и локальный root-only `scripts/reset-pin.sh` без npm;
- сохранённый расширенный account mode и объектные ACL;
- гарантированный старт и прямая проверка выполнения Node.js runtime на ранней стадии;
- поддержка совместимости обновлений Astra Linux 1.7.x и 1.8.x;
- автоматическая самодиагностика и восстановление (`doctor.sh --repair`, `doctor.sh --diagnose-apt`);
- календарь `Месяц / Неделя / Задачи` и постоянный стартовый режим;
- неизменяемые документы, структурные источники, ручные ревизии, локальные OCR/preview при наличии системных конвертеров;
- распоряжения, поручения, прогресс, отчёты и подтверждение;
- импортированные и ручные годовые планы, `track / assigned / open`, связь `plan_item → assignment`;
- `План / факт`, сопроводительные документы, заседания и научный реестр;
- backup/restore и rollback;
- SMTP/Telegram и `llama.cpp` только как необязательные адаптеры;
- target-specific full offline bundle с Node 24.19, managed Python и `.deb` air-gap closure;
- package contract `full-airgap-v2 + additive-only-v2`.

## Автономность

Основной deterministic-контур обязан работать при `KAFEDRA_LLM_ENABLED=false`. Отсутствие LLM, OCR или LibreOffice не должно останавливать API/worker. Недоступная документная возможность отображается как degraded capability; исходные файлы при этом продолжают сохраняться неизменяемо.

## Поставка

Full bundle собирается на совместимой и **здоровой** Debian/Astra reference-машине:

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

После установки пользователь открывает напечатанный installer'ом адрес и задаёт PIN. Никаких предварительных реквизитов штатный PIN-режим не требует.

Target installer:

1. определяет только реально отсутствующие document capabilities;
2. до любой package-транзакции выполняет `dpkg --audit` и `apt-get check`;
3. использует `--no-remove --no-upgrade`, не передаёт `package=version` и не вызывает `--fix-broken`;
4. отклоняет simulation, которая меняет уже установленный пакет;
5. fallback на bundled repository выполняет только до первой изменяющей транзакции;
6. если APT уже конфликтует или безопасный additive plan невозможен, не меняет системные пакеты и продолжает установку ядра в degraded mode;
7. если APT уже начал изменяющую транзакцию и она завершилась ошибкой, установка останавливается как фатальная — второй package transaction не запускается.

На чистой поддерживаемой ОС full bundle по-прежнему обязан полностью установить и проверить `unzip`, Poppler, Tesseract `rus+eng` и LibreOffice.

## Bundle с llama.cpp/GGUF

На build/reference-машине:

```bash
npm run bundle:offline:llm --   --llama-runtime /srv/kafedra/llama-runtime   --model qwen=/srv/models/model.gguf   --default-model qwen   --output release-llm
```

На target используется тот же installer. Managed модель хранится content-addressed в `/var/lib/kafedra-planner/models`; отключение LLM не останавливает API/worker. Подробно: [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md).

## После установки

Строгая проверка полного document stack:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Если ОС уже имела APT-конфликт и установка завершилась в degraded mode, проверить именно рабочее ядро можно так:

```bash
sudo KAFEDRA_DOCTOR_ALLOW_DEGRADED=true   /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Забытый PIN сбрасывается локально:

```bash
sudo /opt/kafedra-planner/current/scripts/reset-pin.sh
```

## Автоматический release-gate

До merge проверяются:

- `npm run check`, включая согласованность документации;
- unit/integration, включая PIN setup/login/change/reset и lockout;
- smoke и backup/restore self-test;
- минимальный Node 24.15 и host Node 25;
- desktop/mobile Playwright, включая отдельный PIN-flow;
- сборка full Debian 12 bundle;
- `additive-only-v2` package contract и simulation guard;
- реальная air-gap systemd установка обычного bundle без first-login credential file;
- отдельная air-gap systemd установка fake `llama-server` + fake GGUF, повторный install и rollback.

Clean Debian gate остаётся строгим: degraded mode не может сделать CI зелёным при неполном OCR/Office stack.

## Что остаётся до stable

На реальной Astra Linux и контрольной Debian необходимо подтвердить:

- чистую установку `rc.9` и первый PIN-flow;
- поведение на уже обновлённой Astra с vendor revisions пакетов;
- отсутствие package mutation при заранее конфликтном `apt-get check`;
- реальные Tesseract/Poppler/LibreOffice на ведомственных документах;
- обновление существующей БД, backup/restore и искусственно сорванный update;
- права каталогов, systemd hardening и desktop/mobile сценарии;
- при использовании LLM — настоящий `llama-server`/GGUF и работу ядра после его отключения.

До фактического акта #27 проект остаётся release candidate независимо от состояния CI.
