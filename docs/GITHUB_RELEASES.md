# GitHub Releases и offline bundle

Каждый новый GitHub Release собирается из точного commit `main`. Публикуются отдельные полные автономные комплекты для поддерживаемых серий ОС, а не один Debian-архив, переиспользуемый на Astra Linux.

LLM/`llama.cpp` и GGUF намеренно не входят в стандартный выпуск: их лицензии, размер и выбор модели зависят от организации. При необходимости такой вариант собирается отдельно по [LLAMA_OFFLINE_DEPLOYMENT.md](LLAMA_OFFLINE_DEPLOYMENT.md).

## Какие комплекты публикуются

Для `amd64` один и тот же exact SHA выпуска проходит три независимые сборки:

- Debian 12;
- Astra Linux Special Edition 1.7;
- Astra Linux Special Edition 1.8.

Каждый archive содержит собственное `.deb`-замыкание `full-airgap-v2 / additive-only-v2`, собранное только в matching reference environment. Debian-пакеты не переименовываются в Astra и не используются как fallback для другой серии ОС.

В каждом target archive находятся приложение, встроенный Node.js, managed Python и системные компоненты обработки документов: Tesseract с `rus`/`eng`, Poppler, LibreOffice и шрифты. После установки проверенный пакетный слой сохраняется в installer-owned cache и доступен `doctor.sh --repair` без исходной флешки или каталога установки.

## Скачать и проверить

1. Откройте страницу [Releases](https://github.com/f2re/kafedra-planner/releases) и выберите нужную версию.
2. Скачайте в один каталог:

   ```text
   kafedra-planner-<version>-<profile>.tar.gz
   kafedra-planner-<version>-<profile>.tar.gz.sha256
   install-kafedra-planner.sh
   README-INSTALL.txt
   ```

3. Проверьте archive:

   ```bash
   sha256sum -c --strict kafedra-planner-<version>-<profile>.tar.gz.sha256
   ```

   Если скачан полный набор assets выпуска, можно дополнительно проверить общий `SHA256SUMS`.

4. До изменения системы можно проверить, какой archive выберет wrapper:

   ```bash
   ./install-kafedra-planner.sh --print-selection
   ```

5. Установите или обновите:

   ```bash
   sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
   ```

Если рядом лежат несколько target archives, wrapper читает встроенный `os-packages/source-os.env` и выбирает ровно один совместимый по family, series и architecture. При отсутствии подходящего archive или при неоднозначности установка завершается до package transaction, остановки служб, миграций и переключения `current`.

Явно переданный несовместимый archive также блокируется внутренней проверкой target profile. Не распаковывайте archive и не запускайте внутренний `install.sh` вручную.

## Как проверяется выпуск

Универсальный workflow [`Release`](../.github/workflows/release.yml) не создаёт отдельные version-specific workflows. Для новой версии он:

1. фиксирует exact SHA текущего `main`;
2. выполняет обычную проверку проекта и критические browser-сценарии;
3. из того же SHA один раз собирает target archive для Debian 12, Astra 1.7 и Astra 1.8;
4. проверяет manifest, `source-os.env`, architecture и package policy каждого archive;
5. на matching reference target с отключённой сетью устанавливает тот же archive через штатный wrapper;
6. проверяет API/worker, strict `doctor.sh`, Tesseract `rus+eng`, Poppler, LibreOffice, повторную установку/update и recovery-контур;
7. удаляет исходный каталог установки и проверяет `doctor.sh --repair` из сохранённого immutable package cache;
8. только после этого создаёт Project Control packages и публикует ровно уже проверенные artifacts с SHA-256.

Disposable Docker/UBI используется только как release/reference environment в CI. Production остаётся нативным `systemd`-развёртыванием без Docker и без обязательного Интернета.

Контейнерная проверка не заменяет приёмку на реальной Astra Linux с фактическими vendor revisions и рабочими документами. Порядок реальной приёмки описан в [TARGET_ACCEPTANCE.md](TARGET_ACCEPTANCE.md).

## Идемпотентность выпуска

Новый GitHub Release создаётся только после явного изменения `VERSION` на ещё не опубликованную версию. Если tag/release текущей версии уже существует и относится к допустимой истории, workflow завершается как безопасный no-op: существующий tag не передвигается, а assets не перезаписываются.

Перед публикацией workflow повторно проверяет, что `main` всё ещё указывает на тот exact SHA, для которого были собраны и проверены artifacts. Если `main` изменился, публикация запрещается.

Полный контракт установки и package safety: [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md). Резервное копирование и rollback: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
