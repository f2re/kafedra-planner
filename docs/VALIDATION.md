# Проверка изменений

Актуальный рубеж: `0.4.7`, SQLite schema **31**. Проверки выбираются по риску изменения; полный release/deployment regression не запускается на каждый feature PR.

## Обычный pull request

Pull request автоматически выполняет один полный workflow `Проверка`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
```

Это основное exact-head доказательство обычного изменения. Один и тот же unit/check/docs набор не запускается повторно под другим именем или после merge только ради второго статуса.

Для UI дополнительно выполняется targeted Playwright реально затронутого сценария. Проверяется только затронутый desktop/mobile layout; оба нужны, если изменение касается обоих. Полная browser matrix не является обязательным PR gate.

## После merge

После squash merge push в `main` выполняет отдельный job `Post-merge smoke`: locked `npm ci` и **только `npm run smoke`**. `npm run check`, docs и `npm test` второй раз не выполняются, потому что их уже доказал exact PR head.

GRACE после merge автоматически не запускается. Если merge создал новый риск, проверка выбирается отдельно по этому конкретному риску, а не повторяет весь lifecycle.

## Дополнительные проверки по риску

| Изменение | Дополнительное доказательство |
| --- | --- |
| SQLite schema/storage/recovery | migration + clean install + base→HEAD upgrade + repeated migration + integrity + backup/restore |
| PIN/auth/ACL/security | targeted auth/ACL regression |
| installer/update/offline | full bundle + systemd install/update/rollback + document runtime self-test |
| release/CI infrastructure | GRACE contract/scope и релевантный release/CI regression |
| обычный UI/API/docs/test | без полного GRACE/deployment gate |

GRACE автоматически запускается для pull request, который содержит governed `.grace/**` change. Его `database` job выполняет тяжёлую DB/recovery проверку только при соответствующем `M-DATABASE`, `M-BACKUP` или `M-MIGRATION-RUNNER` в active spec. `workflow_dispatch` остаётся ручной диагностикой. GRACE не опрашивает остальные GitHub Actions, не ждёт их завершения и не повторяет project tests.

## Ручные диагностические workflows

`Оргструктура`, `Массовый импорт науки`, `Научный жизненный цикл` и `Научные отчёты` доступны через `workflow_dispatch`. Они воспроизводят профильные browser/integration контуры по необходимости, но не запускаются автоматически на каждом PR или merge.

## Поиск и необязательная ЛЛМ

Поисковая регрессия включает текущий FTS, словоформы и ограниченные опечатки, сохранение явных фильтров, пустую первоначальную выдачу, получение новых источников через расширение запроса, отмену поколений, тайм-аут и проверку цитат. Авторизованный API-тест проверяет недоступные/архивные источники и инвалидацию результата после отзыва доступа. Браузер проверяет обычные и дополнительные материалы, канонические переходы, возврат, отключение подсказок и desktop/mobile без новой анимации.

Контролируемые ответы модели доказывают поведение интеграции, но не качество конкретной GGUF-модели. Реальную релевантность и время CPU-инференса измеряют отдельно. Базовый поиск не зависит от доступности модели. Подробно: [`SEMANTIC_SEARCH.md`](SEMANTIC_SEARCH.md).

## Release

Тяжёлый выпуск отделён от обычной разработки. Единственный `.github/workflows/release.yml` (`Release`) запускается вручную из текущего `main` либо push служебной ветки `release-run`. `release-preflight` требует exact совпадения source SHA с текущим `main`; обычный merge в `main` Release не запускает.

`release-run` — переиспользуемый fast-forward указатель на уже выбранный `main`, а не ветка разработки. Это позволяет запускать тот же version-neutral workflow без временных workflow, polling и version-specific automation.

Внутри одного release run:

1. `release-preflight` проверяет exact `main`;
2. `release-verify` выполняет project regression и backup self-test один раз; дополнительный smoke проверяет минимальный поддерживаемый Node.js `24.15.0` без повторения unit-набора;
3. `release-browser-critical` выполняет критические browser/PIN/ACL сценарии один раз;
4. внутренний `release-gate` принимает результаты jobs без опроса внешних Actions;
5. `release-build-verify-publish` один раз собирает каждый из трёх target archives, проверяет его в соответствующей среде и создаёт Project Control и публикацию из тех же архивов.

Release не использует `pull_request` или `workflow_run`, не подписан на push `main`, не перезапускает другие workflows и не ждёт их по таймеру. Если `main` изменился до сборки или публикации, старый SHA не публикуется.

## Full offline и systemd

Full bundle содержит managed Node.js/CPython и air-gap closure для document capabilities из `config/offline/os-packages.txt`: `unzip`, Poppler, Tesseract `rus+eng`, LibreOffice и шрифты. На target устанавливаются только отсутствующие возможности. Version pin для установленного системного пакета, upgrade/downgrade/remove и автоматический `apt --fix-broken` запрещены.

До переключения `/opt/kafedra-planner/current` установщик выполняет strict full preflight и `scripts/recognition/ocr.py doctor --languages rus+eng --self-test`. Неработающий PDF/OCR/Office runtime останавливает активацию и оставляет предыдущий release active.

В соответствующих Astra 1.7/1.8 UBI с отключённой сетью устанавливается пакетный слой проверяемого архива, выполняются OCR self-test, преобразование документа в PDF через LibreOffice и чтение результата через Poppler. Это проверка пользовательской среды, не systemd/PARSEC на реальном ядре Astra Linux.

На Debian 12 проверяются systemd API/worker, managed runtimes, `doctor.sh`, repeated install, legacy layout и repair без исходного носителя. Для выпуска дополнительно скачивается предыдущий опубликованный Debian-комплект с проверкой контрольных сумм и происхождения. После его установки проверяются обновление тем же candidate archive и принудительный отказ нового worker после переключения `current`: откат должен вернуть прежний release, PIN, конфигурацию и контрольный blob. Затем проверяются успешный повтор и SQLite `quick_check`/`foreign_key_check`. Пересборка между verification и upload запрещена.

## Что остаётся ручным

Целевая эксплуатационная приёмка #27 остаётся отдельной:

- настоящая Astra Linux и контрольная Debian;
- vendor package revisions;
- реальные ведомственные документы;
- реальные права каталогов и systemd hardening;
- clean install, upgrade, restore и forced rollback;
- обновление сайта без stale cache;
- при наличии — настоящий Оформлятор и llama-server/GGUF.

Пользовательская проверка реальных протоколов проводится после установки опубликованного выпуска. Она не является предварительным условием patch-релиза `0.4.7`; автоматические проверки сохранности и релизных архивов выполняются до публикации.

## Перед merge

Проверяются exact PR head SHA, mergeability, актуальные review comments и только checks, относящиеся к изменению. Для ordinary PR обязательна `Проверка`; для governed risk PR дополнительно должен быть успешен запустившийся `GRACE / gate`; для storage/security/deployment — соответствующий профильный gate.

Workflow `Release` не запускается только ради merge изменения release/CI инфраструктуры, если его неизменённый контракт уже покрыт targeted regression и GRACE. Сам выпуск запускается отдельно от exact `main`.

После merge достаточно подтверждённого нового SHA `main` и успешного `Post-merge smoke`. Полный PR regression повторяется только если есть отдельная новая причина.
