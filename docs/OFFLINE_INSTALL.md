# Автономная поставка и установка

## Два разных Node.js

В процессе сборки есть две разные роли, их нельзя смешивать:

- **host Node** запускает `npm` и `scripts/offline/build-bundle.sh` на машине разработчика или CI;
- **runtime поставки** находится внутри `runtime/node/bin/node` и запускает приложение на целевом сервере.

Приложение поддерживает Node.js `>=24.15.0 <25`. Это runtime-контракт серверного приложения. Версия host Node сборщика может отличаться. В частности, локальный Node.js 25 не должен сам по себе блокировать создание архива.

Для воспроизводимости bundle закреплён на конкретном runtime Node.js **24.19.0 LTS**. Версия, URL официальных архивов и SHA-256 для Linux x64/arm64 находятся в `package.json` в `kafedra.offlineRuntime`. Один и тот же commit поэтому не получает случайно другой Node runtime в зависимости от PATH сборщика.

## Что входит в bundle

Штатный archive содержит:

- application code, миграции и web assets;
- `deploy/install.sh` и systemd units;
- документацию;
- встроенный Linux Node.js 24.19.0 и его LICENSE;
- `release.json` с Git commit, runtime metadata и SHA-256 Node binary;
- полный внутренний `manifest.sha256`;
- внешний `<archive>.sha256`.

`node_modules` в production bundle не требуется: production-код не имеет внешних npm runtime imports. Playwright является только devDependency CI.

Системные пакеты ОС не складываются в один универсальный tar.gz. Poppler, Tesseract, LibreOffice, systemd и их `.deb` зависят от конкретного Debian/Astra выпуска. Для полностью изолированной установки чистой ОС этот слой должен быть подготовлен отдельно как репозиторий или проверенный набор пакетов целевой ОС.

## Обычная сборка

```bash
npm run bundle:offline
```

Алгоритм выбора runtime:

1. если указан `NODE_RUNTIME_DIR` или `NODE_BINARY`, проверяется этот runtime;
2. иначе проверяется подходящий runtime в локальном cache;
3. если cache пуст, сборщик загружает закреплённый официальный архив Node.js 24.19.0, проверяет его по SHA-256 из `package.json` и помещает минимальный runtime в cache;
4. host Node в bundle не копируется, если он не является ровно тем закреплённым runtime, который прошёл контракт.

Cache по умолчанию находится в `${XDG_CACHE_HOME:-$HOME/.cache}/kafedra-planner/node`. Путь можно изменить:

```bash
KAFEDRA_RUNTIME_CACHE_DIR=/srv/kafedra-cache/node npm run bundle:offline
```

Источник официального архива можно заменить контролируемым HTTPS mirror:

```bash
NODE_DIST_BASE_URL=https://mirror.example/node npm run bundle:offline
```

Digest при этом остаётся закреплённым в репозитории и проверяется до распаковки.

### Полностью offline builder

На машине сборки без Интернета заранее распакуйте проверенный официальный Node 24.19.0 и передайте каталог:

```bash
NODE_RUNTIME_DIR=/opt/build-runtimes/node-v24.19.0-linux-x64 \
  npm run bundle:offline
```

Либо один раз наполните `KAFEDRA_RUNTIME_CACHE_DIR` в подключённой среде и перенесите cache. Сеть на целевой машине установки не требуется.

## Git provenance

Release bundle по умолчанию нельзя собрать из Git worktree с незакоммиченными изменениями: в таком случае нельзя доказать, какому commit соответствует содержимое архива.

Для диагностической нерелизной сборки допускается явный override:

```bash
ALLOW_DIRTY_BUNDLE=true npm run bundle:offline
```

В этом режиме `gitCommit` в `release.json` не выдаётся за достоверный commit.

## Проверка архива

```bash
npm run bundle:verify -- release/kafedra-planner-0.1.0-rc.3.tar.gz
```

Verifier проверяет:

- внешний SHA-256;
- безопасную структуру tar без symlink/special entries и path traversal;
- полный внутренний manifest без пропусков, дублей и лишних файлов;
- совпадение `VERSION`, `package.json`, `release.json`;
- закреплённую версию Node runtime, архитектуру, размер и SHA-256 бинарника;
- наличие SQLite, ICU/ru-RU и OpenSSL в runtime;
- совпадение корневого и application installer;
- smoke-test именно встроенным Node;
- system preflight, если он не отключён для изолированного build-check.

