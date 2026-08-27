# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический Ubuntu/Debian CI не закрывает целевую приёмку. Этот документ дополняет issue #27 и применяется к **Kafedra Planner 0.3.4, schema SQLite 30** на реальной Astra Linux и контрольной Debian тем же release bundle, который прошёл GitHub CI.

Отдельно проверяется package contract `full-airgap-v2 / additive-only-v2`: Kafedra Planner не должен обновлять, понижать, удалять или автоматически исправлять уже установленные пакеты ОС.

## Канонические release assets

Оператор получает:

```text
kafedra-planner-0.3.4-<profile>.tar.gz
kafedra-planner-0.3.4-<profile>.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
kafedra-planner-0.3.4-project-control.f2re.zip
kafedra-planner-0.3.4-project-control.f2re.zip.sha256
SHA256SUMS
```

До установки:

```bash
sha256sum -c --strict SHA256SUMS
sha256sum -c --strict kafedra-planner-0.3.4-*.tar.gz.sha256
```

На target используется внешний wrapper, а не внутренний `deploy/install.sh`:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Внутренний installer находится в archive и вызывается wrapper автоматически. Ручная распаковка для штатной установки не требуется.

## Матрица испытаний

Необходимо провести минимум четыре независимых сценария:

1. чистая установка `0.3.4` на поддерживаемой здоровой Debian/Astra;
2. обновление реальной копии `0.3.3 / schema 28` до `0.3.4 / schema 30`;
3. restore на чистый контрольный узел;
4. forced rollback после контролируемого сбоя миграции или post-update health-check.

Отдельно на одноразовой машине проводится испытание заранее конфликтного APT. LLM-приёмка проводится только если организация использует соответствующий bundle.

## Acceptance CLI

`scripts/target-acceptance.mjs` создаёт JSON evidence без содержимого документов и секретов. Он собирает:

- version/runtime/platform/arch/glibc и сведения ОС;
- full system preflight;
- Poppler/Tesseract/LibreOffice versions;
- SQLite `quick_check`, `foreign_key_check` и schema version;
- устойчивые table counts и logical digests;
- проверку каждого immutable blob по размеру и SHA-256;
- API/worker systemd status и hardening properties;
- сведения о последнем проверенном backup без секретов.

Schema 30 evidence обязан включать как минимум:

- организационные и научные устойчивые таблицы;
- `meeting_template_catalog`;
- `meeting_template_test_runs`;
- `docomator_field_mappings`;
- `docomator_person_fields`.

## Чистая установка 0.3.4

1. Подтвердить до установки:

```bash
sudo dpkg --audit
sudo apt-get check
```

2. Установить bundle штатным wrapper.
3. Проверить:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl is-active kafedra-planner-api.service
systemctl is-active kafedra-planner-worker.service
```

4. Открыть систему на desktop и mobile viewport.
5. Задать PIN из четырёх цифр; повторный вход должен требовать только PIN.
6. Проверить root-only reset PIN без удаления данных.
7. Загрузить реалистичный набор DOCX/PDF/XLSX/сканов, распоряжений, отчётов, планов и научных материалов.
8. Проверить поиск, календарь, evidence, ACL, OCR и LibreOffice preview.
9. Дождаться завершения фоновых jobs.
10. Создать зашифрованный backup, выполнить verify и снять acceptance evidence:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-0.3.4-clean.json
```

`--require-full` делает блокирующими отсутствие OCR/Office/PDF capabilities, проблемы SQLite/blobs/systemd и отсутствие актуального проверенного encrypted backup. На здоровой поддерживаемой ОС degraded mode не считается успешной полной приёмкой.

## Обновление 0.3.3 / schema 28 → 0.3.4 / schema 30

На копии реальной существующей установки до обновления должны присутствовать:

- документы и несколько immutable versions;
- импортированный и ручной план;
- исходные строки/ячейки и несколько задач из одной строки;
- поручение, отчёт и подтверждение;
- рабочий и архивный документ/план с логическим преемником;
- сотрудники, оргназначения и существующие связи Оформлятора;
- обычный marker-based шаблон заседаний и сформированный документ;
- научные материалы и `План / факт`.

Порядок:

1. создать и проверить encrypted backup;
2. снять `before` evidence;
3. запустить wrapper `0.3.4`;
4. подтвердить применение migration `029` и затем `030`;
5. убедиться, что schema version равна `30`;
6. проверить отсутствие потери или перепривязки исходных записей;
7. снять `after` evidence и сравнить.

Допустимы новые таблицы и новые предметные записи. Недопустимы:

- потеря document version/blob/SHA-256;
- изменение source/evidence существующего пункта;
- потеря поручения, отчёта или подтверждения;
- изменение calendar origin;
- потеря `docomator_person_links`;
- потеря существующих meeting settings или generated documents;
- нарушение `quick_check`/`foreign_key_check`.

## Приёмка визуального DOCX и библиотеки заседаний

Использовать реальный утверждённый протокол кафедры с таблицами, стилями и нумерацией.

1. Загрузить обычный DOCX без служебных маркеров.
2. Визуально назначить обязательные поля и повторяемые блоки.
3. Сохранить профиль и подтвердить состояние `Готов`.
4. Выполнить тестовое заполнение двумя вопросами.
5. Скачать DOCX, открыть его в LibreOffice и сравнить стили/нумерацию/таблицы с исходником.
6. При доступном LibreOffice проверить PDF-preview.
7. Временно сделать LibreOffice недоступным и убедиться, что тестовый DOCX всё равно создаётся и скачивается, а preview показывает понятную диагностику.
8. Создать заседание на версии 1.
9. Добавить версию 2 той же серии и сделать её основной.
10. Сформировать документ старого заседания и подтвердить использование версии 1.
11. Проверить impact версии 1, архивировать её, затем восстановить.
12. Убедиться, что исходник, профиль, заседание и generated document не удалены и не перепривязаны.

