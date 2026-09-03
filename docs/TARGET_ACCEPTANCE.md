# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический GitHub CI проверяет код, миграции, browser-сценарии и поставочный bundle, но не заменяет испытание на реальной целевой ОС. Этот документ дополняет issue #27 и применяется к **Kafedra Planner 0.4.1, schema SQLite 31** на Astra Linux и контрольной Debian.

Проверяется тот же неизменяемый release bundle, который опубликован для exact tagged commit. Интернет, Docker, облачные сервисы и LLM не являются обязательными для основного функционала.

## Канонические release assets

Оператор получает ровно семь файлов:

```text
kafedra-planner-0.4.1-debian-12-amd64.tar.gz
kafedra-planner-0.4.1-debian-12-amd64.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
kafedra-planner-0.4.1-project-control.f2re.zip
kafedra-planner-0.4.1-project-control.f2re.zip.sha256
SHA256SUMS
```

До установки:

```bash
sha256sum -c --strict SHA256SUMS
sha256sum -c --strict kafedra-planner-0.4.1-debian-12-amd64.tar.gz.sha256
sha256sum -c --strict kafedra-planner-0.4.1-project-control.f2re.zip.sha256
```

Tag `v0.4.1` обязан указывать на exact commit выпуска. Имена, размеры и SHA-256 скачанных файлов должны совпадать с опубликованными release assets.

## Матрица испытаний

Минимально выполняются независимые сценарии:

1. чистая установка `0.4.1 / schema 31` на поддерживаемой Debian/Astra;
2. обновление существующей `0.4.0 / schema 31` до `0.4.1 / schema 31` без потери данных;
3. обновление контрольной копии `0.3.4 / schema 30` до `0.4.1 / schema 31` с применением migration `031`;
4. восстановление проверенного backup на чистом контрольном узле;
5. forced rollback после контролируемого сбоя migration или post-update health-check.

Отдельно на одноразовой машине проверяется конфликтный APT. Система не должна выполнять `apt --fix-broken`, upgrade, downgrade, remove или иное изменение уже установленных пакетов ОС.

## Чистая установка 0.4.1

До установки:

```bash
sudo dpkg --audit
sudo apt-get check
```

Установка выполняется внешним wrapper:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

После установки:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl is-active kafedra-planner-api.service
systemctl is-active kafedra-planner-worker.service
```

Обязательная функциональная проверка:

- первый вход позволяет задать четырёхзначный PIN; последующий вход требует только PIN;
- API и worker восстанавливаются после перезапуска systemd;
- загружаются PDF, DOCX, ODT, XLSX, ODS и сканы с русскими, смешанными, emoji и длинными именами;
- исходное имя, bytes, SHA-256 и `document_version` сохраняются без изменения;
- недоступность одного OCR/Office-адаптера не блокирует остальные документы, а полный bundle сообщает точную диагностику;
- план создаётся из загруженного документа и открывается именно созданный объект;
- на desktop от `721 px` доступен сегмент `Текущие | Архив`, до `720 px` сохраняется совместимый select;
- одна проблемная строка плана не блокирует остальные;
- действие `Выполнено` сразу синхронизирует задачу, календарь и `План / факт`;
- отчётный файл остаётся необязательным;
- поиск, заседания, научный реестр и учебные ведомости сохраняют переход к source/evidence.

После проверки создаётся и проверяется encrypted backup:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-0.4.1-clean.json
```

`--require-full` делает блокирующими проблемы SQLite/blobs/systemd, отсутствие актуального проверенного backup и отсутствие заявленных OCR/Office/PDF capabilities в полном bundle.

## Обновление 0.4.0 → 0.4.1

Перед обновлением существующая установка должна содержать документы и несколько версий, импортированный и ручной план, задачи, завершённые факты, архивный объект, заседание, научные материалы и ведомость.

Порядок:

1. создать и проверить encrypted backup;
2. снять `before` evidence и logical digest;
3. запустить wrapper `0.4.1`;
4. подтвердить, что schema остаётся `31` и применённые migrations не переписаны;
5. выполнить `PRAGMA quick_check` и `PRAGMA foreign_key_check`;
6. проверить сохранность blobs, SHA-256, `document_version`, source rows, evidence, ACL и истории;
7. снять `after` evidence и сравнить.

Недопустимы destructive reset, повторное создание существующих предметных объектов, потеря связей, изменение исторического источника или обязательное подключение к Интернету.

## Обновление 0.3.4 / schema 30 → 0.4.1 / schema 31

На копии реальной установки проверяются:

- автоматический backup до migration;
- одно последовательное применение `031`;
- безопасный повтор запуска migration;
- `quick_check` и `foreign_key_check` после обновления;
- одна текущая ведомость для пары `group + period`, сохранение предыдущих версий в истории;
- включение новых таблиц schema 31 в backup/restore и logical digest;
- отсутствие потери документов, планов, задач, заседаний, научных данных и связей Оформлятора.

## Restore и rollback

Restore выполняется по [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). До новой операторской работы сравниваются snapshots:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs compare \
  /root/kafedra-acceptance-before.json \
  /root/kafedra-acceptance-after.json \
  --output /root/kafedra-acceptance-compare.json
```

Forced-failure испытание должно доказать:

- новый release не активируется при failed migration или health-check;
- проверенный pre-update backup восстанавливается автоматически;
- прежняя версия API/worker снова активна;
- database, blobs и конфигурация не остаются в промежуточном состоянии;
- повторная безопасная установка после устранения причины завершается успешно.

## Offline package contract

`full-airgap-v2 / additive-only-v2` допускает установку только отсутствующих компонентов из bundle. Уже установленные пакеты ОС не обновляются, не понижаются и не удаляются. При несовместимом состоянии установка завершается до изменения системы с понятным журналом и инструкцией оператору.

`doctor.sh --repair` восстанавливает только отсутствующие поставочные компоненты из проверенного immutable cache. Он не скрывает повреждение ОС и не запускает сетевое исправление пакетов.

## Критерий завершения #27

Целевая приёмка считается успешной только при наличии подписанных evidence для чистой установки, обоих upgrade-маршрутов, restore и forced rollback. GitHub Release `v0.4.1` остаётся эксплуатационным release candidate до этого результата, но сам опубликованный patch release и его assets являются полноценными и устанавливаемыми.
