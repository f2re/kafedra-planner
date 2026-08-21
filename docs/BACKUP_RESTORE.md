# Резервное копирование и восстановление

Документ описывает текущий `0.1.0-rc.6` контур backup/restore. Для установленной Astra/Debian используйте embedded Node; `npm run ...` ниже относится только к source checkout.

## Что входит в стандартную копию

- согласованный SQLite snapshot через SQLite Backup API;
- immutable `blobs`;
- конфигурация, если она передана;
- application release, если включён соответствующий режим;
- manifest с версией приложения, schema version, размерами и SHA-256 файлов.

После создания архив сразу проверяется. Успешная операция записывается в `backup-journal.jsonl`, а краткое состояние — в `latest-success.json`.

GGUF-модели из `/var/lib/kafedra-planner/models` **не дублируются** в стандартный backup: это воспроизводимый deployment asset. Для disaster recovery храните исходный LLM release bundle рядом с резервными копиями.

## Штатное обновление

Для обычного обновления не запускайте backup/migration вручную. Используйте release wrapper:

```bash
sudo ./install-kafedra-planner.sh
```

Installer сам:

1. проверяет archive/manifest/runtime;
2. создаёт и проверяет pre-update backup существующей установки;
3. переключает versioned release атомарно;
4. выполняет migration;
5. запускает API/worker и optional managed LLM;
6. выполняет health/doctor;
7. при ошибке приложения восстанавливает прежний release/data/systemd state;
8. сохраняет content-addressed model cache при автоматическом rollback.

## Команды в source checkout

```bash
npm run backup:create
npm run backup:verify -- /path/to/archive
npm run backup:restore -- /path/to/archive --target-data-dir /tmp/kafedra-restore-check
npm run backup:selftest
```

Эти команды удобны для разработки/CI, но npm не является частью production target.

## Создание backup на установленной системе

Без шифрования:

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/backup-create.mjs \
  --database /var/lib/kafedra-planner/kafedra-planner.sqlite3 \
  --data-dir /var/lib/kafedra-planner \
  --blob-dir /var/lib/kafedra-planner/blobs \
  --config /etc/kafedra-planner/kafedra-planner.env \
  --application-dir /opt/kafedra-planner/current \
  --output-dir /var/backups/kafedra-planner \
  --reason manual-before-maintenance
```

Для зашифрованного backup добавьте:

```text
--key-file /root/kafedra-backup.key
```

Key-file должен содержать не менее 16 случайных байт и оставаться root-only. Зашифрованный архив использует AES-256-GCM и расширение `.kpb`.

## Проверка архива

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/backup-verify.mjs \
  /var/backups/kafedra-planner/<archive>.kpb \
  --key-file /root/kafedra-backup.key
```

Проверяются безопасные tar paths, manifest, размеры/SHA-256 и SQLite `quick_check`.

## Dry-run восстановления

```bash
sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/backup-restore.mjs \
  /path/to/archive.kpb \
  --key-file /root/kafedra-backup.key \
  --target-data-dir /tmp/kafedra-restore-check
```

Без `--apply` рабочая установка не заменяется.

## Фактическое ручное восстановление

Предпочтительный disaster-recovery сценарий описан в [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md). Если требуется прямой restore CLI:

```bash
sudo systemctl stop kafedra-planner-llama.service 2>/dev/null || true
sudo systemctl stop kafedra-planner-api kafedra-planner-worker

sudo /opt/kafedra-planner/current/runtime/node/bin/node \
  /opt/kafedra-planner/current/scripts/backup-restore.mjs \
  /path/to/archive.kpb \
  --key-file /root/kafedra-backup.key \
  --target-data-dir /var/lib/kafedra-planner \
  --target-config /etc/kafedra-planner/kafedra-planner.env \
  --target-application-dir /opt/kafedra-planner/releases/restored \
  --apply --force

sudo chown -R kafedra-planner:kafedra-planner /var/lib/kafedra-planner
sudo systemctl start kafedra-planner-api kafedra-planner-worker
```

Старый data/application target сохраняется с суффиксом `.before-restore-<timestamp>` как точка ручного возврата.

### Если использовался managed llama.cpp

После полного restore data-dir model cache может отсутствовать, потому что GGUF не входит в backup. Не копируйте модель вручную из случайного источника. Повторно запустите **тот же проверенный LLM release bundle**:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Installer сверит SHA-256 и восстановит content-addressed models/runtime/config. До этого основной API/worker может работать с LLM отключённым.

## Прямой `migrate`

Source-команда `npm run migrate` и соответствующий installed script автоматически создают backup SQLite перед pending migrations, если `KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION` не отключён явно. Это дополнительная защита; для production update канонический путь всё равно `install-kafedra-planner.sh`.

## Acceptance после restore

После восстановления выполните:

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Для доказательства сохранности используйте `scripts/target-acceptance.mjs capture/compare` по процедуре [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md).