## Приёмка импорта полей Оформлятора

Проводится только при наличии реального локального Оформлятора.

1. Указать фактический host/port и проверить health/readiness/data.
2. При необходимости ввести код доступа и затем подтвердить, что он отсутствует в SQLite, env и audit log.
3. Выбрать пространство и группу.
4. Получить property definitions для `person`.
5. Назначить источник e-mail и должности, выбрать минимум два дополнительных поля.
6. Выполнить preview и импорт.
7. Проверить значения в локальном справочнике и `docomator_person_fields`.
8. Изменить remote e-mail/дополнительное значение и повторить импорт; новая локальная запись сотрудника не должна появиться.
9. Удалить либо переименовать выбранный remote property и повторить импорт; система должна остановиться с конфликтом **до** изменения локальных данных.
10. Вернуть схему и убедиться, что повторный импорт завершается успешно.
11. Отключить Оформлятор и проверить полную работоспособность локального справочника, планов, задач и отчётов.

## Приёмка планов и обучаемого UX

1. Импортировать реальный табличный план с неоднозначной датой и несколькими ответственными.
2. Подтвердить, что остальные строки materialize независимо от неоднозначной.
3. Разложить одну строку на две задачи с разными сроками и несколькими исполнителями.
4. Проверить точное автоматическое назначение и отсутствие назначения при неоднозначном ФИО.
5. Создать ручной пункт из календаря и проверить приоритет даты календаря/руководителя.
6. Явно изменить значения, сохранить и создать следующий пункт.
7. Подтвердить обученные defaults, отсутствие запоминания абсолютной даты и стабильность desktop/mobile геометрии.
8. Завершить поручение, загрузить отчёт, подтвердить и проверить `План / факт`.

## Restore test

1. Зафиксировать начало для измерения RTO.
2. Развернуть чистый контрольный узел либо разрушить тестовую установку по утверждённому плану.
3. Восстановить backup штатной процедурой из [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).
4. Запустить API/worker.
5. До новой операторской работы снять evidence.
6. Сравнить snapshots:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs compare \
  /root/kafedra-acceptance-before.json \
  /root/kafedra-acceptance-after.json \
  --output /root/kafedra-acceptance-compare.json
```

Критическим расхождением считаются изменение устойчивого logical digest, immutable blob set, потеря history/evidence или невозможность открыть/скачать исторические документы.

## Forced update/rollback

1. Снять `before` evidence существующей установки.
2. Запустить новый wrapper.
3. Контролируемо сорвать migration или post-update health-check.
4. Убедиться, что прежние release, symlink, database и systemd state восстановлены автоматически.
5. Снять `after-rollback` evidence и сравнить.
6. Повторить обновление без искусственного сбоя и подтвердить schema 30.

Ручное редактирование symlink/SQLite не считается успешным rollback.

## Испытание заранее конфликтного APT

Проводится только на одноразовой копии/контрольной Astra, где конфликт package database существовал до запуска Kafedra Planner. Создавать повреждение на рабочем сервере запрещено.

До установки:

```bash
sudo dpkg --audit
sudo apt-get check
sudo dpkg-query -W -f='${Package}\t${Version}\t${db:Status-Abbrev}\n' \
  | LC_ALL=C sort > /root/packages-before.tsv
```

Запустить обычный wrapper. Ожидаемое поведение:

- installer фиксирует красный `apt-get check`;
- не вызывает `--fix-broken`;
- не выполняет upgrade/downgrade/remove;
- устанавливает ядро приложения в degraded document mode;
- API/worker работают;
- строгий doctor остаётся красным до штатного исправления ОС.

После установки:

```bash
sudo dpkg-query -W -f='${Package}\t${Version}\t${db:Status-Abbrev}\n' \
  | LC_ALL=C sort > /root/packages-after.tsv
cmp /root/packages-before.tsv /root/packages-after.tsv
```

После исправления package database утверждённой процедурой администратора повторный запуск того же wrapper должен добавить только отсутствующие capabilities; строгий doctor должен пройти.

## Optional LLM acceptance

Если используется LLM bundle:

1. установить bundle с реальным совместимым `llama-server` и GGUF;
2. проверить `llm-doctor`, `/health`, `/v1/models` и systemd unit;
3. повторно установить bundle и убедиться, что model cache не дублируется;
4. отключить LLM и подтвердить работу API/worker и deterministic-сценариев;
5. проверить rollback при неуспешном старте managed LLM.

LLM acceptance не превращает LLM в обязательную зависимость ядра.

## Результат и закрытие issue #27

К акту должны быть приложены:

- точный release tag и commit SHA;
- `SHA256SUMS` и результаты проверки assets;
- сведения ОС и архитектуры;
- before/after/rollback acceptance JSON;
- логи installer/doctor/systemd без секретов;
- фактический RTO;
- результаты desktop/mobile и реальных документов;
- подтверждение отсутствия package mutation в конфликтном APT-сценарии;
- перечень известных ограничений.

Issue #27 закрывается только после фактического испытания и подписанного акта. Зелёный CI сам по себе stable не объявляет.
