# Scope correction — C-DOCOMATOR-UPDATE-0-4-2-303

Во время синхронизации release markers обнаружено, что общий `npm test` исполняет исторический файл `tests/release-0.4.1.test.mjs`. Его исходный контракт проверяет, что текущие `VERSION`, README и release workflows равны `0.4.1`, поэтому после законного перехода на `0.4.2` тест становится взаимоисключающим с утверждёнными TargetAssertions.

Поправка минимальна и не расширяет продуктовый сценарий: `tests/release-0.4.1.test.mjs` добавляется в `ObservedWriteScope` только для преобразования в regression неизменяемого исторического выпуска `v0.4.1`. Тест продолжает проверять release note, имена исторических assets и отсутствие активного publisher trigger на `Release gate 0.4.1`.

Production code, database, migrations, runtime, UI, installer acceptance и release assets scope не расширяются. Поправка зафиксирована явно до итогового release commit и отражена в issue #303; скрытое ослабление или исключение старого теста из `npm test` не используется.
