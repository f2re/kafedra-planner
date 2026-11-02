# План консолидации после аудита 2026-11-02

База: `main@601f5cdaaf81d7c2114df97fe4f1d258196d9f87`, версия `0.4.10`, SQLite schema `31`.

Цель: устранить обнаруженные деградации без добавления новых предметных сущностей: привести backlog и release-state к одному источнику истины, удалить доказанно мёртвые frontend-дубли, закрыть UX/error-safety дефекты и выпустить один проверяемый релиз от exact `main`.

## Пакет A — backlog и источник истины

Владелец: `kafedra-flow-intake` + `kafedra-release`.

- закрыть probe/cleanup Issues;
- закрыть прямые дубли и явно superseded задачи с ссылкой на канонический контракт;
- не закрывать задачи, где фактическая реализация не доказана;
- не менять runtime.

## Пакет B — frontend consolidation

Владелец: `kafedra-feature`, независимая проверка `kafedra-tests`.

- доказать достижимость `lifecycle-next.js` и `plan-fact-origin.js`;
- удалить только подтверждённо неподключённый код;
- не создавать новую lifecycle/navigation реализацию;
- targeted unit/browser regression для затронутых входов.

## Пакет C — UX/error safety

Владелец: `kafedra-design` + `kafedra-feature`; приёмка `kafedra-design-audit` + `kafedra-tests`.

- заменить системные password `prompt()` на собственную доступную форму без изменения auth/PIN модели;
- скрыть технические значения вроде `custom_document` из частого пути, сохранив редкое расширение;
- проверить пользовательские entry-points с пустыми `.catch(() => {})` и обеспечить единственный observable error state;
- bulk AI apply должен повторно проверять текущее состояние и не перезаписывать более свежую ручную правку;
- no-motion: изменение не требует новой анимационной модели.

Auth/security и bulk write относятся к повышенному риску: использовать существующий GRACE и targeted auth/ACL regression, не создавать новый процесс.

## Пакет D — release consistency

Владелец: `kafedra-release`.

- после слияния исправлений определить следующий patch version;
- один universal release workflow от exact `main`;
- critical browser + DB/recovery + offline bundle + install/upgrade/forced rollback по действующему release-контракту;
- tag и GitHub Release должны указывать на один проверенный SHA;
- опубликованный artifact должен быть тем же, что прошёл verification.

## Внешнее ограничение

Branch protection/rulesets требуют GitHub Administration permissions. Подключённый GitHub App не предоставляет административную mutation-операцию. Репозиторий содержит #188 и скрипт настройки; этот пункт закрывается только фактическим чтением protection после административного применения.

## Definition of Done

1. Нет известных прямых дублей/служебных probe Issues в активном backlog.
2. Нет доказанно неподключённого lifecycle/origin frontend-кода.
3. Password flow не использует `window.prompt`; ошибки затронутых entry-points видимы и не дублируются.
4. Bulk AI apply защищён от stale/manual overwrite.
5. Ordinary PR CI и targeted regressions зелёные на exact heads; auth/security изменения проходят соответствующий risk gate.
6. Все исправления squash-merged в актуальный `main`.
7. Следующий release опубликован от exact `main`; tag, release и assets согласованы.
8. Реальная Astra acceptance остаётся отдельным эксплуатационным доказательством и не подменяется CI.
