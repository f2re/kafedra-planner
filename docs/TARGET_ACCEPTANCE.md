# Целевая эксплуатационная приёмка Astra Linux / Debian

Автоматический Ubuntu/Debian CI не закрывает целевую приёмку. Этот документ дополняет issue #27 и применяется на реальной Astra Linux/контрольной Debian тем же release bundle, который прошёл CI.

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

Существующий `scripts/target-acceptance.mjs` создаёт JSON evidence без содержимого документов и без секретов конфигурации. Он собирает:

- version/runtime/platform/arch/glibc и сведения ОС;
- full system preflight;
- Poppler/Tesseract/LibreOffice versions;
- SQLite `quick_check` и schema version;
- устойчивые table counts и logical digests;
- проверку каждого immutable blob по размеру/SHA-256;
- API/worker systemd status и hardening properties;
- сведения о последнем проверенном backup без секретов.

## Подготовить эталон

1. Установить bundle штатным wrapper.
2. Войти под созданным администратором.
3. Загрузить реалистичный набор PDF/DOCX/XLSX/сканов, распоряжений, отчётов, планов и научных материалов.
4. Проверить calendar/search/evidence/ACL/OCR/preview.
5. Дождаться завершения изменяющих jobs.
6. Создать **зашифрованный** backup и выполнить verify.
7. Снять acceptance evidence.

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/target-acceptance.mjs capture \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --require-full \
  --output /root/kafedra-acceptance-before.json
```

`--require-full` делает блокирующими отсутствие требуемых OCR/Office capabilities, проблемы SQLite/blobs/systemd и отсутствие актуального проверенного зашифрованного backup.

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
- организационное подтверждение, что восстановленный сервис пригоден к работе.

Issue #27 закрывается только после фактического испытания и зафиксированного акта.
