# Матрица совместимости

Для приложения поддерживается Node.js `>=24.15.0 <25` — линия Node 24 LTS. Автономный архив закрепляет конкретный проверенный runtime **Node.js 24.19.0**; версия Node на машине, где запускается сборщик, может отличаться и в поставку не копируется.

| Профиль | Runtime поставки | Автоматическая проверка | Эксплуатационная приёмка |
|---|---|---|---|
| Debian 12 x86-64 | Node.js 24.19.0 + managed CPython + exact `.deb` closure | full bundle, offline APT install, Tesseract rus+eng, Poppler, LibreOffice, migrate/admin из чужого cwd, API/worker health | целевой сервер: backup/restore/rollback и реальные документы |
| Astra Linux 1.7 x86-64 | тот же контракт, но собственный Astra `.deb` closure | сборка должна выполняться на эталонной Astra 1.7 | требуется акт на фактической целевой машине |
| Astra Linux 1.8 x86-64 | тот же контракт, но собственный Astra `.deb` closure | сборка должна выполняться на эталонной Astra 1.8 | требуется акт на фактической целевой машине |

Full bundle не переносит `.deb` между разными `ID/VERSION_ID/architecture`: installer сравнивает профиль и прекращает установку при несовпадении. Это принципиально отличает полноценную автономную поставку от прежнего универсального application-only архива.

Nginx не является обязательной зависимостью: штатная установка слушает `0.0.0.0:8080`, а reverse proxy подключается отдельно при необходимости TLS или единого внешнего endpoint.

Поддержка конкретной Astra-машины окончательно подтверждается актом с SHA-256 комплекта, Git commit, выводом full preflight, версиями Node/Python/glibc/SQLite/LibreOffice/Poppler/Tesseract и проверкой rollback.

Контракт автономной поставки и команды приёмки: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md).
