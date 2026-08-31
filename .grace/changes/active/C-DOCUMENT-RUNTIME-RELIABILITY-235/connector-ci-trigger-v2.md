# Финальная exact-head проверка GitHub connector

Этот commit создан после one-shot интеграции `C-DOCUMENT-RUNTIME-RELIABILITY-235` и запускает штатные GitHub workflows уже на окончательном содержимом ветки.

Разрешение merge определяется только фактическими check runs данного head: GRACE current/final, project CI, browser desktop/mobile, offline/release/database gates. Любой pending, failure, cancelled, missing либо неожиданный skipped блокирует слияние.
