# Полная автономная поставка Kafedra Planner

## Нормальный сценарий

Full bundle собирается на reference Debian/Astra Linux той же версии и архитектуры, что целевая машина:

```bash
npm run bundle:offline
```

Результат в `release/`:

```text
kafedra-planner-<version>-<os>-<version>-<arch>.tar.gz
kafedra-planner-<...>.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
```

На целевой машине:

```bash
sudo ./install-kafedra-planner.sh
```

Интернет на target не обязателен. `npm install`, `pip install` и системный Python для приложения не требуются.

## Что входит в full bundle

- приложение, миграции, static UI и systemd units;
- закреплённый Node.js 24 LTS;
- managed CPython для локального OCR orchestration;
- полное air-gap `.deb`-замыкание document capabilities;
- Tesseract и языки `rus`/`eng`;
- Poppler (`pdftotext`, `pdftoppm`);
- LibreOffice Writer/Calc/Core и базовые шрифты;
- `release.json`, `deployment.json`, внутренний manifest и внешний SHA-256.

Базовые компоненты ОС (`systemd`, `coreutils`, `util-linux`, `passwd`, `tar`, `libc6`, `perl-base` и т.п.) не являются верхнеуровневыми пакетами приложения. Они могут встречаться внутри полного dependency closure только как транзитивные `.deb`; target installer не имеет права заменять уже установленную версию такого пакета.

## Package contract v2

Package layer `rc.7` имеет два явных признака:

```text
DEPENDENCY_CLOSURE=full-airgap-v2
TARGET_INSTALL_POLICY=additive-only-v2
```

`full-airgap-v2` означает, что collector на build/reference-машине намеренно вычисляет полное замыкание, достаточное для чистой отключённой ОС. Для этого только на стадии сборки используется пустой synthetic `dpkg status`. Он не переносится в package manager target и не является lock-файлом.

`additive-only-v2` означает противоположное правило на target: разрешена только установка ранее отсутствующих пакетов. Обновление, downgrade и удаление уже установленного пакета запрещены.

Версии в `packages.tsv` используются только как inventory/evidence содержимого bundle. Ни один target path не формирует `package=version`.

## Сборка package layer

Перед скачиванием `.deb` collector проверяет reference OS:

```text
dpkg --audit
apt-get check
```

Если reference package database повреждена, bundle не выпускается. При `--apt-update` проверка повторяется после обновления indexes.

Обычная сборка пересобирает package layer:

```bash
npm run bundle:offline
```

Обновить indexes перед сборкой:

```bash
sudo npm run bundle:offline -- --apt-update
```

Повторное использование cache разрешается только явно:

```bash
npm run bundle:offline -- --reuse-os-packages
```

Cache должен соответствовать текущему `config/offline/os-packages.txt`, OS profile и контракту `additive-only-v2`; cache старого формата отклоняется.

## Что делает target installer

Package step работает по фактически отсутствующим возможностям, а не по всему списку сразу:

- нет `unzip` → запрашивается `unzip`;
- нет `pdftotext`/`pdftoppm` → `poppler-utils`;
- нет Tesseract или `rus`/`eng` → соответствующие Tesseract packages;
- нет LibreOffice → Writer/Calc/Core и шрифты.

Перед любой транзакцией выполняются:

```text
dpkg --audit
apt-get check
```

Затем normal mode использует:

```text
system APT simulation
        ↓
additive-plan guard
        ↓
download-only
        ↓
install
```

Если system sources недоступны до изменения dpkg, `auto` может перейти к локальному `file:` repository. Bundled path повторно выполняет simulation и тот же additive-plan guard.

Каждая target команда APT использует `--no-remove --no-upgrade --no-install-recommends`. `--allow-downgrades`, version pinning и автоматический `--fix-broken` запрещены.

## Уже конфликтный APT на Astra/Debian

Если `apt-get check` до установки уже сообщает несовместимые версии (`perl/perl-base`, `libc6-dev/libc6`, `acl/libacl1`, vendor Astra revisions и т.п.), Kafedra Planner:

1. не меняет ни один системный пакет;
2. не запускает `apt --fix-broken`;
3. не пробует поверх конфликта второй repository;
4. продолжает установку приложения, БД, API и worker;
5. отмечает document capabilities как degraded.

