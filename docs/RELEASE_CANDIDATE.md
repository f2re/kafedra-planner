# Release candidate 0.1.0-rc.6

## Статус

`0.1.0-rc.6` — текущий эксплуатационный release candidate, схема SQLite **19**. Основные функциональные контуры работают автономно и проходят unit/integration/Chromium/full-offline gates. Stable не объявляется до фактической приёмки на целевых Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

## Что входит в rc.6

- календарь `Месяц / Неделя / Задачи`, сроки и внутренние уведомления;
- постоянный стартовый режим `Автоматически / Месяц / Неделя / Задачи`; явная настройка сильнее learned UX;
- неизменяемые документы, структурные источники, ручные ревизии, OCR и LibreOffice preview;
- распоряжения/приказы/указы, поручения, прогресс, отчёты и подтверждение руководителем;
- импортированные и ручные годовые планы;
- режимы пункта плана `track / assigned / open` и уникальная связь `plan_item → assignment`;
- синхронизация выполнения плана с календарём и `План / факт`;
- номерные сопроводительные документы с необязательным immutable-файлом;
- заседания кафедры, нумерованная повестка, протоколы и выборочные выписки;
- научный реестр текущего рабочего среза;
- локальная авторизация, рекурсивная зона руководителя, CSRF и объектные ACL;
- проверяемые backup/restore и автоматический rollback update;
- SMTP/Telegram как необязательная внешняя доставка поверх внутреннего outbox;
- обучаемый, но геометрически стабильный UX;
- target-specific full offline bundle с Node 24.19, managed Python и `.deb` fallback;
- отдельный optional full offline bundle с `llama.cpp` и 1..N GGUF.

## Автономность

Календарь, документы, планы, поручения, отчёты, поиск, заседания и deterministic extraction обязаны работать при:

```text
KAFEDRA_LLM_ENABLED=false
```

LLM может добавлять только локальные предложения и диагностику. Наличие модели не является обязательным условием preflight обычной поставки.

## Поставка

### Обычный full bundle

Собирается на совместимой Debian/Astra reference-машине:

```bash
npm run bundle:offline
```

На target:

```bash
sudo ./install-kafedra-planner.sh
```

Для гарантированной установки без обращения к штатным APT sources:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

### Bundle с llama.cpp/GGUF

На build/reference-машине:

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/model.gguf \
  --default-model qwen \
  --output release-llm
```

На target используется тот же `install-kafedra-planner.sh`. Managed модель хранится content-addressed в `/var/lib/kafedra-planner/models`; отсутствие или отключение LLM не останавливает API/worker. Подробно: [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md).

## Перед установкой или обновлением

1. Использовать именно полный комплект: archive + `.sha256` + `install-kafedra-planner.sh` + `README-INSTALL.txt`.
2. На действующей установке не менять штатные package deployment paths вручную.
3. Убедиться, что каталог backup доступен.
4. Для HTTPS включить `KAFEDRA_AUTH_SECURE_COOKIES=true`.
5. Не отключать CSRF в production.
6. Не использовать `npm install`/`pip install` на target: runtime и application dependencies поставляются bundle.

Установщик проверяет archive/manifest/runtime, при необходимости ставит системные application capabilities, создаёт pre-update backup, переключает immutable release, выполняет миграции и health-check. При ошибке приложения выполняется rollback.

## После установки

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl status kafedra-planner-api kafedra-planner-worker --no-pager -l
```

Если установлен managed LLM:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/llm-doctor.mjs
systemctl status kafedra-planner-llama --no-pager -l
```

## Автоматический release-gate

До merge проверяются:

- `npm run check`, включая согласованность документации;
- unit/integration и smoke;
- backup/create/verify/restore self-test;
- минимальный Node 24.15;
- сборщик под host Node 25;
- desktop/mobile Playwright для планов, core UX, plan/fact, auth, release readiness и ACL;
- ordinary full Debian 12 bundle;
- реальная air-gap systemd установка ordinary bundle;
- отдельная air-gap systemd установка fake `llama-server` + fake GGUF bundle, включая повторный install, rollback и отключение LLM.

Fake LLM CI проверяет поставочный контракт и не заменяет испытание настоящего `llama.cpp`/GGUF на целевой Astra.

## Что остаётся до stable

На реальной Astra Linux и контрольной Debian необходимо подтвердить:

- бинарную совместимость embedded runtime с фактической ОС;
- реальные Tesseract/Poppler/LibreOffice на ведомственных документах;
- чистую установку и обновление существующей БД;
- зашифрованный backup, restore и сравнение acceptance evidence;
- искусственно сорванный update и автоматический rollback;
- права каталогов и systemd hardening;
- desktop/mobile пользовательские сценарии без инструкции разработчика;
- при использовании LLM — настоящий `llama-server`, реальную GGUF, `/health`, `/v1/models` и работу ядра после отключения LLM.

До этого проект остаётся release candidate независимо от состояния CI.
