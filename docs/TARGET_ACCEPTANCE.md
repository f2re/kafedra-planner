# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический GitHub CI проверяет код, migrations, browser-сценарии и поставочный bundle, но не заменяет испытание на реальной целевой ОС. Этот документ дополняет issue #27 и применяется к **Kafedra Planner 0.4.2, schema SQLite 31** на Astra Linux и контрольной Debian.

Проверяется тот же неизменяемый release bundle, который опубликован для exact tagged commit. Интернет, Docker, облачные сервисы, Оформлятор и LLM не являются обязательными для основного функционала.

## Канонические release assets

Оператор получает ровно семь файлов:

```text
kafedra-planner-0.4.2-debian-12-amd64.tar.gz
kafedra-planner-0.4.2-debian-12-amd64.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
kafedra-planner-0.4.2-project-control.f2re.zip
kafedra-planner-0.4.2-project-control.f2re.zip.sha256
SHA256SUMS
```

До установки:

```bash
sha256sum -c --strict SHA256SUMS
sha256sum -c --strict kafedra-planner-0.4.2-debian-12-amd64.tar.gz.sha256
sha256sum -c --strict kafedra-planner-0.4.2-project-control.f2re.zip.sha256
```

Tag `v0.4.2` обязан указывать на exact commit выпуска. Имена, размеры и SHA-256 скачанных файлов должны совпадать с опубликованными assets.

## Матрица испытаний

Минимально выполняются независимые сценарии:

1. чистая установка `0.4.2 / schema 31` на поддерживаемой Debian/Astra;
2. обновление существующей `0.4.1 / schema 31` до `0.4.2 / schema 31` без потери данных;
3. обновление контрольной копии `0.3.4 / schema 30` до `0.4.2 / schema 31` с применением migration `031`;
4. восстановление проверенного backup на чистом контрольном узле;
5. forced rollback после контролируемого сбоя migration, active UI verification или post-update health-check;
6. прямое подключение к реальному Оформлятору по URL и по IP;
7. проверка обновления интерфейса без stale browser/proxy cache.

Отдельно на одноразовой машине проверяется конфликтный APT. Система не должна выполнять `apt --fix-broken`, upgrade, downgrade, remove или иное изменение уже установленных пакетов ОС.

## Чистая установка 0.4.2

До установки:

```bash
sudo dpkg --audit
sudo apt-get check
```

Release files размещаются в обычной папке пользователя. Владелец папки и архива не меняется. Установка:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Wrapper обязан:

- проверить внешний digest до распаковки;
- проверить безопасные пути архива;
- извлечь содержимое в приватный root staging с `--no-same-owner --no-same-permissions`;
- не выполнять `chown` исходной пользовательской папки;
- оставить installed release `root:root` и non-writable для service user;
- оставить рабочие данные `kafedra-planner:kafedra-planner`;
- создать и проверить backup до изменяющего обновления;
- атомарно переключить `/opt/kafedra-planner/current`;
- проверить health и обязательные active UI files.

После установки:

```bash
cat /opt/kafedra-planner/current/VERSION
readlink -f /opt/kafedra-planner/current
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl is-active kafedra-planner-api.service
systemctl is-active kafedra-planner-worker.service
```

Ожидается `0.4.2`, versioned release directory и активные API/worker.

## Функциональная проверка

Обязательно проверить:

- первый вход позволяет задать четырёхзначный PIN; последующий вход требует только PIN;
- API и worker восстанавливаются после перезапуска systemd;
- загружаются PDF, DOCX, ODT, XLSX, ODS и сканы с русскими, смешанными, emoji и длинными именами;
- исходное имя, bytes, SHA-256 и `document_version` сохраняются;
- недоступность OCR/Office-адаптера не блокирует остальные документы;
- план создаётся из загруженного документа и открывается именно созданный объект;
- одна проблемная строка плана не блокирует остальные;
- `Выполнено` синхронизирует задачу, календарь и `План / факт`;
- отчётный файл остаётся необязательным;
- поиск, заседания, наука и учебные ведомости ведут к source/evidence;
- на desktop/mobile доступен один и тот же предметный сценарий.

## Проверка интеграции с Оформлятором

На машине Planner должны быть проверены два маршрута:

1. URL, открываемый в браузере, например `http://docomator.local:8080/api/v1`;
2. прямой IP, например `http://192.168.1.50:8080`.

