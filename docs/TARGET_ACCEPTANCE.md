# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический GitHub CI проверяет код, migrations, browser-сценарии и поставочный bundle, но не заменяет испытание на реальной целевой ОС. Этот документ дополняет issue #27 и применяется к **Kafedra Planner 0.4.3, schema SQLite 31** на Astra Linux и контрольной Debian.

Проверяется тот же неизменяемый release bundle, который опубликован для exact tagged commit. Интернет, Docker, облачные сервисы, Оформлятор и LLM не являются обязательными для основного функционала.

## Канонические release assets

Оператор получает ровно семь файлов:

```text
kafedra-planner-0.4.3-debian-12-amd64.tar.gz
kafedra-planner-0.4.3-debian-12-amd64.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
kafedra-planner-0.4.3-project-control.f2re.zip
kafedra-planner-0.4.3-project-control.f2re.zip.sha256
SHA256SUMS
```

До установки:

```bash
sha256sum -c --strict SHA256SUMS
sha256sum -c --strict kafedra-planner-0.4.3-debian-12-amd64.tar.gz.sha256
sha256sum -c --strict kafedra-planner-0.4.3-project-control.f2re.zip.sha256
```

Tag `v0.4.3` обязан указывать на exact commit выпуска. Имена, размеры и SHA-256 скачанных файлов должны совпадать с опубликованными assets.

## Матрица испытаний

Минимально выполняются независимые сценарии:

1. чистая установка `0.4.3 / schema 31` на поддерживаемой Debian/Astra;
2. обновление существующей `0.4.2 / schema 31` до `0.4.3 / schema 31` без потери данных;
3. обновление контрольной копии `0.3.4 / schema 30` до `0.4.3 / schema 31` с применением migration `031`;
4. восстановление проверенного backup на чистом контрольном узле;
5. forced rollback после контролируемого сбоя migration, active UI verification или post-update health-check;
6. пакетная загрузка реальных протоколов за год с исправлением неоднозначностей;
7. прямое подключение к реальному Оформлятору по URL и по IP;
8. проверка обновления интерфейса без stale browser/proxy cache.

Отдельно на одноразовой машине проверяется конфликтный APT. Система не должна выполнять `apt --fix-broken`, upgrade, downgrade, remove или иное изменение уже установленных пакетов ОС.

## Чистая установка 0.4.3

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

Ожидается `0.4.3`, versioned release directory и активные API/worker.

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

## Протоколы за год

На реальном наборе протоколов кафедры:

1. открыть **Заседания** и выбрать календарный год;
2. одним действием выбрать не менее 20 DOCX/ODT/PDF/TXT файлов;
3. убедиться, что каждый исходник зарегистрирован до завершения обработки и один плохой файл не останавливает остальные;
4. дождаться пофайловой сводки `готово / проверить / ошибка / обрабатывается`;
5. перезагрузить страницу и убедиться, что сводка восстановилась из базы;
6. проверить корректно найденные номер, дату, повестку, `Слушали / Обсудили / Решили`, ответственного и срок;
7. для сомнительного протокола открыть `Исправить`, перейти к исходнику и скорректировать только ошибочные значения;
8. убедиться, что после правки обновились решение, календарный срок и поиск, а не связанные review-items остались открытыми;
9. убедиться, что raw extraction, locator/evidence, исходный blob, SHA-256 и `document_version` не изменились;
10. повторно загрузить тот же набор в тот же год и подтвердить отсутствие document/meeting duplicates;
11. загрузить протокол с датой другого года и подтвердить отдельный review вместо автоматической подмены даты;
12. загрузить скан/файл без текстового слоя и подтвердить сохранение исходника и возможность ручного восстановления карточки.

## Проверка интеграции с Оформлятором

На машине Planner проверяются URL, открываемый в браузере, и прямой IP. Порядок: вставить один адрес, `Подключить`, подтвердить `/healthz`/`/readyz`, при необходимости ввести четырёхзначный код, выбрать пространство/группу/поля, проверить preview, импортировать, повторить без дублей и воспроизвести partial success. При отключённом Оформляторе локальный справочник и остальные функции продолжают работать.

Отдельно воспроизводятся DNS, refused port, timeout, TLS, wrong service, not-ready, denied code и incompatible protocol. Сообщения не должны содержать code/cookie/stack/raw body.

## Проверка обновления 0.4.2 → 0.4.3

Перед обновлением установка должна содержать документы и версии, импортированный и ручной план, задачи, завершённые факты, архивный объект, заседания, научные материалы, ведомость, оргструктуру, настроенную интеграцию Оформлятора и данные протоколов `0.4.2`.

Порядок:

1. создать и проверить encrypted backup;
2. снять `before` evidence и logical digest;
3. поместить files `0.4.3` в обычный user-owned каталог;
4. запустить wrapper;
5. подтвердить, что source directory ownership не изменился;
6. подтвердить `VERSION=0.4.3`, schema `31` и неизменность applied migrations;
7. выполнить `PRAGMA quick_check` и `PRAGMA foreign_key_check`;
8. сравнить blobs, SHA-256, `document_version`, source rows, evidence, PIN, ACL и историю;
9. проверить новый годовой импорт протоколов и active UI files;
10. открыть сайт в браузере, ранее использовавшем `0.4.2`, без очистки cache вручную и убедиться, что показан новый интерфейс;
11. снять `after` evidence и сравнить.

## Обновление 0.3.4 / schema 30 → 0.4.3 / schema 31

Проверяются автоматический backup, одно последовательное применение `031`, безопасный повтор migration runner, `quick_check`, `foreign_key_check`, сохранение всех устойчивых таблиц/связей и корректный новый UI. Никакая migration специально для `0.4.3` не добавляется.

## Restore и forced rollback

Restore выполняется по [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). Forced failure должен доказать:

- новый release не активируется при failed migration, обязательном UI-file mismatch или health-check;
- verified pre-update backup восстанавливается автоматически;
- прежняя версия API/worker снова активна;
- database, blobs, configuration и PIN не остаются в промежуточном состоянии;
- исходный user-owned release directory не меняется.

Release CI дополнительно воспроизводит `forced-core-rollback`: после переключения нового immutable release намеренно повреждается обязательный static file; post-update verification обязана отклонить release и вернуть предыдущий `current`, PIN/data и работающие API/worker.

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

Целевая приёмка считается успешной только при наличии подписанных evidence для чистой установки, обоих upgrade-маршрутов, годового набора реальных протоколов, реального Оформлятора, stale-cache проверки, restore и forced rollback. GitHub Release `v0.4.3` остаётся эксплуатационным release candidate до этого результата, но опубликованный patch release и его assets должны быть полноценными и устанавливаемыми.
