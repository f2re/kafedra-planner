# GRACE 4: проверки по риску

GRACE используется в `kafedra-planner` как дополнительный fail-closed контур для изменений, где ошибка может повредить данные, безопасность, установку или механизм выпуска. Он не является обязательной оболочкой для каждой фичи и не дублирует обычные project tests.

## Когда GRACE обязателен

Полный governed flow нужен только если изменение затрагивает хотя бы один из контуров:

- SQLite schema, migrations, storage или recovery;
- immutable source/evidence/history;
- backup/restore;
- installer, offline bundle, update или rollback;
- PIN, auth, ACL или security;
- release/CI infrastructure;
- опасное архитектурное или необратимое изменение.

Обычный feature/UI/API/test/docs PR без этих рисков не создаёт `C-*` только ради процедуры. Для него достаточно обычного project CI и targeted regression затронутого сценария.

## Governed flow

Для рискованного изменения:

```text
Issue → exact main SHA → short branch
      → approved spec.xml + plan.xml
      → scoped implementation
      → GRACE final lint/scope
      → relevant risk gate + ordinary project CI
      → exact-head PR → squash merge
```

`ObservedWriteScope` описывает предметный scope изменения. Связанные regression tests и документация входят в тот же change; отдельный governance-проект для них не нужен.

Approved plan не расширяется задним числом. Supersede нужен только когда существенно меняются цель, architecture/security model, schema или acceptance criteria.

## Что делает GitHub workflow GRACE

`.github/workflows/grace.yml` автоматически запускается только когда PR или `main` меняет `.grace/**`, то есть когда автор явно выбрал governed flow. Также доступен `workflow_dispatch`.

Workflow выполняет три компактных шага:

1. `contract` — durable model, lifecycle, `ObservedWriteScope` и выбранный GRACE lint;
2. `database` — тяжёлый migration/recovery gate только если active spec содержит `M-DATABASE`, `M-BACKUP` или `M-MIGRATION-RUNNER`;
3. `gate` — проверяет только результат двух предыдущих GRACE jobs.

GRACE не опрашивает GitHub Checks API, не ждёт `Проверка`, browser, organization/science или release workflows и не перезапускает их. Команды unit/Playwright из change plan не должны повторно гоняться GRACE-ом, если то же свойство уже доказывает project CI или профильный risk gate.

## Обычный CI

Для каждого pull request и push в `main` всегда существует один обязательный workflow `Проверка`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
```

Это базовая защита от регрессий. Полный Playwright, alternate host Node, full offline bundle, systemd deployment, Project Control и backup/recovery self-tests не запускаются на каждый обычный PR.

Targeted Playwright выполняется при разработке затронутого UI-сценария. Полный browser/deployment regression относится к release или к изменению соответствующего рискованного контура.

Standalone workflows `Оргструктура`, `Массовый импорт науки`, `Научный жизненный цикл` и `Научные отчёты` сохранены как `workflow_dispatch` для диагностики; они не являются независимыми обязательными PR checks.

## SQLite и recovery

Applied SQL migrations неизменяемы. Schema change получает следующий последовательный номер и требует:

- migration regression test;
- `M-DATABASE`/`V-M-DATABASE` в governed change;
- clean install;
- exact-base → HEAD upgrade;
- repeated migration run;
- `PRAGMA quick_check` и `PRAGMA foreign_key_check`;
- pre-migration backup, verify и restore;
- forced-failure recovery там, где меняется механизм обновления/восстановления.

Эти проверки выполняются только для storage/recovery риска и перед release, а не для каждого UI/docs/API изменения.

## Release

В репозитории один release workflow: `.github/workflows/release.yml`, имя `Release`. Он запускается только вручную через `workflow_dispatch` из текущего `main`; обычный pull request и обычный merge не запускают release-scale работу.

Внутри одного workflow используются обычные зависимости jobs, без внешней оркестрации:

1. `release-preflight` фиксирует exact current `main` SHA;
2. `release-verify` один раз выполняет check, unit/integration, smoke и backup self-test;
3. `release-browser-critical` один раз выполняет критические browser/PIN/ACL сценарии;
4. внутренний `release-gate` требует успешность этих jobs;
5. `release-build-verify-publish` собирает один offline artifact, проверяет install/update/forced rollback именно этого artifact, создаёт Project Control из него и только затем публикует проверенные assets.

Release workflow не опрашивает другие Actions, не вызывает `gh workflow run`, не ждёт GRACE/organization/science jobs и не повторяет project/browser suites после gate. Если `main` изменился до публикации, выпуск старого SHA останавливается.

## Branch protection

Условный GRACE нельзя делать always-required status context: на обычном low-risk PR он намеренно отсутствует. Поэтому desired protection из `scripts/github/configure-main-protection.sh` требует только всегда присутствующий check `Проверка`.

Для risk-scoped PR исполнитель дополнительно обязан убедиться, что запустившийся `GRACE / gate` успешен. Для release/update/storage/security scope проверяются только соответствующие дополнительные gates.

Никакой aggregate workflow не должен ждать набор внешних Actions. Exact head SHA, mergeability и актуальные review comments проверяются непосредственно перед squash merge.

## Terminal archive

Действующие lifecycle-правила GRACE защищают terminal archive от подмены содержимого: archived bundle сохраняет тот же набор артефактов, а `spec.xml`/`plan.xml` меняют только terminal status. Завершённый change можно перенести в terminal archive в том же PR, где начинается следующий governed change: lifecycle старого bundle проверяется отдельно от `ObservedWriteScope` нового. Отдельный archive-only PR для этого не нужен.

Archive bookkeeping не заменяет продуктовую проверку и не должен приводить к повторному запуску полного release/deployment набора без отдельного риска.

## Failure behavior

Fail-closed остаётся только там, где он даёт новую гарантию. Нельзя:

- редактировать применённую migration;
- выходить за approved `ObservedWriteScope` в governed change;
- скрывать failure/cancelled как success;
- force-push обходить stale head;
- публиковать release без exact SHA и проверенного artifact;
- добавлять новый workflow только для повторения уже существующей проверки.