Порядок:

1. открыть **Настройки → Структура кафедры → Импорт из Оформлятора**;
2. вставить один полный адрес без ручного выделения protocol/port/API version;
3. нажать **Подключить**;
4. подтвердить `/healthz` и `/readyz` с актуальным `status: ok`;
5. при необходимости ввести четырёхзначный код;
6. выбрать пространство, группу и поля;
7. проверить количество и preview ФИО;
8. импортировать;
9. повторить импорт и убедиться, что дубли не созданы;
10. искусственно сломать один remote profile и подтвердить partial success;
11. отключить Оформлятор и убедиться, что локальный справочник и остальные функции работают.

Отдельно воспроизводятся DNS, refused port, timeout, TLS, wrong service, not-ready, denied code и incompatible protocol. Сообщения не должны содержать code/cookie/stack/raw body.

## Проверка обновления 0.4.1 → 0.4.2

Перед обновлением установка должна содержать документы и версии, импортированный и ручной план, задачи, завершённые факты, архивный объект, заседание, научные материалы, ведомость, оргструктуру и настроенную интеграцию Оформлятора.

Порядок:

1. создать и проверить encrypted backup;
2. снять `before` evidence и logical digest;
3. поместить files `0.4.2` в обычный user-owned каталог;
4. запустить wrapper;
5. подтвердить, что source directory ownership не изменился;
6. подтвердить `VERSION=0.4.2`, schema `31` и неизменность applied migrations;
7. выполнить `PRAGMA quick_check` и `PRAGMA foreign_key_check`;
8. сравнить blobs, SHA-256, `document_version`, source rows, evidence, PIN, ACL и историю;
9. проверить active UI files и новый экран одного URL;
10. открыть сайт в браузере, ранее использовавшем `0.4.1`, без очистки cache вручную и убедиться, что показан новый интерфейс;
11. снять `after` evidence и сравнить.

Повторная установка того же `0.4.1` не считается обновлением: immutable bundle не содержит изменений `0.4.2`.

## Обновление 0.3.4 / schema 30 → 0.4.2 / schema 31

Проверяются:

- автоматический backup до migration;
- одно последовательное применение `031`;
- безопасный повтор migration runner;
- `quick_check` и `foreign_key_check`;
- одна текущая ведомость для `group + period` и сохранение предыдущих версий;
- включение schema 31 tables в backup/restore и logical digest;
- отсутствие потери документов, планов, задач, заседаний, науки и связей Оформлятора;
- корректный новый UI и static `no-store` после upgrade.

## Restore и forced rollback

Restore выполняется по [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). Forced failure должен доказать:

- новый release не активируется при failed migration, UI-file mismatch или health-check;
- verified pre-update backup восстанавливается автоматически;
- прежняя версия API/worker снова активна;
- database, blobs, configuration и PIN не остаются в промежуточном состоянии;
- исходный user-owned release directory не меняется;
- повторная безопасная установка после устранения причины завершается успешно.

Команда сравнения evidence:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs compare \
  /root/kafedra-acceptance-before.json \
  /root/kafedra-acceptance-after.json \
  --output /root/kafedra-acceptance-compare.json
```

## Перезапуск и журнал

```bash
sudo systemctl restart kafedra-planner-api.service kafedra-planner-worker.service
sudo systemctl status --no-pager -l kafedra-planner-api.service kafedra-planner-worker.service
sudo journalctl -u kafedra-planner-api.service -u kafedra-planner-worker.service -n 100 --no-pager
```

LLM-служба проверяется и перезапускается отдельно только для LLM-варианта bundle.

## Offline package contract

`full-airgap-v2 / additive-only-v2` допускает установку только отсутствующих компонентов из bundle. Уже установленные packages не обновляются, не понижаются и не удаляются. `doctor.sh --repair` восстанавливает только отсутствующие поставочные компоненты из verified immutable cache и не запускает сетевое исправление packages.

## Критерий завершения #27

Целевая приёмка считается успешной только при наличии подписанных evidence для чистой установки, обоих upgrade-маршрутов, реального Оформлятора, stale-cache проверки, restore и forced rollback. GitHub Release `v0.4.2` остаётся эксплуатационным release candidate до этого результата, но опубликованный patch release и его assets должны быть полноценными и устанавливаемыми.
