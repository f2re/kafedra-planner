# Матрица совместимости

Ни один целевой профиль пока не имеет статуса промышленно принятого. Ubuntu CI является автоматическим release-gate, но не заменяет акт на конкретной ОС.

Для приложения поддерживается Node.js `>=24.15.0 <25` — линия Node 24 LTS. Автономный архив закрепляет конкретный проверенный runtime **Node.js 24.19.0**; версия Node на машине, где запускается сборщик, может отличаться и в поставку не копируется.

| Профиль | Runtime поставки | Состояние | Требуемое доказательство |
|---|---|---|---|
| Ubuntu 24.04 x86-64 CI | Node.js 24.19.0 LTS | автоматический gate | build bundle из отличающегося host Node, SHA-256, manifest, embedded-runtime smoke, unit/browser/backup gates |
| Debian 12 x86-64 | Node.js 24.19.0 LTS | ожидает #27 | strict/full preflight, install/update одной VERSION с разными commit, реальные DOCX/PDF/OCR, restart, backup/restore, rollback |
| Astra Linux 1.7 x86-64 | Node.js 24.19.0 LTS | ожидает #27 | glibc/`ldd`, strict/full preflight, системные пакеты, полный offline install/update/restore |
| Astra Linux 1.8 x86-64 | Node.js 24.19.0 LTS | ожидает #27 | glibc/`ldd`, strict/full preflight, системные пакеты, полный offline install/update/restore |

Официальные Linux x64/arm64 binaries Node 24 требуют совместимой GNU/Linux-среды; установщик выполняет `ldd` до запуска встроенного runtime и прекращает установку, если динамические зависимости не разрешаются.

Поддержка конкретной ОС не объявляется на основании совместимости исходного кода или успешного Ubuntu runner. Нужен акт с SHA-256 комплекта, Git commit, версией схемы, выводом system preflight, версией Node.js, glibc, SQLite, LibreOffice, Poppler и Tesseract.

Контракт автономной поставки и команды приёмки: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md).
