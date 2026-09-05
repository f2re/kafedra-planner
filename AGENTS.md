# AGENTS.md

Правила действуют для всего `kafedra-planner`. Приоритет: рабочий пользовательский сценарий → сохранность данных → понятный UX → отсутствие регрессий → безопасное обновление. GRACE, CI и GitHub-процедуры дают доказательства, но не являются целью разработки.

## Перед существенным изменением

1. Получить фактический `main` и exact SHA.
2. Прочитать `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, профильные документы, связанные Issues/PR и текущий CI.
3. Не реализовывать повторно существующий контур и не переносить старую ветку поверх нового `main` без проверки diff.
4. Существенную работу оформить Issue с пользовательским результатом и критериями приёмки.
5. Создать короткую branch от проверенного `main`.
6. Выполнить обязательный Kafedra workspace preflight из раздела ниже и выбрать только реально нужные роли/skills.

## Обязательный Kafedra workspace preflight

Для существенной работы прочитать `codex/skills/kafedra-workspace-orchestrator/SKILL.md` и выбрать минимальный набор реально нужных repository-local ролей и профильных skills. Pinned snapshot, происхождение и порядок обновления описаны в `docs/AI_SKILLS_PROFILE.md`. Для чистого backend/infrastructure/release изменения допустим результат `focused profile skills: none`.

## Разработка и роли

Закрывать сценарий вертикально:

```text
проблема → domain/storage → API → UI → ошибки/partial success → evidence/history → targeted tests
```

Не оставлять production mocks, TODO, временные обходы или мёртвый код. Не делать «backend сейчас, UI потом», если пользовательский сценарий можно закончить сразу.

Основные роли:

- `kafedra-flow-intake` — пользовательский путь;
- `kafedra-design` / `kafedra-motion` / `kafedra-design-audit` — UX, responsive и независимая UI-проверка;
- `kafedra-data` — storage/schema/migrations/recovery;
- `kafedra-feature` — вертикальная реализация;
- `kafedra-tests` — regression/Playwright;
- `kafedra-release` — installer/update/offline/rollback/release.

Не прогонять все роли формально. Делегировать законченные зоны ответственности; один контракт меняет один исполнитель. После параллельных scopes выполнить интеграционный аудит.

## Архитектурные инварианты

Система автономна на Debian/Astra Linux: production без Docker, CDN, обязательного Интернета, облака и LLM. SQLite — основное хранилище; `llama.cpp` только необязательное улучшение.

Исходные PDF/DOCX/XLSX/ODS, blobs, SHA-256 и `document_version` неизменяемы. Ручная правка не уничтожает автоматически извлечённый факт/evidence. Автоматический факт имеет источник `document → version → locator`; предположение не становится подтверждённым фактом без основания.

Upload/import/sync/materialize/generate/background jobs должны быть идемпотентными. Ошибка одного документа, строки или адаптера не блокирует остальные.

Applied migrations неизменяемы; новая получает следующий номер. Schema/storage/recovery change требует clean install → upgrade существующей базы → repeated migration → `PRAGMA quick_check` → `PRAGMA foreign_key_check` → backup/verify → restore → forced-failure rollback. Destructive reset существующей установки запрещён.

## UX

Интерфейс спокойный, минималистичный и понятный без инструкции. Система автоматически делает всё однозначное; человек исправляет только исключения.

Intake:

```text
загрузить → сохранить immutable source → обработать → создать рабочий объект → открыть → исправить неоднозначности
```

Одна проблемная строка не блокирует документ. Для задачи действие `Выполнено` сразу синхронизирует связанные план, календарь и `План / факт`; файл, справка, скан или комментарий необязательны.

Adaptive UX использует классы `safe-default`, `rank-only`, `domain-derived`, `never-learn`. Приоритет: сохранённый факт → явный выбор → domain-derived → safe personal default → static fallback. ACL, PIN, роли, выполнение, удаление, archive/restore, подтверждения и свободный деловой текст — `never-learn`. Геометрия интерфейса не меняется по статистике, а программная подстановка не считается пользовательским выбором.

Для затронутого UI проверить соответствующий desktop/mobile layout и `prefers-reduced-motion`; не запускать обе компоновки формально, если менялась только одна.

## GRACE — только по риску

Полный GRACE обязателен только для:

- SQLite schema/migrations/storage/recovery;
- immutable source/evidence/history;
- backup/restore;
- installer/update/rollback/offline bundle;
- PIN/auth/ACL/security;
- release/CI infrastructure;
- опасных архитектурных или необратимых изменений.

Обычные feature/UI/API/test/docs изменения полного lifecycle не требуют.

Governed flow:

```text
Issue → exact main SHA → approved spec.xml + plan.xml
      → scoped implementation → GRACE final lint/scope
      → relevant risk gate + project CI → PR → squash merge
