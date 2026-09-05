# Проверка изменений

Актуальный рубеж: `0.4.3`, SQLite schema **31**. CI доказывает только свойства, относящиеся к риску изменения; полный release/deployment regression не запускается на каждый feature PR.

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

## Release

Тяжёлый выпуск не является автоматической частью обычной разработки. Единственный workflow `.github/workflows/release.yml` (`Release`) запускается либо вручную из текущего `main`, либо push служебной ветки `release-run`. В обоих случаях `release-preflight` требует, чтобы SHA запуска в точности совпадал с текущим SHA `main`; обычный push/merge в `main` Release не запускает.

Ветка `release-run` — переиспользуемый указатель на уже проверенный `main`, а не ветка разработки. Для очередного выпуска она fast-forward перемещается на exact текущий `main`. Это даёт GitHub write connector прямой способ запуска без `gh workflow run`, polling, временных workflows и version-specific automation.

Внутри одного запуска последовательно доказывается:

1. `release-preflight` — source SHA равен exact текущему `main`;
2. `release-verify` — check, unit/integration, smoke и backup self-test выполняются один раз;
3. `release-browser-critical` — критические browser/PIN/ACL сценарии, включая пакетный импорт протоколов, выполняются один раз;
4. внутренний `release-gate` — принимает результаты этих jobs без опроса внешних Actions;
5. `release-build-verify-publish` — один full offline artifact проходит checksum, systemd clean install, repeated update и forced rollback; из этого же archive формируется Project Control и публикуются семь assets.

Workflow не имеет `pull_request` или `workflow_run` trigger и не подписан на `push` в `main`; разрешённый push относится только к `release-run`. Он не запускает `gh workflow run`, не восстанавливает отсутствующие Actions и не ждёт внешние проверки по таймеру. Если `main` изменился до сборки или публикации, выпуск старого SHA запрещён.

## Full offline и systemd

Full offline bundle, systemd install/update/rollback, offline LLM/GGUF и Project Control относятся к поставке. Они выполняются при явном выпуске или при изменениях installer/update/offline, а не как часть обычного `Проверка`.

Release использует один собранный artifact: checksum → install → update → forced rollback → Project Control → публикация того же artifact. Пересборка между verification и upload запрещена.

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

Проверяются exact PR head SHA, mergeability, актуальные review comments и только те checks, которые относятся к изменению. Для обычного PR обязательна `Проверка`; для governed risk PR дополнительно должен быть зелёным запустившийся `GRACE / gate`; для storage/security/deployment scope — соответствующий профильный gate.

Workflow `Release` не запускается только ради merge изменения release/CI инфраструктуры: его контракт проверяется unit/regression tests и GRACE. После squash merge выпуск запускается отдельно явным `workflow_dispatch` либо fast-forward служебного `release-run` на exact `main`.

После squash merge достаточно короткого post-merge smoke/обычного CI. Повторять весь PR regression без нового риска не требуется.
