# Offline llama.cpp для Astra Linux/Debian

`llama.cpp` в Kafedra Planner — **необязательное улучшение**. Календарь, планы, документы, поручения, отчёты, поиск и deterministic extraction работают без модели и без Интернета.

Этот контур нужен, когда локальную модель требуется поставить вместе с полностью автономным bundle на изолированную Astra Linux/Debian.

## Что входит в LLM-bundle

Обычный full bundle дополняется:

```text
llm/
├─ manifest.json
├─ runtime/
│  └─ bin/
│     ├─ llama-server
│     └─ lib*.so*       # если нужны конкретной сборке llama.cpp
└─ models/
   ├─ qwen.gguf
   └─ reserve.gguf
```

В Git попадают только скрипты и контракт. `llama-server`, shared libraries и GGUF в репозиторий **не коммитятся**.

Каждый файл release защищён общим `manifest.sha256`. Дополнительно `llm/manifest.json` фиксирует SHA-256 runtime и каждой модели, alias, размер, модель по умолчанию и параметры запуска. Повреждённый GGUF installer не принимает.

## 1. Подготовить runtime llama.cpp

Собирать bundle нужно на машине той же семьи ОС, версии и архитектуры, что и target. Это то же ограничение, которое уже действует для полного `.deb` fallback.

Подготовьте каталог вида:

```text
/srv/kafedra/llama-runtime/
├─ LICENSE
└─ bin/
   ├─ llama-server
   ├─ libllama.so...
   ├─ libggml.so...
   └─ ...
```

`bin/llama-server` должен быть executable, а рядом в корне runtime должен сохраняться `LICENSE`, `LICENSE.md` или `COPYING` llama.cpp. Сборщик запускает `llama-server --version`, поэтому runtime другой архитектуры или неработоспособная сборка не проходят подготовку. Если используемая сборка кладёт shared libraries в `lib/`, этот каталог можно оставить рядом: runner добавляет `runtime/llama/bin` и `runtime/llama/lib` в `LD_LIBRARY_PATH`.

Сборщик запускает `ldd` и останавливается при `not found`. Это не заменяет целевую Astra-приёмку: runtime необходимо готовить на совместимой reference-машине.

## 2. Подготовить GGUF

Можно включить несколько моделей. Для каждой задаётся устойчивый короткий alias:

```text
qwen=/srv/models/Qwen3-4B-Q4_K_M.gguf
fast=/srv/models/small-model-Q4_K_M.gguf
```

Alias допускает латинские буквы, цифры, `.`, `_`, `-`. Фактическое исходное имя файла не используется как системный идентификатор.

## 3. Собрать LLM full bundle

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/Qwen3-4B-Q4_K_M.gguf \
  --model fast=/srv/models/small-model-Q4_K_M.gguf \
  --default-model qwen \
  --context-size 8192 \
  --threads 8 \
  --parallel 1 \
  --output release-llm
```

Системный package layer собирается тем же `build-full-bundle.sh`. Разрешены те же параметры:

```bash
--reuse-os-packages
--refresh-os-packages
--apt-update
--python /path/to/python3
```

Если модели нужно только доставить, но не запускать сразу:

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/model.gguf \
  --disabled-by-default
```

Результат:

```text
kafedra-planner-<version>-astra-<version>-<arch>-llm.tar.gz
kafedra-planner-<...>-llm.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
```

## 4. Перенести и установить без Интернета

Скопируйте четыре файла в один каталог target-машины и выполните:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Wrapper проверяет внешний SHA-256, безопасно распаковывает archive и передаёт управление штатному installer.

При LLM payload installer:

1. повторно проверяет внутренний manifest и `llm/manifest.json`;
2. устанавливает каждую модель в `/var/lib/kafedra-planner/models/<sha256>.gguf`;
3. не копирует модель второй раз, если файл с тем же digest уже есть;
4. кладёт llama.cpp runtime в versioned release `runtime/llama`;
5. сохраняет LLM-параметры в `/etc/kafedra-planner/kafedra-planner.env`;
6. запускает hardened `kafedra-planner-llama.service` только при `KAFEDRA_LLM_ENABLED=true` и `KAFEDRA_LLM_MANAGED=true`;
7. ждёт `/health` и `/v1/models`, проверяет alias модели;
8. только после ready продолжает итоговую проверку API/worker.

