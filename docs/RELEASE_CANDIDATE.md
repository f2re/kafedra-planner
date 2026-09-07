# Release candidate 0.4.4

## Статус

`0.4.4` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Он выпускает уже слитый цикл R1–R9: меньше ручных действий, честные partial-success состояния, повторный OCR с сохранением provenance, прямое выполнение задач, точная навигация поиска, управляемые adaptive defaults и упрощённый CI/governance. Новая SQLite migration не добавляется. Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны для production.

## Что завершено в 0.4.4

- OCR хранит абсолютную страницу/coverage/locator и при повторной обработке создаёт новый machine run на той же immutable `document_version`.
- Upload/import summary строится по фактическим server-confirmed результатам и не выдаёт mixed batch за полностью успешный.
- Заседание создаётся с минимальными реквизитами; шаблоны выпуска не блокируют начало работы.
- Периодическая задача завершается и возвращается в работу напрямую; файл и отчёт остаются необязательными.
- Поиск открывает точный рабочий объект и восстанавливает контекст возврата.
- Персонализация соблюдает приоритет saved/explicit/domain-derived и предоставляет learning/reset/safe-pin controls.
- Частая календарная форма сокращена; `календарь → план` продолжает 0/1/N планов без повторного ввода даты.
- Детерминированный profile layer расширяет базовый parser протокола, сохраняя machine evidence и manual correction precedence. Реальная двухдокументная приёмка профиля остаётся в #326.
- Полный project CI выполняется один раз на PR; после merge выполняется только smoke. GRACE и тяжёлые gates выбираются по риску.

## Full offline и OCR

Full bundle собирает application runtime, managed Node.js/CPython и air-gap closure для `unzip`, Poppler, Tesseract `rus+eng`, LibreOffice и шрифтов. Target package policy additive-only: ставятся только отсутствующие возможности, без принудительного upgrade/downgrade/remove, без target version pins и без автоматического `apt --fix-broken`.

До переключения `/opt/kafedra-planner/current` выполняются full preflight и реальный `ocr.py doctor --languages rus+eng --self-test`. Ошибка PDF/OCR/Office runtime блокирует активацию нового release. После установки `doctor.sh` проверяет уже активный runtime.

## Сохранность данных

SQLite schema остаётся `31`. Применённые migrations, blobs, SHA-256, `document_version`, source rows и evidence неизменяемы. Ручное рабочее значение не уничтожает machine result. Backup/restore и forced-failure rollback остаются частью release evidence.

## Выпуск

Один version-neutral workflow `Release` запускается только от exact текущего `main`. Project/unit/smoke/backup и critical browser выполняются по одному разу. Затем full offline bundle собирается ровно один раз. Именно этот archive проходит checksum, Debian 12 systemd clean install, repeated update, legacy upgrade и forced rollback. Project Control и семь GitHub Release assets формируются из уже проверенного archive без пересборки.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27 и не подменяется CI. Реальная двухдокументная приёмка reusable protocol profile остаётся в issue #326 и не подменяется синтетическими fixtures.
