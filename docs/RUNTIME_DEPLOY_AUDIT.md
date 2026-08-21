# Аудит runtime, зависимостей и deployment

Актуализировано: 2026-08-21. Документ фиксирует текущий контракт поставки `0.1.0-rc.7`; исторические причины решений сохранены только там, где они объясняют инвариант.

## Host Node и runtime поставки

У сборки две разные роли Node.js:

1. **host Node** запускает build scripts в checkout;
2. **runtime поставки** попадает в автономный архив и запускает API/worker на target.

Host Node может отличаться. Production bundle содержит закреплённый Node.js **24.19.0**, соответствующий `engines.node >=24.15.0 <25`. SHA-256 официальных x64/arm64 архивов хранится в `package.json` в `kafedra.offlineRuntime`.

Сборщик принимает совместимый `NODE_RUNTIME_DIR`/`NODE_BINARY`, использует проверенный cache либо загружает закреплённый официальный runtime. Host Node никогда молча не копируется в release только потому, что он установлен на build-машине.

## Production npm-зависимости

Основной runtime использует стандартную библиотеку Node.js и системные CLI-адаптеры. `@playwright/test` — devDependency только для CI/browser tests. На целевой Astra/Debian `npm install` не выполняется и `node_modules` в production release не требуется.

## Идентичность release

Каталог установленного bundle содержит semantic version, commit/fingerprint и runtime. Для LLM-варианта release identity дополнительно зависит от LLM manifest. Поэтому разные commits или разные наборы runtime/models одной RC-версии не переиспользуют один каталог ошибочно.

Копирование release выполняется через staging и atomic rename. Повторная установка уже существующего идентичного release не возвращает преждевременный успех: миграции, службы и health-check проверяются снова.

## Системные зависимости: full bundle v2

Текущий full bundle **target-specific**. Он содержит:

```text
application/       приложение, migrations, docs и static UI
runtime/node/      закреплённый Node.js
runtime/python/    managed CPython для OCR adapter
os-packages/       проверяемый target-specific .deb air-gap closure
deployment.json    OS/runtime/package contract
manifest.sha256    SHA-256 каждого файла release
```

`config/offline/os-packages.txt` перечисляет только document capabilities по именам: Poppler, Tesseract/языки, LibreOffice, unzip и шрифты. Приложение не фиксирует `package=version` и не управляет базовым userspace ОС как собственной зависимостью.

Package layer имеет два независимых инварианта:

- `full-airgap-v2` — collector на здоровой reference OS материализует полное замыкание для чистой отключённой target;
- `additive-only-v2` — target installer может только добавить отсутствующий package, но не upgrade/downgrade/remove уже установленный.

Collector перед выпуском `.deb` выполняет `dpkg --audit` и `apt-get check`. Старый cache без v2-контракта повторно использовать нельзя.

На target installer сначала определяет фактически отсутствующие команды/языки. Перед любой package-транзакцией снова выполняются `dpkg --audit` и `apt-get check`; simulation использует `--no-remove --no-upgrade`, а отдельный guard отклоняет план с `Remv` или заменой установленной версии.

В `KAFEDRA_APT_MODE=auto` installer сначала планирует/скачивает ordinary install из штатных APT sources; если это невозможно **до изменения dpkg**, допускается bundled `file:` repository. В `KAFEDRA_APT_MODE=bundle` сеть не нужна.

`apt --fix-broken`/`apt-get --fix-broken` автоматически не запускаются. Если package database была конфликтной **до** установки, системные пакеты не меняются, но API/worker продолжают устанавливаться с degraded document capabilities. Если изменяющая APT-транзакция уже началась и упала, это фатальная ошибка: второй package transaction не выполняется.

Обычный `offline/doctor.sh` остаётся строгим full-capability gate. Только installer после доказанной non-mutating package failure использует `KAFEDRA_DOCTOR_ALLOW_DEGRADED=true` для проверки ядра.

Подробно: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md), [`FULL_OFFLINE_DEPLOYMENT.md`](FULL_OFFLINE_DEPLOYMENT.md), [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md).

## LLM runtime

Optional LLM bundle добавляет проверенный `llama-server`, соседние shared libraries и 1..N GGUF. Большие binary assets не хранятся в Git.

- runtime проверяется через `llama-server --version` и `ldd`;
- GGUF проверяется по magic, размеру и SHA-256;
- model cache хранится в `/var/lib/kafedra-planner/models/<sha256>.gguf`;
- managed service слушает только `127.0.0.1`;
- внешний `KAFEDRA_LLM_ENDPOINT` поддерживается без управления systemd;
- основной preflight не требует LLM.

Подробно: [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md).

## Что проверяет CI и чего он не доказывает

CI проверяет runtime separation, package contract v2, ordinary full bundle, bundled air-gap path, simulation guard, systemd install/update и отдельный LLM/GGUF deployment fixture. Docker применяется только как disposable CI-среда и не является частью production.

CI не доказывает совместимость конкретной редакции Astra Linux. Финальный gate — фактическая процедура из [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md), включая здоровую обновлённую Astra и отдельно заранее конфликтный APT без package mutation.
