# Release candidate 0.4.9

## Статус

`0.4.9` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Изменения после `0.4.8` относятся к автоматическому фоновому подбору решений в проверке данных, усвоению нераспознанных протоколов, прямому dpkg fallback для надёжной установки OCR в Astra Linux при зафиксированных версиях пакетов и специализированным профилям ассистента кафедры. Новая SQLite migration не добавляется. Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны для production.

## Что изменено в 0.4.9

- Автоматический подбор решений ИИ в «Проверке данных» с фоновыми запросами и кнопкой «✨ Подобрать через ИИ для всех».
- Доступ к исходному файлу и фрагменту распознанного текста прямо из карточки замечания.
- Ручное усвоение и массовый ввод реквизитов для нераспознанных сканов протоколов заседания без тупиковых состояний.
- Прямой `dpkg -i` fallback в установщике пакетов ОС для гарантированной установки Tesseract и Poppler при зафиксированных версиях библиотек.
- Профили ассистента: поиск, протокольный анализ, генерация отчётов, ненавязчивый нормоконтроль с предварительным одобрением.
- Автономный патч-бандл для обновления удалённого сервера LLM (`npm run bundle:patch:llm`).

Описание выпуска: [`releases/0.4.9.md`](releases/0.4.9.md). Контракты: [`LLM_ASSISTANT_TOOLS.md`](LLM_ASSISTANT_TOOLS.md).

## Full offline и OCR

Каждый target bundle содержит приложение, managed Node.js/CPython и air-gap closure для `unzip`, Poppler, Tesseract `rus+eng`, LibreOffice и шрифтов. Target package policy additive-only: ставятся только отсутствующие возможности, без принудительного upgrade/downgrade/remove, без target version pins и без автоматического `apt --fix-broken`.

До переключения `/opt/kafedra-planner/current` выполняются full preflight и реальный `ocr.py doctor --languages rus+eng --self-test`. Ошибка PDF/OCR/Office runtime блокирует активацию нового release. После установки `doctor.sh` проверяет уже активный runtime.

## Сохранность данных

SQLite schema остаётся `31`. Применённые migrations, blobs, SHA-256, `document_version`, source rows и evidence неизменяемы. Ручное рабочее значение не уничтожает machine result. Backup/restore и forced-failure rollback остаются частью release evidence.

## Выпуск

Один version-neutral workflow `Release` запускается только от exact текущего `main`. Project/unit/smoke/backup и critical browser выполняются по одному разу; отдельный smoke проверяет минимальный Node.js `24.15.0`. Для каждой из трёх ОС archive собирается один раз. Astra UBI проверяет пакетный слой и OCR/Office; Debian 12 — systemd clean install, repeated update, legacy layout и обновление предыдущего опубликованного выпуска с forced rollback. Из тех же архивов создаются Project Control packages; публикуются 15 файлов, включая контрольные суммы, без пересборки.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27 и не подменяется CI или UBI. Реальная двухдокументная приёмка reusable protocol profile остаётся в issue #326 и не подменяется синтетическими fixtures. Полезность конкретной ЛЛМ и скорость на целевом CPU проверяются на реальном обезличенном корпусе отдельно от тестов интеграции. Пользователь проверяет реальные документы после установки опубликованного patch-релиза; предварительная пользовательская приёмка не требуется для публикации `0.4.7`.