## Почему Node 24 LTS

Production storage использует встроенный `node:sqlite`. Нижняя граница Node 24.15.0 соответствует линии, где SQLite API в Node 24 получил статус release candidate. Верхняя граница `<25` является эксплуатационной политикой: production runtime не перескакивает автоматически между major и остаётся на LTS-линии.

Конкретный pin 24.19.0 не является требованием исходного кода. Это версия **поставляемого бинарника**, выбранная для воспроизводимости, security/bugfix обновлений LTS и одинаковой диагностики. Обновление pin выполняется отдельно: изменяются версия и официальные SHA-256, после чего проходят минимальная Node 24.15 проверка, основной CI и полная offline сборка.

## Системный preflight целевой машины

До системных изменений installer проверяет runtime и обязательные команды. Минимальный профиль требует:

- `tar` и `sha256sum`;
- `systemctl`, `runuser`, `useradd`;
- `unzip`;
- `pdftotext`.

`curl` не требуется: health-check выполняется встроенным `node:http`.

Дополнительные возможности:

- `pdftoppm` + `tesseract` — OCR;
- `soffice`/`libreoffice` — preview офисных документов;
- `nginx` — рекомендуемый reverse proxy.

Проверка:

```bash
runtime/node/bin/node application/scripts/system-preflight.mjs --strict
runtime/node/bin/node application/scripts/system-preflight.mjs --require-full
```

Установщик также запускает `ldd runtime/node/bin/node` до исполнения runtime и блокирует установку при неразрешённых динамических зависимостях.

## Установка и обновление

```bash
sha256sum -c kafedra-planner-0.1.0-rc.3.tar.gz.sha256
tar -xzf kafedra-planner-0.1.0-rc.3.tar.gz
cd kafedra-planner-0.1.0-rc.3
sudo ./install.sh
```

`VERSION` является semantic version продукта и больше не используется как единственный ID каталога. Release path для достоверного bundle имеет вид:

```text
/opt/kafedra-planner/releases/<VERSION>-<commit12>-node<runtime>
```

Это позволяет ставить несколько commits одной `0.1.0-rc.3`, что особенно важно во время RC-разработки.

Install/update flow:

1. проверяет manifest, release metadata, runtime и system preflight до изменений;
2. формирует build-specific release ID;
3. копирует приложение во временный `.staging.<pid>`;
4. атомарно переименовывает staging в финальный release;
5. перед переключением существующей базы создаёт и проверяет backup;
6. атомарно переключает `current`;
7. выполняет миграции;
8. включает обе systemd-службы;
9. ждёт готовности API и worker и проверяет HTTP `/api/system/health` через встроенный Node;
10. при ошибке восстанавливает предыдущий release и backup.

Повторный запуск того же installer идемпотентен: уже распакованный идентичный release переиспользуется, но миграции, обе службы и health-check проверяются снова. Это позволяет безопасно повторить команду после прерванного запуска.

## CI release-gate

CI использует три уровня:

1. **минимальный runtime** — unit/check/smoke на Node 24.15.0, чтобы нижняя граница `engines.node` была реальной;
2. **основной LTS** — `.nvmrc` и браузерные проверки на закреплённой Node 24.19.0;
3. **offline builder regression** — host Node отличается от runtime поставки. Сборщик обязан создать bundle с Node 24.19.0, а не скопировать host Node.

Готовый архив публикуется только после unit/browser gates и повторной проверки bundle.

## Эксплуатационная граница

Ubuntu CI доказывает приложение, структуру поставки и build/update contracts. Он не доказывает бинарную совместимость с конкретной Astra Linux, работу конкретных версий LibreOffice/Poppler/Tesseract или RTO восстановления.

Для целевой приёмки необходимо зафиксировать:

```bash
cat /etc/os-release
ldd runtime/node/bin/node
runtime/node/bin/node application/scripts/system-preflight.mjs --json
sha256sum kafedra-planner-*.tar.gz
```

а также реальные install/update/rollback, OCR/preview и backup/restore на выбранном выпуске Debian/Astra Linux.

Сводка решений аудита: [`RUNTIME_DEPLOY_AUDIT.md`](RUNTIME_DEPLOY_AUDIT.md).