```

`ObservedWriteScope` описывает предметную область; связанные regression tests и документация разрешаются в том же change. Approved plan не расширять задним числом. Supersede нужен только при существенном изменении цели, schema, security model, архитектуры или acceptance criteria.

GRACE не должен повторно выполнять тот же `npm test`/Playwright, который уже является project CI evidence, и не должен опрашивать/ожидать другие GitHub workflows. Подробности: `docs/GRACE_GOVERNANCE.md`.

## Tests и CI

Обычный PR автоматически запускает один workflow `Проверка`:

1. locked `npm ci`;
2. `npm run check`;
3. `npm run docs:check`;
4. `npm test`;
5. `npm run smoke`.

Targeted regression выбирается по затронутому сценарию. Для UI — targeted Playwright. Полный browser regression не нужен на каждый PR.

Тяжёлые gates только по риску:

- schema/storage → migration + backup/restore;
- auth/ACL → auth/ACL regression;
- installer/update/offline → full bundle + systemd + update/rollback;
- release infrastructure → release regression.

Full browser и offline/deployment regression выполняются перед release и при изменении соответствующего контура. Node minimum/alternate host проверяются при изменении runtime/build tooling и перед release, а не на каждом feature PR.

Standalone organization/science workflows являются ручными diagnostics, а не обязательным fan-out. Если свойство уже доказано на exact SHA, не запускать тот же набор второй раз без отдельной причины.

## GitHub

Для записи из ChatGPT сначала обнаружить GitHub write actions. Отсутствие `gh`, локального `.git` или shell credentials само по себе не означает read-only доступ.

Для связанных файлов предпочтительна атомарная последовательность Git Data API:

```text
exact main/tree → create blobs → create tree → create commit
→ update short branch (force=false) → compare → PR → relevant CI
→ re-fetch exact PR head/mergeability/comments → squash merge
→ re-fetch main → короткий post-merge smoke/CI
```

Не использовать force push для обхода race. Не создавать probe Issues, dummy files/commits или временные workflows для проверки connector. Не сообщать о commit/PR/merge/CI/release без подтверждения GitHub API.

Перед merge проверять только обязательные checks, относящиеся к изменению. Для ordinary PR это `Проверка`; если risk-scoped GRACE запустился, `GRACE / gate` также должен быть успешен. `pending`, `failure`, `cancelled` и неожиданный `skipped` не являются доказательством.

## Release

Использовать один универсальный release flow для всех версий. Release идёт от exact SHA `main` и один раз выполняет необходимые unit/integration, critical browser, DB/recovery проверки, сборку offline bundle, clean install, upgrade предыдущей версии и forced-failure rollback.

Offline bundle собирается один раз. Публикуется тот же artifact, который прошёл install/update/rollback verification. Publisher не должен ждать множество других workflows, перезапускать их или повторять их тесты.

После успеха tag и GitHub Release проверяются через GitHub API. GRACE bookkeeping не является условием публикации release.

## Готовность

Фича готова, когда сценарий работает целиком, данные не теряются, ошибки и partial success обработаны, в затронутом контуре нет известных регрессий, UX соответствует правилам, релевантные tests зелёные, а update/recovery безопасны, если были затронуты deployment/storage.

Не создавать проверку только потому, что можно создать ещё одну. Если governance или CI задерживают исправление без новой полезной гарантии — упрощать их, а не добавлять слой.
