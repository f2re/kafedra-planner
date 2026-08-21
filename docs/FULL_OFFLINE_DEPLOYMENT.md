# Аудит полного offline deployment

Дата первоначального контура: 2026-08-11. Последняя корректировка APT-политики и end-to-end проверки: 2026-08-12.

## Исходная проблема

Первый full bundle устранил внешние зависимости приложения, но сделал системный package layer слишком жёстким: `.deb` собирались как точный слепок reference Debian/Astra и installer при необходимости OCR/PDF/Office отключал штатные APT sources target-системы. На чистом Debian acceptance это воспроизводимо, но на реально обновлённой Astra одна и та же версия ОС может иметь другой набор актуальных package revisions.

Дополнительный риск создавали две детали:

- верхнеуровневый package profile включал базовые пакеты ОС (`systemd`, `coreutils`, `util-linux`, `passwd`, `tar`), хотя приложение не должно управлять версиями базового userspace;
- OS package cache мог переиспользоваться между release-сборками без явного решения оператора, поэтому новый архив мог наследовать старые `.deb`.

## Текущий принцип

Версии `.deb` остаются в inventory только как доказательство содержимого автономного fallback. Они **не являются install pins**.

Нормальная установка системных возможностей теперь использует такую последовательность:

```text
full preflight не пройден
        ↓
dpkg --audit
        ↓
штатный APT target-системы
apt-get install <package names>
(simulate → download-only → install)
        ↓ при недоступном repository до изменения dpkg
локальный file: repository из bundle
apt-get install <package names>
        ↓
full preflight + OCR doctor
```

Ни одна ветка не формирует `package=version` и не запускает `apt --fix-broken` автоматически.

`download-only` перед обычной установкой принципиален: если network/repository target-системы недоступен, это выясняется до изменения dpkg, поэтому auto-mode может безопасно перейти к bundled fallback. Если реальная APT-установка уже начала изменять систему и завершилась ошибкой, installer останавливается и не пытается поверх неё выполнять второй package transaction.

## Что входит в full bundle

```text
application/       код и миграции
runtime/node/      Node.js 24 LTS
runtime/python/    managed CPython
os-packages/       проверяемый .deb fallback для application capabilities
deployment.json    связь runtime и OS profile
manifest.sha256    контроль всех файлов
```

Верхнеуровневый список `config/offline/os-packages.txt` содержит только application capabilities: unzip, Poppler, Tesseract, LibreOffice и шрифты. Базовые пакеты ОС не запрашиваются приложением как собственные зависимости. При этом полное fallback-замыкание может содержать отдельные системные `.deb` транзитивно; APT использует их только если установленная target-версия не удовлетворяет зависимости.

## Сборка package layer

Сборщик не задаёт версии пакетов. `collect-os-packages.sh` получает текущие APT candidates reference-системы по именам пакетов и сохраняет полный offline closure с SHA-256 inventory.

Release-сборка по умолчанию пересобирает этот слой заново. Старый cache используется только при явном `--reuse-os-packages`, причём его `requested-packages.txt` должен совпадать с текущим profile. Это устраняет молчаливое попадание устаревшего package cache в новый release.

Если нужно обновить APT indexes самой reference VM:

```bash
sudo npm run bundle:offline -- --apt-update
```

Для air-gapped reference VM разрешён явно подготовленный cache:

```bash
KAFEDRA_OS_PACKAGES_DIR=/srv/kafedra-cache/os-packages \
npm run bundle:offline -- --reuse-os-packages
```

## Режимы target installer

По умолчанию используется `KAFEDRA_APT_MODE=auto`.

- `auto` — штатный APT target-системы без version pinning, затем offline fallback;
- `system` — только штатные APT sources, полезно для диагностики;
- `bundle` — только bundled `file:` repository, гарантированный air-gap режим.

Для полностью отключённой машины:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Интернет по-прежнему не является обязательным условием эксплуатации.

## CI acceptance

Debian 12 gate проверяет package layer и реальный пользовательский installer в два этапа.

Сначала full bundle собирается на чистом `node:24-bookworm` и проверяется на уровне содержимого/runtime:

- `requested-packages.txt` не содержит version expressions и не запрашивает базовый userspace как top-level application packages;
- `KAFEDRA_APT_MODE=system ... --check-only` подтверждает обычный APT plan по именам пакетов;
- `KAFEDRA_APT_MODE=bundle` реально устанавливает зависимости только из bundled repository;
- проходят Tesseract `rus+eng`, Poppler, LibreOffice, managed Python, migrations, initial admin и HTTP health.

Затем `scripts/offline/systemd-deploy-selftest.sh` создаёт отдельную чистую Debian 12 reference-среду с настоящим systemd. Docker используется только как disposable CI-изоляция и не входит в production/runtime. После подготовки базовой ОС сеть target-контейнера полностью отключается. В него копируются только четыре файла, которые получает оператор:

```text
kafedra-planner-<version>-<profile>.tar.gz
kafedra-planner-<...>.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
```

Selftest запускает именно `install-kafedra-planner.sh` в `KAFEDRA_APT_MODE=bundle` и проверяет:

- внешний SHA-256 и безопасную распаковку wrapper;
- полный `deploy/install.sh`, создание системного пользователя, каталогов и config;
- установку application dependencies без сети;
- immutable release и `current` symlink;
- миграции и создание первого администратора;
- права `0640` на config и `0600` на first-login file;
- настоящие systemd units: enabled + active API/worker;
- итоговый `offline/doctor.sh` и HTTP health;
- повторный запуск того же installer как idempotent update;
- отсутствие второго release и повторной генерации first-login credentials;
- создание проверенной pre-update backup при повторной установке.

Только после этих проверок на push в `main` публикуется full artifact.

Реальная эксплуатационная приёмка Astra остаётся отдельным обязательным этапом #27: Debian CI не подменяет запуск на целевой Astra Linux, но теперь проверяет весь операторский install/update flow, а не только отдельные внутренние компоненты bundle.

## Вариант с локальным llama.cpp и GGUF

Поверх обычного full bundle доступен LLM-вариант. Он использует тот же Node/Python/.deb контур и тот же installer, но дополнительно содержит проверенный runtime `llama-server` и выбранные оператором локальные GGUF.

```bash
npm run bundle:offline:llm -- \
  --llama-runtime /srv/kafedra/llama-runtime \
  --model qwen=/srv/models/model.gguf \
  --default-model qwen \
  --output release-llm
```

Модель не хранится в Git. Сборщик фиксирует её SHA-256 в `llm/manifest.json`, а installer размещает её content-addressed в `/var/lib/kafedra-planner/models`. Managed `llama-server` слушает только `127.0.0.1`; отсутствие LLM в обычном bundle не является ошибкой.

Полный порядок подготовки runtime, нескольких моделей, установки, переключения и отключения: [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md).
