# GRACE-контур разработки

GRACE 4 является внешним инженерным контуром `kafedra-planner`. Он управляет изменениями кода, данных, UX, CI и поставки, но не входит в runtime приложения и не требует Bun на целевой Debian/Astra-системе. Здесь **GRACE spec** означает `GraceChangeSpec`/`GraceChangePlan`; это не сетевой gRPC-протокол.

## Непротиворечивый lifecycle

```text
GitHub Issue
  → точный SHA main
  → короткая ветка
  → .grace/changes/active/C-*/spec.xml (approved)
  → .grace/changes/active/C-*/plan.xml (approved, immutable)
  → current + selected baseline
  → scoped implementation через kafedra-* роли
  → task/target/final evidence
  → spec и plan = applied, bundle перемещён в archive
  → PR checks для точного SHA
  → GRACE merge gate
  → squash merge с expected head SHA
  → post-merge CI на новом main
```

Существенным считается изменение runtime, API, storage, UI, tests, scripts, SQL migrations, deployment, workflow, package/version, `AGENTS.md` либо текущих `.grace/context`, graph и verification. Чистая небольшая правка обычной документации может не создавать C-*; policy решает это детерминированно по путям diff.

## Работа в ветке

Ветку создают только от проверенного `refs/heads/main`. Один C-* описывает один связный change. Spec и plan получают статус `approved` только после явного решения пользователя. После approval plan не редактируется: изменение цели, assertions, `DurableScope`, `ObservedWriteScope` или задач требует нового C-* и `superseded` для прежнего bundle.

Перед observed writes:

```bash
grace lint --path . --assertions current
grace lint --path . --change C-ID --assertions baseline --run-commands
grace status --path . --json
```

После каждой задачи выполняется её leaf verification. Перед завершением:

```bash
grace lint --path . --change C-ID --assertions target --run-commands
grace lint --path . --change C-ID --assertions final --run-commands
npm run check
npm test
```

Параллельная работа допускается только после `grace lint --path . --parallel-preflight`. Пересечение durable или observed scope блокирует параллельный запуск. Worker не меняет approved plan; общие `.grace`-проекции обновляются централизованно.

## Роли проекта внутри GRACE

GRACE отвечает за цель, scope, assertions, порядок задач и доказательство завершения. Локальные skills отвечают за предметную реализацию:

```text
GraceChangeSpec
  → kafedra-flow-intake
  → kafedra-design + kafedra-data
  → GraceChangePlan
  → kafedra-feature
  → kafedra-tests
  → kafedra-release
  → GRACE final/apply/archive
```

Schema, persistent state, recovery или projection change обязательно вовлекают `kafedra-data`; migration rollout, bundle, backup/restore или rollback — `kafedra-release`; UI — `kafedra-design` и browser coverage через `kafedra-tests`.

## ObservedWriteScope

`scripts/grace-policy.mjs` сравнивает точные `base SHA...head SHA`. Все изменённые файлы существенного change, кроме собственных файлов bundle в `.grace/changes/`, должны попадать хотя бы в один `ObservedWriteScope` изменённого approved/applied C-*.

Поддерживаются:

- `<File>` и `<Path>` для точного project-relative пути;
- `*` и `?` внутри одного сегмента;
- `**` только как отдельный сегмент;
- `<None />` только для плана без observed writes.

Абсолютные пути, `..`, negation, braces, character classes и `**` внутри обычного сегмента отклоняются. Это не security sandbox, а проверяемый контракт планируемых записей.

## Консистентность SQLite и миграции

Миграции являются append-only ledger.

1. Уже существующий `migrations/NNN_name.sql` нельзя изменять, удалять, переименовывать или копировать под старым номером.
2. Новые файлы имеют форму `NNN_lower_snake_case.sql` и продолжают максимальный номер base без разрывов.
3. Параллельные ветки, выбравшие одинаковый следующий номер, не могут обе войти в `main`: после первого merge вторая перестраивается поверх нового base и получает новый номер.
4. Schema-change включает regression-test с `migration`, `schema` или `database` в имени.
5. Plan содержит `npm run grace:migrations`, `npm run backup:selftest`, `PRAGMA quick_check`, `PRAGMA foreign_key_check` и явную rollback-стратегию.

