# Scope correction — C-DOCOMATOR-UPDATE-0-4-2-303

Во время синхронизации release markers общий `npm test` обнаружил два исторических теста, чьи имена и assertions были жёстко привязаны к уже опубликованным текущим версиям:

- `tests/release-0.4.1.test.mjs` требовал, чтобы текущие `VERSION`, README и release workflows оставались `0.4.1`;
- `tests/release-recovery-workflow.test.mjs` требовал активный publisher trigger `Release gate 0.4.0`, хотя recovery-инварианты не зависят от номера текущего выпуска.

После законного перехода на `0.4.2` эти assertions становятся взаимоисключающими с утверждёнными TargetAssertions, хотя проверяемые ими исторические и recovery-контракты остаются обязательными.

Поправка минимальна и не расширяет продуктовый сценарий. Оба файла явно добавлены в `ObservedWriteScope` только для преобразования в устойчивые regressions:

- тест `0.4.1` продолжает проверять неизменяемый исторический release note, имена assets и отсутствие активного trigger на старый gate;
- recovery-тест выводит ожидаемое имя gate из текущего `VERSION` и по-прежнему проверяет no-op вне main, exact-main guard, один инфраструктурный retry и запрет скрывать реальные job failures.

Тесты не исключаются из `npm test`, mandatory gate не ослабляется. Production code, database, migrations, runtime, UI, installer acceptance и release assets scope не расширяются. Поправка зафиксирована в issue #303 до corrective commit.
