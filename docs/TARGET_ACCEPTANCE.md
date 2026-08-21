# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический Ubuntu/Debian CI не закрывает целевую приёмку. Этот документ дополняет issue #27 и применяется на реальной Astra Linux/контрольной Debian тем же release bundle, который прошёл CI.

Для `0.1.0-rc.7` отдельно проверяется package contract `full-airgap-v2 / additive-only-v2`: Kafedra Planner не должен обновлять, понижать, удалять или автоматически исправлять уже установленные пакеты ОС.

## Каноническая установка

Оператор получает четыре файла:

```text
kafedra-planner-<version>-<profile>.tar.gz
kafedra-planner-<...>.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
```

На target используется **wrapper**, а не внутренний `deploy/install.sh`:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Внутренний `install.sh` находится внутри archive и вызывается wrapper автоматически; оператору распаковывать archive или запускать его вручную не требуется.

## Acceptance CLI

`scripts/target-acceptance.mjs` создаёт JSON evidence без содержимого документов и без секретов конфигурации. Он собирает:

- version/runtime/platform/arch/glibc и сведения ОС;
- full system preflight;
- Poppler/Tesseract/LibreOffice versions;
- SQLite `quick_check` и schema version;
- устойчивые table counts и logical digests;
- проверку каждого immutable blob по размеру/SHA-256;
- API/worker systemd status и hardening properties;
- сведения о последнем проверенном backup без секретов.

## Подготовить эталон на здоровой ОС

1. Убедиться, что до установки `dpkg --audit` пуст и `apt-get check` завершается успешно.
2. Установить bundle штатным wrapper.
3. Войти под созданным администратором.
4. Загрузить реалистичный набор PDF/DOCX/XLSX/сканов, распоряжений, отчётов, планов и научных материалов.
5. Проверить calendar/search/evidence/ACL/OCR/preview.
6. Дождаться завершения изменяющих jobs.
7. Создать **зашифрованный** backup и выполнить verify.
8. Снять acceptance evidence.

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-acceptance-before.json
```

`--require-full` делает блокирующими отсутствие OCR/Office/PDF capabilities, проблемы SQLite/blobs/systemd и отсутствие актуального проверенного зашифрованного backup. На здоровой поддерживаемой ОС degraded-режим не считается успешной полной приёмкой.

## Испытание безопасности при заранее конфликтном APT

Это испытание проводится **только на одноразовой копии/контрольной Astra**, где конфликт package database уже воспроизводится до запуска Kafedra Planner. Создавать искусственно повреждённое состояние на рабочем сервере запрещено.

1. До запуска installer зафиксировать состояние пакетов и доказать, что конфликт существовал заранее:

```bash
sudo dpkg --audit
sudo apt-get check
sudo dpkg-query -W -f='${Package}\t${Version}\t${db:Status-Abbrev}\n' \
  | LC_ALL=C sort > /root/packages-before.tsv
sha256sum /root/packages-before.tsv > /root/packages-before.tsv.sha256
```

2. Запустить **обычный release wrapper**. Рекомендуется сначала `auto`, затем при отдельном air-gap испытании `bundle`:

```bash
sudo ./install-kafedra-planner.sh
```

Ожидаемое поведение: installer видит красный `apt-get check`, не запускает package repair/upgrade/downgrade/remove, но продолжает установку приложения в degraded document mode.

3. Подтвердить рабочее ядро:

```bash
sudo KAFEDRA_DOCTOR_ALLOW_DEGRADED=true \
  /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl is-active kafedra-planner-api.service
systemctl is-active kafedra-planner-worker.service
```

Обычный строгий doctor должен оставаться красным, если OCR/Poppler/LibreOffice фактически отсутствуют. Это ожидаемая диагностика, а не основание объявить full-capability acceptance успешной.

4. Снять package state после установки и сравнить с исходным:

```bash
sudo dpkg-query -W -f='${Package}\t${Version}\t${db:Status-Abbrev}\n' \
  | LC_ALL=C sort > /root/packages-after.tsv
cmp /root/packages-before.tsv /root/packages-after.tsv
```

Критерий: до перехода к application deployment installer не изменил package version/status ни одного системного пакета. В журнале отсутствуют `--fix-broken`, downgrade и removal transactions.

5. Исправить package database **штатной утверждённой процедурой администратора ОС**, вне Kafedra Planner. После того как `apt-get check` станет зелёным, повторно запустить тот же release wrapper. Он должен добавить только отсутствующие document capabilities; затем обычный строгий doctor должен пройти.

Этот сценарий доказывает две независимые вещи: приложение не усугубляет чужую package-проблему и после восстановления ОС не требует переустановки/ручной правки своих данных.

## Restore test

1. Зафиксировать начало для измерения RTO.
2. Разрушить тестовую установку по плану испытания либо развернуть чистый контрольный узел.
3. Восстановить backup штатным CLI/процедурой из [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).
4. Запустить API/worker.
5. До новой операторской работы снять второй evidence.
6. Сравнить снимки.

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-acceptance-after.json

sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs compare \
  /root/kafedra-acceptance-before.json \
  /root/kafedra-acceptance-after.json \
  --output /root/kafedra-acceptance-compare.json
```

Критическим расхождением считаются изменение schema, устойчивого logical digest или immutable blob set, а также потеря исторических записей.

## Update/rollback test

На существующей установке:

1. снять `before` evidence;
2. запустить новый `install-kafedra-planner.sh`;
3. искусственно сорвать migration/post-update health-check контролируемым тестовым способом;
4. убедиться, что прежний release/data/systemd state восстановлены автоматически;
5. снять `after-rollback` evidence;
6. выполнить `compare` с исходным снимком.

Нельзя считать ручное редактирование symlink/SQLite успешным rollback.

## Optional LLM acceptance

Если организация использует LLM bundle, CI fixture недостаточен. На реальной Astra дополнительно:

1. собрать bundle с настоящим совместимым `llama-server` и реальной GGUF;
2. установить его тем же wrapper;
3. проверить:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/llm-doctor.mjs
systemctl status kafedra-planner-llama --no-pager -l
```

4. подтвердить `/health` и `/v1/models` через doctor;
5. повторно установить тот же bundle и убедиться, что model cache не дублируется;
6. отключить LLM и подтвердить, что API/worker и deterministic сценарии остаются рабочими;
7. отдельно проверить rollback при неуспешном старте managed LLM.

LLM acceptance является дополнительной проверкой и не превращает LLM в обязательную зависимость ядра.

## Что остаётся ручным

Автоматический JSON evidence не заменяет:

- визуальную корректность реального LibreOffice preview;
- качество OCR реальных ведомственных сканов;
- desktop/mobile UX без инструкции разработчика;
- фактический RTO;
- совместимость конкретной редакции Astra с embedded runtime;
- проверку vendor package revisions и package conflict safety;
- организационное подтверждение, что восстановленный сервис пригоден к работе.

Issue #27 закрывается только после фактического испытания и зафиксированного акта.
