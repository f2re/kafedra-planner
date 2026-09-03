# Release candidate 0.4.2

## Статус

`0.4.2` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Выпуск объединяет завершённую прямую интеграцию с Оформлятором и надёжное обновление статического интерфейса, не меняя автономный контракт: Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны. Stable не объявляется до фактической приёмки Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

## Что завершено в 0.4.2

- Администратор вставляет один полный URL Оформлятора вместо раздельных protocol/host/port.
- Поддерживаются URL из браузера, hostname, IPv4 и IPv6; известные API/health paths нормализуются до origin.
- Актуальный `/readyz` со `status: ok` и legacy `ready` принимаются одинаково.
- DNS, отказ порта, timeout, TLS, чужой сервис, not-ready и несовместимый API различаются без утечки секретов.
- Выбор пространства, группы и полей ведёт к preview и идемпотентному импорту; ошибка одной записи не отменяет остальные.
- Четырёхзначный код Оформлятора используется только в текущем запросе и не сохраняется.
- Архив установки можно запускать из обычного пользовательского каталога; root нужен только для staging, `/opt`, `/etc`, `/var`, backup и systemd.
- Активный release проверяет обязательные UI-файлы, а статические ответы используют `Cache-Control: no-store`, поэтому старый сайт не остаётся в кэше после успешного обновления.
- Документированы одна команда перезапуска API/worker и команды статуса/журнала.

## Сохранность данных

SQLite schema остаётся `31`, новой migration нет. Применённые migrations, исходные blobs, SHA-256, `document_version`, source rows и evidence не переписываются. Backup/restore, `quick_check`, `foreign_key_check` и forced-failure rollback остаются обязательными. Импорт Оформлятора не удаляет локальные планы, задачи, материалы, назначения и историю.

## Выпуск

На одном exact head должны успешно завершиться GRACE, project CI, release gate, browser-контуры, full offline Debian 12, реальная systemd-установка, offline LLM/GGUF и Project Control. Publisher создаёт draft, проверяет exact tag SHA и семь assets, затем публикует non-prerelease Release.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27.
