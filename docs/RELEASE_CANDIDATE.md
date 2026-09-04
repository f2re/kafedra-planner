# Release candidate 0.4.3

## Статус

`0.4.3` — текущий эксплуатационный patch release candidate, схема SQLite **31**. Выпуск добавляет пакетный импорт протоколов за выбранный год с исправлением исключений и переводит публикацию на один универсальный release pipeline. Интернет, LLM, Docker, Оформлятор и облачные сервисы не обязательны для production. Stable не объявляется до фактической приёмки Astra Linux/Debian по [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md) и issue #27.

## Что завершено в 0.4.3

- В **Заседаниях** выбирается год и одним действием загружается набор DOCX/ODT/PDF/TXT протоколов.
- Каждый файл сохраняется как immutable source до интерпретации; один плохой файл не блокирует соседние.
- После reload восстанавливается пофайловая сводка `Готово / Нужно проверить / Ошибка / Обрабатывается` без новой batch-таблицы.
- Выбранный год является intake context, а не подтверждённым фактом; дата из другого года создаёт review item и не переписывается автоматически.
- Протокол без текста всё равно оставляет сохранённый source и редактируемую карточку заседания.
- `Исправить` открывает точное заседание и исходный документ. Редактируются номер, дата, название, повестка, `Слушали / Обсудили / Решили`, ответственный и срок.
- Правка синхронизирует working meeting/decision/calendar/search и закрывает только устранённые исключения.
- Raw extraction result, locator/evidence, `document_version`, blob и SHA-256 не перезаписываются; manual before/after остаётся в audit/evidence history.
- Универсальный **Release gate** больше не содержит номер версии и не запускается на обычных feature PR.
- Publisher не ждёт набор других workflows и не повторяет unit/Playwright после gate. Он собирает offline bundle один раз, проверяет тот же artifact через Debian 12 systemd install/update/forced rollback и только затем публикует его.

## Сохранность данных

SQLite schema остаётся `31`, новой migration нет. Применённые migrations, исходные blobs, SHA-256, `document_version`, source rows и evidence неизменяемы. Backup/restore, `quick_check`, `foreign_key_check` и forced-failure rollback остаются частью release evidence. Ручная коррекция имеет приоритет для рабочего значения, но не уничтожает машинный результат.

## Выпуск

Release PR проходит GRACE для release/CI-инфраструктуры и обычный exact-head project CI. После squash merge универсальный **Release gate** на exact `main` выполняет полный unit/integration regression, критический desktop/mobile browser и recovery checks. Publisher один раз строит full offline artifact, проверяет clean install, repeated update и forced rollback на disposable Debian 12 systemd reference VM, строит Project Control из того же archive, формирует SHA-256 и публикует семь проверенных assets. Tag `v0.4.3` обязан указывать на тот же exact `main` SHA.

## Что остаётся до stable

Реальная эксплуатационная приёмка Astra Linux/Debian остаётся в issue #27 и не подменяется CI.
