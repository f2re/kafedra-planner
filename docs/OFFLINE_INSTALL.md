# Автономная поставка и предварительная проверка

## Что считается release-комплектом

Промышленный архив Kafedra Planner содержит приложение, миграции, документацию, установщик, манифест SHA-256 и встроенный исполняемый файл Node.js 24. Целевая машина не должна скачивать npm-пакеты, CDN-ресурсы или Node.js из Интернета.

Архив сопровождается внешним файлом `<archive>.sha256`. Внутри находится `manifest.sha256`, который фиксирует каждый обычный файл комплекта, включая встроенный runtime.

`release.json` содержит версию приложения, Git commit, версию Node, платформу и архитектуру runtime.

## Сборка

Для release-сборки нужно явно указать каталог совместимого Node.js 24 runtime:

```bash
export NODE_RUNTIME_DIR=/path/to/node-v24-linux-x64
export REQUIRE_NODE_RUNTIME=true
npm run bundle:offline
```

В архив копируется минимальный runtime: `runtime/node/bin/node` и лицензия Node, если она присутствует в исходном runtime. `npm`, `node_modules`, компилятор и заголовки на целевой машине не требуются.

CI делает такую сборку на каждом pull request и push в `main` с Node 24.18.0 и затем проверяет полученный архив в строгом режиме.

## Проверка архива

Перед переносом на сервер и перед запуском от `root`:

```bash
REQUIRE_EMBEDDED_RUNTIME=true \
REQUIRE_ARCHIVE_SHA256=true \
npm run bundle:verify -- release/kafedra-planner-0.1.0-rc.3.tar.gz
```

Проверяются:

- внешний SHA-256 архива;
- отсутствие небезопасных путей в tar;
- один корневой каталог;
- полный внутренний `manifest.sha256`;
- совпадение VERSION и `release.json`;
- наличие встроенного Node;
- версия Node 24, платформа и архитектура;
- smoke-test из распакованного архива именно встроенным Node;
- системный preflight машины.

Проверка целостности архива и готовность ОС — разные условия. Валидный архив может быть проверен на машине, где ещё не установлены Poppler, OCR или LibreOffice. Поэтому итог verifier отдельно показывает результат preflight.

## Обязательные команды целевой системы

Штатный `install.sh` запускает `system-preflight.mjs --strict` **до** создания пользователя, каталогов, копирования release и изменения systemd. Установка блокируется при отсутствии:

- `tar`;
- `sha256sum`;
- `curl`;
- `systemctl`;
- `runuser`;
- `useradd`;
- `unzip`;
- `pdftotext`.

Для Debian эти команды обычно предоставляют `tar`, `coreutils`, `curl`, `systemd`, `util-linux`, `passwd`, `unzip` и `poppler-utils`. На Astra Linux конкретные названия и версии пакетов необходимо фиксировать в акте приёмки, а не предполагать по Debian.

## Полный функциональный профиль

Для штатного OCR и предпросмотра офисных документов дополнительно нужны:

- `pdftoppm`;
- `tesseract` и языковые данные `rus`/`eng`;
- `soffice` или `libreoffice`.

Nginx рекомендуется как локальный reverse proxy, но не является условием запуска API: приложение слушает `127.0.0.1` и может использовать иной контролируемый reverse proxy.

Проверка минимального профиля:

```bash
runtime/node/bin/node application/scripts/system-preflight.mjs --strict
```

Проверка полного профиля перед эксплуатационной приёмкой:

```bash
runtime/node/bin/node application/scripts/system-preflight.mjs --require-full
```

Либо одновременно с verifier:

```bash
REQUIRE_EMBEDDED_RUNTIME=true \
REQUIRE_ARCHIVE_SHA256=true \
REQUIRE_SYSTEM_PREFLIGHT=true \
REQUIRE_FULL_SYSTEM_PREFLIGHT=true \
bash application/scripts/offline/verify-bundle.sh /path/to/archive.tar.gz
```

Последняя команда применяется к скрипту из рабочего дерева. При проверке уже полученного архива штатно используйте `npm run bundle:verify` на машине подготовки или извлеките архив во временный каталог и запускайте встроенный preflight непосредственно оттуда.

## Установка

После проверки SHA-256 и системных зависимостей:

```bash
tar -xzf kafedra-planner-0.1.0-rc.3.tar.gz
cd kafedra-planner-0.1.0-rc.3
sudo ./install.sh
```

Установщик:

1. проверяет встроенный Node и обязательные системные команды;
2. создаёт системного пользователя и защищённые каталоги;
3. сохраняет release в `/opt/kafedra-planner/releases/<version>`;
4. перед обновлением действующей установки создаёт и проверяет backup;
5. переключает `current`, выполняет миграции и запускает systemd-службы;
6. выполняет health-check;
7. при любой ошибке обновления восстанавливает данные и предыдущий release.

Предварительная проверка специально находится до первого изменения системы. Неподготовленная машина должна получить понятный список недостающих компонентов, а не частично установленный продукт.

## Что CI доказывает, а что нет

Ubuntu CI доказывает:

- воспроизводимость структуры release-архива;
- наличие и запуск встроенного Node 24;
- SHA-256 и внутренний manifest;
- миграции, smoke и автоматические тесты;
- корректность самого preflight-контракта.

CI **не доказывает** бинарную совместимость встроенного Node с конкретной Astra Linux, реальную работу версий LibreOffice/Poppler/Tesseract на ней, systemd hardening, права каталогов, RTO восстановления или rollback на действующем сервере.

Эти свойства принимаются только по #27. В акте необходимо сохранить вывод:

```bash
runtime/node/bin/node application/scripts/system-preflight.mjs --json
cat /etc/os-release
ldd runtime/node/bin/node
```

а также SHA-256 архива, Git commit, версии системных пакетов и результат backup/restore/rollback.
