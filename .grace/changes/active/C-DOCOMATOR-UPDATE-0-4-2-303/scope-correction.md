# Scope correction — C-DOCOMATOR-UPDATE-0-4-2-303

Во время синхронизации release markers общий `npm test` обнаружил два исторических теста, чьи имена и assertions были жёстко привязаны к уже опубликованным текущим версиям:

- `tests/release-0.4.1.test.mjs` требовал, чтобы текущие `VERSION`, README и release workflows оставались `0.4.1`;
- `tests/release-recovery-workflow.test.mjs` требовал активный publisher trigger `Release gate 0.4.0`, хотя recovery-инварианты не зависят от номера текущего выпуска.

После законного перехода на `0.4.2` эти assertions становятся взаимоисключающими с утверждёнными TargetAssertions, хотя проверяемые ими исторические и recovery-контракты остаются обязательными.

Поправка минимальна и не расширяет продуктовый сценарий. Оба файла явно добавлены в `ObservedWriteScope` только для преобразования в устойчивые regressions:

- тест `0.4.1` продолжает проверять неизменяемый исторический release note, имена assets и отсутствие активного trigger на старый gate;
- recovery-тест выводит ожидаемое имя gate из текущего `VERSION` и по-прежнему проверяет no-op вне main, exact-main guard, один инфраструктурный retry и запрет скрывать реальные job failures.

Тесты не исключаются из `npm test`, mandatory gate не ослабляется. Production code, database, migrations, runtime, UI, installer acceptance и release assets scope не расширяются. Поправка зафиксирована в issue #303 до corrective commit.

## Auth regression correction

На exact head `8d915117e20f2e8042f228c738cd3e2494c5fe52` полный browser gate выявил независимую нестабильность `tests/browser/auth.spec.mjs` только в mobile-проекте: helper вычислял числовой индекс option до фокусировки native select, а разрешённый adaptive rank-only слой успевал изменить порядок option. В результате тест выбирал `person-admin` вместо уже существующего `person-staff`, хотя desktop, role/ACL API и целевой Docomator browser flow проходили.

`tests/browser/auth.spec.mjs` добавлен в `ObservedWriteScope` только как связанная release regression. Исправление не меняет auth, PIN, ACL, роли, adaptive policy или production UI: сценарий выбирает option по устойчивому value через штатный Playwright `selectOption`, затем по-прежнему доказывает сохранение явного выбора после reload, доступ руководителя только к подчинённому и запрет чужого/admin scope.

Это test-only correction по зоне `kafedra-tests`, а не изменение цели, schema, security model, архитектуры или критериев приёмки. Поэтому supersede не требуется. Полный auth/ACL browser gate остаётся обязательным, а skipped/offline downstream jobs не принимаются как доказательство выпуска.
