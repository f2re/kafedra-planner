# Полная автономная поставка Kafedra Planner

## Нормальный сценарий

GitHub Release содержит отдельный full bundle для каждой поддерживаемой серии ОС: Debian 12, Astra Linux 1.7 и Astra Linux 1.8 на `amd64`. Скачайте archive своей ОС, соседний `.sha256`, `install-kafedra-planner.sh` и `README-INSTALL.txt` в один каталог.

Проверить автоматический выбор без изменения системы:

```bash
./install-kafedra-planner.sh --print-selection
```

Установить или обновить:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Интернет на target не требуется. `npm install`, `pip install`, Docker и системный Python для приложения не нужны.

## Что входит в full bundle

- приложение, миграции, static UI и systemd units;
- закреплённый Node.js 24 LTS;
- managed CPython для локального OCR orchestration;
- полное air-gap `.deb`-замыкание document capabilities;
- Tesseract и языки `rus`/`eng`;
- Poppler (`pdftotext`, `pdftoppm`);
- LibreOffice Writer/Calc/Core и базовые шрифты;
- `release.json`, `deployment.json`, внутренний manifest и внешний SHA-256.

Пакеты распознавания не скачиваются после установки и не зависят от доступности внешнего репозитория на рабочей машине.

## Target profile и совместимость

`.deb`-слой нельзя переносить между Debian 12, Astra 1.7 и Astra 1.8. Внутренний `os-packages/source-os.env` фиксирует family, `ID`, `VERSION_ID`, architecture и package contract.

Общий wrapper, если рядом лежит несколько архивов, читает только эти встроенные метаданные и выбирает ровно один совместимый archive. Для Astra уровни обновления одной серии нормализуются: `1.7.x` относится к серии `1.7`, `1.8.x` — к `1.8`.

Если совместимого archive нет или найдено несколько подходящих, wrapper завершает работу до package transaction, остановки служб, миграций SQLite и переключения `/opt/kafedra-planner/current`. Явно указанный несовместимый archive дополнительно отклоняется внутренним installer по target profile.

## Package contract v2

Package layer имеет два обязательных признака:

```text
DEPENDENCY_CLOSURE=full-airgap-v2
TARGET_INSTALL_POLICY=additive-only-v2
```

`full-airgap-v2` означает, что на matching build/reference-машине вычислено полное dependency closure для отсутствующих системных компонентов.

`additive-only-v2` означает, что target installer может только доустановить отсутствующие пакеты. Он не имеет права обновлять, понижать или удалять уже установленный пакет ОС.

Версии в `packages.tsv` — inventory/evidence содержимого bundle, а не target pinning. Команды вида `package=version`, `--allow-downgrades` и автоматический `apt --fix-broken` запрещены.

## Что делает installer

Перед системной package transaction выполняются:

```text
dpkg --audit
apt-get check
```

Затем installer определяет реально отсутствующие возможности:

- `unzip`;
- `pdftotext`/`pdftoppm` → `poppler-utils`;
- Tesseract и языки `rus`/`eng`;
- LibreOffice Writer/Calc/Core и шрифты.

В `KAFEDRA_APT_MODE=bundle` установка выполняется только из локального package payload соответствующей ОС. Политика APT остаётся additive-only: без upgrade, downgrade и remove.

Если package database target была конфликтной ещё до запуска (`dpkg --audit`/`apt-get check`), installer не пытается автоматически чинить чужое состояние системы. Он не запускает `apt --fix-broken` и не подменяет установленные vendor revisions.

## Строгая активация OCR/PDF/Office

Full bundle является обещанием полноценного document runtime. До переключения `current` installer обязан подтвердить:

- `pdftotext` и `pdftoppm`;
- Tesseract с языками `rus` и `eng`;
- LibreOffice;
- managed Python;
- `smoke_pdf` и `smoke_tesseract`;
- `scripts/recognition/ocr.py doctor --languages rus+eng --self-test`.

Если любой обязательный компонент не работает, новый full release не активируется. Предыдущий release, SQLite, source/evidence, конфигурация и PIN остаются без изменений.

Проверка установленной системы:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

## Сохранение пакетов и автономный repair

После успешного strict preflight проверенный package payload копируется в installer-owned immutable cache:

```text
/var/cache/kafedra-planner/os-packages/<target-profile>/<manifest-sha256>/
```

Установленный release хранит проверенный указатель на cache. Исходную флешку или каталог установки после успешной установки можно убрать.

Восстановление отсутствующих document capabilities:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh --repair
```

`--repair` сначала проверяет digest и target profile сохранённого cache, затем выполняет только допустимую additive-only установку отсутствующих компонентов и повторяет строгий doctor. Повреждённый, изменённый или чужой по профилю cache отклоняется.

## Данные и update

Стандартные пути:

```text
приложение: /opt/kafedra-planner/current
данные:     /var/lib/kafedra-planner
SQLite:     /var/lib/kafedra-planner/kafedra-planner.sqlite3
backup:     /var/backups/kafedra-planner
config:     /etc/kafedra-planner/kafedra-planner.env
```

Повторный запуск wrapper — штатный update. До изменяющего обновления создаётся и проверяется backup; release подготавливается через staging и атомарное переключение `current`; при ошибке приложения внешний transaction wrapper возвращает предыдущий release/data state.

Package deployment имеет один стандартный контур данных. Нестандартный `KAFEDRA_DATABASE_PATH` не угадывается и должен остановить update до остановки работающих служб и миграций.

## Локальная сборка

Если нужен диагностический или внутренний bundle, его следует собирать только на reference Debian/Astra той же серии и architecture, что target:

```bash
npm run bundle:offline
```

`build-full-bundle.sh` записывает фактический профиль build OS в `source-os.env`; подмена family/series вручную не допускается.

## GitHub Release и Astra

Release/GRACE риск-контур из одного exact SHA строит и проверяет три target archive:

```text
Debian 12 amd64
Astra Linux 1.7 amd64
Astra Linux 1.8 amd64
```

Для Astra используются официальные matching Astra Linux UBI reference images. Они применяются только внутри CI/release для сборки и проверки; production Docker не требует.

Каждый archive затем устанавливается на matching reference target с отключённой сетью через тот же штатный wrapper. Проверяются systemd, API/worker, strict OCR/Poppler/LibreOffice doctor, повторная установка/update и автономный `doctor.sh --repair` после удаления исходного `/installer`.

Только прошедший этот контур archive может попасть в GitHub Release; заново собирать artifact после acceptance нельзя.

Контейнерная reference-проверка не заменяет эксплуатационную приёмку на реальной Astra Linux с фактическими ведомственными vendor revisions, реальными документами и сценариями update/rollback. Она выполняется по [TARGET_ACCEPTANCE.md](TARGET_ACCEPTANCE.md).

## Дополнительные режимы

`KAFEDRA_APT_MODE=auto` разрешён для диагностических/локальных сценариев и может использовать системные sources до перехода к локальному payload. Каноническая автономная установка выпуска использует `KAFEDRA_APT_MODE=bundle`.

Режим `KAFEDRA_DOCTOR_ALLOW_DEGRADED=true` предназначен только для явной диагностики ядра приложения на уже повреждённой машине. Он не используется как замена strict full-bundle acceptance и не может сделать неполный release публикуемым.