На существующей rc.6-установке явно выбранный LLM-bundle переводит старую нетронутую локальную настройку `LLM_ENABLED=false + 127.0.0.1:8081` в managed-режим. Уже настроенный внешний/включённый endpoint не переписывается молча.

## Модели и backup

GGUF — воспроизводимый deployment asset, а не подтверждённый предметный факт. Поэтому стандартный backup сохраняет SQLite, immutable document blobs, config и application release, но не дублирует многогигабайтный model cache.

Для disaster recovery храните исходный LLM release bundle рядом с резервными копиями приложения. После restore снова запустите его installer: content-addressed model cache восстановится из bundle без изменения SQLite.

## Проверка

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/llm-doctor.mjs
```

Или полная диагностика:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

`llm-doctor` проверяет:

- включён ли LLM;
- доступность `/health`;
- OpenAI-compatible `/v1/models`;
- наличие выбранного alias.

Managed LLM обязан пройти эту проверку. Для внешнего endpoint неисправность диагностируется, но основной deterministic-контур остаётся работоспособным.

## Смена активной модели

Все модели из bundle уже находятся в content-addressed cache. Посмотрите manifest исходного bundle и SHA нужной модели либо список файлов в `/var/lib/kafedra-planner/models`.

Измените в `/etc/kafedra-planner/kafedra-planner.env`:

```text
KAFEDRA_LLM_MODEL=<alias>
KAFEDRA_LLM_MODEL_PATH=/var/lib/kafedra-planner/models/<sha256>.gguf
```

Затем:

```bash
sudo systemctl restart kafedra-planner-llama.service
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/llm-doctor.mjs
```

Alias и путь должны относиться к одной модели. Installer автоматически задаёт эту пару только для модели по умолчанию из manifest.

## Отключение LLM

```bash
sudo sed -i 's/^KAFEDRA_LLM_ENABLED=.*/KAFEDRA_LLM_ENABLED=false/' \
  /etc/kafedra-planner/kafedra-planner.env
sudo systemctl disable --now kafedra-planner-llama.service
sudo systemctl restart kafedra-planner-worker.service
```

Удалять модель не требуется. API/worker продолжают работать в deterministic-режиме.

## Внешний llama-server

Managed systemd не обязателен. Для уже существующего локального/LAN сервера:

```text
KAFEDRA_LLM_ENABLED=true
KAFEDRA_LLM_MANAGED=false
KAFEDRA_LLM_ENDPOINT=http://192.168.1.50:8081
KAFEDRA_LLM_MODEL=my-model
```

`KAFEDRA_LLM_MANAGED=false` запрещает installer управлять `kafedra-planner-llama.service`. Системный preflight не считает отсутствие llama.cpp ошибкой базовой поставки.

## Параметры managed server

```text
KAFEDRA_LLM_MANAGED=true
KAFEDRA_LLM_HOST=127.0.0.1
KAFEDRA_LLM_PORT=8081
KAFEDRA_LLM_MODEL=<alias>
KAFEDRA_LLM_MODEL_PATH=/var/lib/kafedra-planner/models/<sha256>.gguf
KAFEDRA_LLM_CONTEXT_SIZE=8192
KAFEDRA_LLM_THREADS=0
KAFEDRA_LLM_PARALLEL=1
KAFEDRA_LLM_START_TIMEOUT_SECONDS=180
```

`HOST` для managed service намеренно ограничен `127.0.0.1`: API модели не публикуется в LAN. Внешний LAN endpoint настраивается только явно через `KAFEDRA_LLM_MANAGED=false`.

## CI

Unit/regression использует крошечные fake `.gguf` и fake `llama-server`; реальная модель в CI не нужна. Full systemd gate дополнительно разворачивает LLM-вариант bundle в полностью отключённом от сети Debian target и проверяет:

- active/enable systemd service;
- `/health` и `/v1/models`;
- повторный install без копирования той же модели;
- отключение LLM при сохранении active API/worker.

Реальный `llama.cpp` + реальная GGUF на Astra остаются частью целевой эксплуатационной приёмки, а не заменяются fake CI.