Это важно: пакетная проблема ОС не должна делать недоступными календарь, задачи, поручения и уже сохранённые данные.

Если реальная APT-транзакция уже началась и завершилась ошибкой, installer останавливается с фатальным кодом. Автоматически запускать вторую package-транзакцию в таком состоянии небезопасно.

## Строгая и degraded диагностика

Обычный doctor остаётся строгим acceptance gate:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Он требует `unzip`, Poppler, Tesseract с нужными языками и LibreOffice.

Для машины, где package step безопасно пропущен из-за заранее конфликтного APT, можно проверить рабочее ядро:

```bash
sudo KAFEDRA_DOCTOR_ALLOW_DEGRADED=true \
  /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Этот режим не скрывает отсутствующие возможности: preflight перечисляет их, но API/worker считаются рабочими, если обязательные platform prerequisites и HTTP health исправны.

## Явные APT-режимы

По умолчанию используется `KAFEDRA_APT_MODE=auto`.

```bash
sudo ./install-kafedra-planner.sh
```

Принудительно только bundled repository:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Только штатные system sources:

```bash
sudo KAFEDRA_APT_MODE=system ./install-kafedra-planner.sh
```

## Совместимость bundle

`.deb`-fallback нельзя переносить между Debian 12, Astra 1.7, Astra 1.8 и другими выпусками. `source-os.env` фиксирует family, `ID`, `VERSION_ID` и architecture; installer проверяет совместимость серий ОС (все уровни обновлений Astra 1.7.x Smolensk совместимы между собой; Astra 1.8.x — между собой) до начала package step.

Это ограничение относится к fallback repository, а не к версиям уже установленных пакетов target. Vendor revisions внутри одной поддерживаемой Astra не должны понижаться или обновляться ради приложения.

## Автоматическая диагностика и самовосстановление

Если целевая ОС имела незавершённые транзакции пакетов (`dpkg --audit`) или неудовлетворённые зависимости стороннего ПО (`apt-get check`), Kafedra Planner устанавливает рабочее ядро в безопасном degraded-режиме, не запуская разрушительный `apt --fix-broken`.

Для полной автоматической диагностики и восстановления пакетов одной командой запустите:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh --repair
```

Команда автоматически:
1. Завершает прерванную настройку пакетов (`dpkg --configure -a`);
2. Проверяет целостность APT-зависимостей;
3. Доустанавливает недостающие модули (`unzip`, `poppler-utils`, `tesseract`, `libreoffice`) из локального комплекта поставки без переустановки ядра;
4. Проводит финальную верификацию готовности служб.

Для детального отчёта о состоянии пакетной базы ОС:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh --diagnose-apt
```

## Установка и обновление приложения

После package preparation installer:

1. проверяет bundle runtime/manifest;
2. создаёт immutable release через staging + atomic rename;
3. сохраняет config/data;
4. перед изменяющим update создаёт проверенную резервную копию;
5. переключает `current`, выполняет миграции;
6. на чистой системе подготавливает локальный контур, после чего пользователь задаёт PIN при первом открытии;
7. запускает API/worker и optional managed LLM;
8. выполняет HTTP health и strict/degraded doctor в соответствии с фактическим package result;
9. при ошибке приложения возвращает предыдущий release/data через штатный rollback.

Стандартные пути:

```text
приложение: /opt/kafedra-planner/current
данные:     /var/lib/kafedra-planner
SQLite:     /var/lib/kafedra-planner/kafedra-planner.sqlite3
backup:     /var/backups/kafedra-planner
config:     /etc/kafedra-planner/kafedra-planner.env
```

`kafedra-planner.env` остаётся файлом данных, а не shell-скриптом. Нестандартные package deployment paths updater не угадывает и останавливается до остановки служб/миграций.

## CI и реальная Astra-приёмка

GitHub CI строит чистый Debian 12 full bundle, проверяет `additive-only-v2`, реально устанавливает bundle без сети под systemd, затем выполняет строгий OCR/Poppler/LibreOffice doctor. Поэтому degraded mode не может скрыть неполный clean artifact.

Реальная Astra Linux остаётся отдельной приёмкой по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27. Именно там проверяются vendor revisions пакетов, реальные ведомственные документы, update/rollback и восстановление.