`npm run grace:migrations` выполняет:

```text
base SHA worktree
  → чистая БД на всех base migrations
  → HEAD migrations поверх этой БД
  → повторный HEAD migrate (идемпотентность)
  → schema_migrations == migrations дерева HEAD
  → PRAGMA quick_check == ok
  → PRAGMA foreign_key_check == []
  → backup/restore selftest
```

Down-migrations не используются: rollback выполняется возвратом предыдущего application bundle и восстановлением автоматически созданной pre-migration backup. Миграция должна быть транзакционной; длительное destructive преобразование сначала проектируется как expand/backfill/contract в нескольких совместимых changes.

## GitHub Actions

`.github/workflows/grace-governance.yml` запускается для PR, push в `main` и вручную.

`GRACE contract`:

- получает полный git history и точные base/head SHA;
- ставит только инженерный `@osovv/grace-cli@4.0.5`;
- проверяет lifecycle, scope и append-only migrations;
- выполняет migration gate;
- запускает `current` и selected `final` assertions.

Active approved bundle проходит contract checks, но получает `ready=false`. После свежего final evidence spec и plan переводятся в `applied` и bundle перемещается в `.grace/changes/archive/C-*`. Для archived bundle CI временно и только в ephemeral checkout восстанавливает location/status `active/approved`, повторно запускает exact final assertions на текущем дереве и полностью восстанавливает checkout. Поэтому archive не ослабляет проверку финального состояния.

`GRACE merge gate` принимает только `ready=true`, затем через GitHub Checks API ждёт и проверяет новейшие check runs того же `github.sha`:

- `Минимальный Node 24.15`;
- `test`;
- `browser`;
- `Сборщик под host Node 25.6`;
- `Full offline Debian 12 + Project Control`.

Отсутствующий, queued, in-progress, skipped, neutral, cancelled, timed-out, stale, action-required или failed check блокирует gate. Успех старого SHA не переносится на новый commit.

## Настройка защиты main

В репозитории на момент внедрения не было ruleset, а используемый GitHub App не имеет mutation-доступа к branch protection. Поэтому администратор репозитория должен один раз включить в GitHub:

1. Settings → Rules → Rulesets или Branches → Branch protection для `main`.
2. Require a pull request before merging.
3. Require status checks to pass and require branches to be up to date.
4. Добавить required check `GRACE merge gate`.
5. Запретить force-push и deletion `main`.
6. Не разрешать bypass для обычных участников и automation, которая не выполняет этот workflow.
7. Предпочтительно оставить squash merge как нормативный способ слияния.

До включения серверного ruleset дисциплина обеспечивается CI и процедурой merge, но владелец с административным bypass технически может обойти её. Это ограничение нельзя скрывать или считать настроенной защитой.

## Финальное слияние

Перед merge повторно проверяются:

- PR head SHA не изменился после прочитанного результата CI;
- PR mergeable и не имеет конфликтов;
- нет unresolved review threads или request changes;
- `GRACE merge gate` завершён `success` для точного PR SHA;
- bundle находится в archive со status `applied`;
- schema/release impact имеет backup/restore и rollback evidence.

Слияние выполняется squash merge с `expected_head_sha`. После него получают новый `refs/heads/main` и проверяют post-merge `GRACE governance` и основной workflow `Проверка`. Ошибка post-merge не замалчивается: создаётся отдельный recovery C-*; историю migrations и evidence не переписывают.

## Локальные команды Fish

```fish
set BASE_SHA (git merge-base HEAD origin/main)
set HEAD_SHA (git rev-parse HEAD)

set -lx GRACE_BASE_SHA $BASE_SHA
set -lx GRACE_HEAD_SHA $HEAD_SHA

npm run grace:policy
npm run grace:migrations
npm run grace:ci
```
