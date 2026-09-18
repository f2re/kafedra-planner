# Release candidate 0.4.6

## Статус

`0.4.6` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Изменения после `0.4.5` относятся к поставке для Astra Linux и проверке обновления. Новая SQLite migration не добавляется. Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны для production.

## Что изменено в 0.4.6

- Отдельные полные архивы для Debian 12, Astra Linux 1.7 и Astra Linux 1.8, архитектура `amd64`; пакетный слой каждой ОС собран в соответствующей эталонной среде.
- Общий установщик выбирает единственный совместимый архив по встроенному профилю и отклоняет отсутствие или неоднозначность выбора до изменения системы.
- Astra UBI проверяется с отключённой сетью, явным shell entrypoint, сохранением ошибок и реальным OCR/PDF/Office roundtrip.
- Проверка обновления задаёт PIN в установленной базе и не скрывает ошибку подготовки.
- Штатный выпуск проверяет обновление с предыдущего опубликованного Debian-архива, отказ нового worker после активации и восстановление прежнего выпуска, PIN, конфигурации и контрольного файла.

Описание выпуска: [`releases/0.4.6.md`](releases/0.4.6.md). Изменения заседаний и массового импорта из `0.4.5` сохранены: [`releases/0.4.5.md`](releases/0.4.5.md), [`PROTOCOL_IMPORT.md`](PROTOCOL_IMPORT.md).

## Full offline и OCR

Каждый target bundle содержит приложение, managed Node.js/CPython и air-gap closure для `unzip`, Poppler, Tesseract `rus+eng`, LibreOffice и шрифтов. Target package policy additive-only: ставятся только отсутствующие возможности, без принудительного upgrade/downgrade/remove, без target version pins и без автоматического `apt --fix-broken`.

До переключения `/opt/kafedra-planner/current` выполняются full preflight и реальный `ocr.py doctor --languages rus+eng --self-test`. Ошибка PDF/OCR/Office runtime блокирует активацию нового release. После установки `doctor.sh` проверяет уже активный runtime.

## Сохранность данных

SQLite schema остаётся `31`. Применённые migrations, blobs, SHA-256, `document_version`, source rows и evidence неизменяемы. Ручное рабочее значение не уничтожает machine result. Backup/restore и forced-failure rollback остаются частью release evidence.

## Выпуск

Один version-neutral workflow `Release` запускается только от exact текущего `main`. Project/unit/smoke/backup и critical browser выполняются по одному разу; отдельный smoke проверяет минимальный Node.js `24.15.0`. Для каждой из трёх ОС archive собирается один раз. Astra UBI проверяет пакетный слой и OCR/Office; Debian 12 — systemd clean install, repeated update, legacy layout и обновление предыдущего опубликованного выпуска с forced rollback. Из тех же архивов создаются Project Control packages; публикуются 15 файлов, включая контрольные суммы, без пересборки.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27 и не подменяется CI или UBI. Реальная двухдокументная приёмка reusable protocol profile остаётся в issue #326 и не подменяется синтетическими fixtures. Пользователь проверяет реальные документы после установки опубликованного patch-релиза; предварительная пользовательская приёмка не требуется для публикации `0.4.6`.
