# Аудит полного offline deployment

Дата первоначального контура: 2026-08-11. Актуальный package contract: **`full-airgap-v2 / additive-only-v2`**, release candidate `0.1.0-rc.7`.

## Почему потребовался v2

Реальная Astra-проверка `rc.6` показала `Unmet dependencies` одновременно в штатном APT и bundled `file:` repository. Лог содержал уже установленные несовместимые пары `perl/perl-base`, `libc6-dev/libc6`, `acl/libacl1`, `attr/libattr1`, `libparsec-*` и vendor revisions Astra.

Важное различие: оба пути `rc.6` завершились на APT simulation, поэтому Kafedra Planner не создал этот конфликт. Ошибка поставки была другой:

- installer проверял только `dpkg --audit`, который не обнаруживает весь класс dependency conflicts;
- при отсутствии любой полной возможности запрашивался весь OCR/PDF/Office profile;
- OCR/LibreOffice делались блокирующим условием установки приложения;
- package contract недостаточно явно отделял полный build-time closure от политики target install.

## Контракт v2

Build/reference слой:

```text
dpkg --audit
apt-get check
        ↓
полное air-gap dependency closure
        ↓
DEPENDENCY_CLOSURE=full-airgap-v2
TARGET_INSTALL_POLICY=additive-only-v2
REFERENCE_APT_CHECK=passed
```

Пустой synthetic `Dir::State::status` остаётся только в collector. Он нужен, чтобы materialize полный closure для чистой отключённой ОС. Он не переносится в APT target и не означает version pinning.

Target слой:

```text
определить отсутствующие capabilities
        ↓
dpkg --audit + apt-get check
        ↓
simulation --no-remove --no-upgrade
        ↓
проверка: нет Remv и нет замены установленной версии
        ↓
download-only
        ↓
одна изменяющая install-транзакция
```

Bundled fallback разрешён только до первой изменяющей транзакции и проходит тот же simulation guard.

## Что считается document capability

В application package profile остаются только:

- `unzip`;
- Poppler;
- Tesseract и `rus`/`eng`;
- LibreOffice Writer/Calc/Core;
- fontconfig/DejaVu.

Systemd, coreutils, util-linux, passwd, tar, libc/perl и другие базовые компоненты ОС не являются top-level application requirements.

Target installer запрашивает не весь список, а только пакеты, соответствующие фактически отсутствующей команде/языку. Это уменьшает поверхность APT resolver и исключает бессмысленную переустановку уже работающих компонентов.

## Граница безопасности

До изменения dpkg любой из этих случаев считается безопасным degraded result:

- target `apt-get check` уже красный;
- system repository не может построить additive plan;
- bundled repository несовместим с установленными vendor revisions;
- simulation пытается обновить/понизить/удалить установленный package.

В этих случаях package database не меняется, а installer продолжает deployment API/worker.

После начала реальной package-транзакции ошибка считается фатальной. Fallback и `--fix-broken` поверх частично изменённой ОС не выполняются.

## Strict и degraded режимы

Platform prerequisites (`tar`, `sha256sum`, `systemctl`, `runuser`, `useradd`) остаются блокирующими.

`unzip`, `pdftotext`, OCR и office preview представлены как capabilities. Installer может запустить ядро без них только после безопасной non-mutating package failure. При этом:

- исходные файлы продолжают сохраняться;
- календарь/задачи/поручения/БД работают;
- preflight явно показывает недоступные document functions;
- `KAFEDRA_DOCTOR_ALLOW_DEGRADED=true` проверяет рабочее ядро.

Обычный `scripts/offline/doctor.sh` остаётся строгим full-capability gate. Clean CI никогда не использует degraded doctor как замену полного acceptance.

## Сборка cache

По умолчанию:

```bash
npm run bundle:offline
```

С обновлением indexes:

```bash
sudo npm run bundle:offline -- --apt-update
```

Явный reuse:

```bash
npm run bundle:offline -- --reuse-os-packages
```

`verify_os_package_set` отклоняет cache старого формата, cache другой ОС/архитектуры, изменённый inventory и package layer без `REFERENCE_APT_CHECK=passed`.

## CI acceptance

Debian 12 gate обязан доказать одновременно:

- package metadata v2;
- отсутствие `package=version`, `--allow-downgrades` и `--fix-broken`;
- simulation guard для upgrade/remove;
- обычный system APT check-only path;
- настоящий bundled air-gap install;
- строгий `system-preflight --require-full`;
- Tesseract `rus+eng`, Poppler и LibreOffice;
- настоящий systemd install/update flow;
- optional llama.cpp/GGUF packaging flow.

Docker используется только как disposable CI/reference environment и не является runtime-зависимостью продукта.

## Что CI не доказывает

Реальная Astra-приёмка #27 остаётся обязательной. На ней нужно повторить `rc.7` как минимум в двух состояниях:

1. здоровая обновлённая Astra — document packages ставятся/уже присутствуют, strict doctor зелёный;
2. копия системы с заранее воспроизводимым dependency conflict — `apt-get check` красный до установки, package database после запуска installer побайтно/по dpkg state не меняется, API/worker устанавливаются и degraded doctor зелёный.

После исправления самой ОС повторный запуск того же installer должен автоматически добрать отсутствующие document capabilities и вернуть strict doctor в зелёное состояние.
