# Release candidate 0.4.8

## Статус

`0.4.8` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Изменения после `0.4.7` относятся к прикладному ассистенту кафедры, проверке и настройке LLM в интерфейсе и исправлению сборки пакетов для Astra Linux. Новая SQLite migration не добавляется. Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны для production.

## Что изменено в 0.4.8

- Добавлен прикладной модуль «Ассистент кафедры» (`Alt+A`) для структурирования таблиц, поиска по архиву и составления формул Calc/Excel.
- Добавлен режим поиска пропусков и устранения ошибок (`gap-repair`) с верификацией цитат-источников.
- Реализована проверка доступности LLM в реальном времени и настройка подключения прямо из браузера (`data/llm-settings.json`).
- Исправлена сборка офлайн-бандла для Astra Linux 1.7 (устранена ошибка блокировки `apt-get check` без root).
- Нормализован preflight для обнаружения системных утилит в `/usr/sbin` и `/sbin`.

Описание выпуска: [`releases/0.4.8.md`](releases/0.4.8.md). Контракты: [`LLM_ASSISTANT_TOOLS.md`](LLM_ASSISTANT_TOOLS.md).

## Full offline и OCR

Каждый target bundle содержит приложение, managed Node.js/CPython и air-gap closure для `unzip`, Poppler, Tesseract `rus+eng`, LibreOffice и шрифтов. Target package policy additive-only: ставятся только отсутствующие возможности, без принудительного upgrade/downgrade/remove, без target version pins и без автоматического `apt --fix-broken`.

До переключения `/opt/kafedra-planner/current` выполняются full preflight и реальный `ocr.py doctor --languages rus+eng --self-test`. Ошибка PDF/OCR/Office runtime блокирует активацию нового release. После установки `doctor.sh` проверяет уже активный runtime.

## Сохранность данных

SQLite schema остаётся `31`. Применённые migrations, blobs, SHA-256, `document_version`, source rows и evidence неизменяемы. Ручное рабочее значение не уничтожает machine result. Backup/restore и forced-failure rollback остаются частью release evidence.

## Выпуск

Один version-neutral workflow `Release` запускается только от exact текущего `main`. Project/unit/smoke/backup и critical browser выполняются по одному разу; отдельный smoke проверяет минимальный Node.js `24.15.0`. Для каждой из трёх ОС archive собирается один раз. Astra UBI проверяет пакетный слой и OCR/Office; Debian 12 — systemd clean install, repeated update, legacy layout и обновление предыдущего опубликованного выпуска с forced rollback. Из тех же архивов создаются Project Control packages; публикуются 15 файлов, включая контрольные суммы, без пересборки.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27 и не подменяется CI или UBI. Реальная двухдокументная приёмка reusable protocol profile остаётся в issue #326 и не подменяется синтетическими fixtures. Полезность конкретной ЛЛМ и скорость на целевом CPU проверяются на реальном обезличенном корпусе отдельно от тестов интеграции. Пользователь проверяет реальные документы после установки опубликованного patch-релиза; предварительная пользовательская приёмка не требуется для публикации `0.4.7`.
