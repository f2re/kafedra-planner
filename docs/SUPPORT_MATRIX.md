# Матрица совместимости

Ни один целевой профиль пока не имеет статуса промышленно принятого. Ubuntu CI является автоматическим release-gate, но не заменяет акт на конкретной ОС.

| Профиль | Runtime | Состояние | Требуемое доказательство |
|---|---|---|---|
| Ubuntu 24.04 x86-64 CI | встроенный Node.js 24.18.0 | автоматический gate | build bundle, внешний SHA-256, внутренний manifest, embedded-runtime smoke, unit/browser/backup gates |
| Debian 12 x86-64 | встроенный Node.js 24.18.0 | ожидает #27 | strict/full preflight, install, реальные DOCX/PDF/OCR, restart, backup/restore, rollback |
| Astra Linux 1.7 x86-64 | встроенный Node.js 24.18.0 | ожидает #27 | glibc/`ldd`, strict/full preflight, системные пакеты, полный offline install/update/restore |
| Astra Linux 1.8 x86-64 | встроенный Node.js 24.18.0 | ожидает #27 | glibc/`ldd`, strict/full preflight, системные пакеты, полный offline install/update/restore |

Поддержка конкретной ОС не объявляется на основании совместимости исходного кода или успешного Ubuntu runner. Нужен акт с SHA-256 комплекта, Git commit, версией схемы, выводом system preflight, версией Node.js, glibc, SQLite, LibreOffice, Poppler и Tesseract.

Контракт автономной поставки и команды приёмки: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md).
