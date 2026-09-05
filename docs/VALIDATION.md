# Проверка изменений

Актуальный рубеж: `0.4.2`, SQLite schema **31**. CI доказывает только свойства, относящиеся к риску изменения; полный release/deployment regression не запускается на каждый feature PR.

## Обычный pull request

Автоматически выполняется один workflow `Проверка`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
```

Этого достаточно для обычных feature/API/docs/test изменений без storage, security, installer или release риска. Один и тот же unit/smoke набор не запускается повторно под другим именем или Node version только ради второго статуса.

Для UI-изменения дополнительно выполняется targeted Playwright затронутого сценария в рамках разработки/проверки изменения. Полная browser matrix не является обязательным PR gate.

## Дополнительные проверки по риску

| Изменение | Дополнительное доказательство |
| --- | --- |
| SQLite schema/storage/recovery | migration + clean install + base→HEAD upgrade + repeated migration + integrity + backup/restore |
| PIN/auth/ACL/security | targeted auth/ACL regression |
| installer/update/offline | full bundle + systemd install/update/rollback |
| release/CI infrastructure | GRACE contract/scope и релевантный release regression |
| обычный UI/API/docs/test | без полного GRACE/deployment gate |

GRACE запускается автоматически только для governed change, который меняет `.grace/**`. Его `database` job выполняет тяжёлую DB/recovery проверку только при соответствующем `M-*` в active spec. GRACE не опрашивает остальные GitHub Actions и не ждёт их завершения.

## Ручные диагностические workflows

`Оргструктура`, `Массовый импорт науки`, `Научный жизненный цикл` и `Научные отчёты` сохранены для `workflow_dispatch`. Они используются, когда нужно отдельно воспроизвести соответствующий browser/integration контур, но не запускаются автоматически на каждом PR или push в `main`.

## Release gate 0.4.2

Тяжёлый release gate не запускается на feature pull request. На `main` или при явном запуске он проверяет:

1. `release-quality` — check, unit/integration и smoke;
2. `release-migrations-backup` — release migration/recovery evidence;
3. `release-browser-desktop-mobile` — критические пользовательские сценарии desktop/mobile.

Failure, cancelled, pending, missing или неожиданно skipped не считаются успешным результатом.

## Full offline и systemd

Full offline bundle, systemd install/update/rollback, offline LLM/GGUF и Project Control относятся к поставке. Они запускаются перед release и при изменениях installer/update/offline, а не как часть обычного `Проверка`.

Release publisher должен использовать один собранный artifact: checksum → install → update → forced rollback → публикация того же artifact. Пересборка между verification и upload запрещена.

## Что остаётся ручным

Целевая эксплуатационная приёмка #27 остаётся отдельной:

- настоящая Astra Linux и контрольная Debian;
- vendor package revisions;
- реальные ведомственные документы;
- реальные права каталогов и systemd hardening;
- clean install, upgrade, restore и forced rollback;
- обновление сайта без stale cache;
- при наличии — настоящий Оформлятор и llama-server/GGUF.

## Перед merge

Проверяются exact PR head SHA, mergeability, актуальные review comments и только те checks, которые относятся к изменению. Для обычного PR обязательна `Проверка`; для governed risk PR дополнительно должен быть зелёным запустившийся `GRACE / gate`; для release/storage/security/deployment scope — соответствующий профильный gate.

После squash merge достаточно короткого post-merge smoke/обычного CI. Повторять весь PR regression без нового риска не требуется.
