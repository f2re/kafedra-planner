# Резервное копирование и восстановление

Версия контура: `0.1.0-rc.2`.

## Что входит в копию

Каждый архив содержит согласованный снимок:

- SQLite-базы через SQLite Backup API;
- каталога `blobs`;
- файла конфигурации, если он указан;
- установленной версии приложения, если не отключён этот режим;
- манифеста с версией приложения, схемой БД, размерами и SHA-256 каждого файла.

Архив проверяется сразу после создания. Успешная копия записывается в
`backup-journal.jsonl`, а краткие сведения — в `latest-success.json`.

## Создание

```bash
npm run backup:create
```

Полезные параметры:

```bash
npm run backup:create -- --reason manual-before-maintenance
npm run backup:create -- --output-dir /mnt/nas/kafedra --keep 30
sudo npm run backup:create -- --key-file /root/kafedra-backup.key
```

Ключевой файл должен содержать не менее 16 случайных байт. Если ключ доступен
только `root`, создание и восстановление запускаются от `root`; штатный
`deploy/install.sh` именно так и работает. Сам API ключ шифрования не читает. При наличии ключа
архив шифруется AES-256-GCM и получает расширение `.kpb`.

## Проверка

```bash
npm run backup:verify -- /var/backups/kafedra-planner/<archive>
npm run backup:verify -- /var/backups/kafedra-planner/<archive>.kpb \
  --key-file /root/kafedra-backup.key
```

Проверяются безопасные пути tar, SHA-256 всех файлов, SQLite `quick_check` и
версия схемы.

## Dry-run восстановления

Без `--apply` данные не заменяются:

```bash
npm run backup:restore -- /path/to/archive \
  --target-data-dir /tmp/kafedra-restore-check
```

## Фактическое восстановление

Сервисы должны быть остановлены. Замена существующих данных требует одновременно
`--apply` и `--force`:

```bash
systemctl stop kafedra-planner-api kafedra-planner-worker
npm run backup:restore -- /path/to/archive \
  --target-data-dir /var/lib/kafedra-planner \
  --target-config /etc/kafedra-planner/kafedra-planner.env \
  --target-application-dir /opt/kafedra-planner/releases/restored \
  --apply --force
chown -R kafedra-planner:kafedra-planner /var/lib/kafedra-planner
systemctl start kafedra-planner-api kafedra-planner-worker
```

Старые каталоги и файлы не удаляются немедленно. Они получают суффикс
`.before-restore-<timestamp>` и остаются точкой ручного возврата.

## Безопасное обновление

`deploy/install.sh` теперь:

1. останавливает API и worker;
2. создаёт и проверяет резервную копию текущей установки;
3. переключает symlink на новую версию;
4. выполняет миграции;
5. запускает сервисы и health-check;
6. при любой ошибке восстанавливает данные и прежний symlink автоматически.

Прямой запуск `npm run migrate` также создаёт копию при наличии новых миграций.
При ошибке он восстанавливает только SQLite-файл внутри доступного каталога данных,
поэтому откат работает и от имени системного пользователя `kafedra-planner`.
Отключить это можно только явно: `KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION=false`.

## Ротация и диагностика

`KAFEDRA_BACKUP_KEEP` задаёт число сохраняемых архивов. Административная
диагностика предупреждает, если последняя проверенная копия старше
`KAFEDRA_BACKUP_MAX_AGE_HOURS` или отсутствует.
