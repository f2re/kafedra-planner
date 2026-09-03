# Release candidate 0.4.1

## Статус

`0.4.1` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Выпуск объединяет только завершённые изменения текущего `main` и не меняет автономный контракт: Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны. Stable не объявляется до фактической приёмки Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

## Что завершено в 0.4.1

- Unicode-safe document intake сохраняет исходное имя, bytes, SHA-256, `document_version` и evidence.
- Offline bundle строго проверяет OCR, Poppler и LibreOffice до активации; package cache восстанавливается через `doctor.sh --repair`.
- Ошибки Оформлятора классифицируются и не блокируют локальную работу.
- Календарные browser fixtures детерминированы.
- На desktop от `721 px` планы переключаются сегментом `Текущие | Архив`; до `720 px` остаётся существующий select.

## Сохранность данных

SQLite schema остаётся `31`, новой migration нет. Применённые migrations, исходные blobs, SHA-256, `document_version`, source rows и evidence не переписываются. Backup/restore, `quick_check`, `foreign_key_check` и forced-failure rollback остаются обязательными.

## Выпуск

На одном exact head должны успешно завершиться GRACE, project CI, release gate, browser-контуры, full offline Debian 12, реальная systemd-установка, offline LLM/GGUF и Project Control. Publisher создаёт draft, проверяет exact tag SHA и семь assets, затем публикует non-prerelease Release.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27.
