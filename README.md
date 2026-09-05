# Кафедра Planner

[Русский](README.md) · [English](README.en.md)

[![Проверка](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/ci.yml)
[![Release](https://github.com/f2re/kafedra-planner/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/f2re/kafedra-planner/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/f2re/kafedra-planner?display_name=tag&sort=semver)](https://github.com/f2re/kafedra-planner/releases)
[![Лицензия MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Автономная система повседневной работы кафедры: документы, календарь, годовые планы, задачи, заседания, `План / факт`, научная деятельность, учебные ведомости и проверяемые доказательства.

> Текущий рубеж: **`0.4.2`**, схема SQLite **31**. Основные пользовательские сценарии работают без обязательного Интернета, Docker, LLM, Оформлятора и облачных сервисов. До stable остаётся фактическая эксплуатационная приёмка Astra Linux/Debian по [`docs/TARGET_ACCEPTANCE.md`](docs/TARGET_ACCEPTANCE.md) и issue #27.

Patch release `0.4.2` упрощает интеграцию с Оформлятором до одного вставляемого адреса, поддерживает актуальный `/readyz`, сохраняет частично успешный импорт, запускает обновление из обычной пользовательской папки и не оставляет старый нефингерпринтованный интерфейс в browser/proxy cache.

**[Скачать опубликованный offline bundle](https://github.com/f2re/kafedra-planner/releases)** · **[Установить на Debian/Astra](docs/GITHUB_RELEASES.md)** · **[Открыть документацию](#эксплуатация-и-документация)** · **[Сообщить об уязвимости](SECURITY.md)**

GitHub Release и его assets неизменяемы. Повторная установка того же `v0.4.1` не могла получить код, добавленный позже: старый тег и старый bundle остаются прежними. Для нового интерфейса и новой интеграции требуется отдельный `v0.4.2`.

## Основной принцип

```text
исходный документ / ручной ввод
              ↓
      рабочий план / заседание / задача
              ↓
 календарь · поиск · План / факт
              ↓
      редактирование и история
```

Однозначные действия выполняются автоматически, неоднозначности остаются исправимыми, а исходный файл, SHA-256, `document_version`, evidence и история не уничтожаются. Ошибка одного документа, строки или необязательной интеграции не блокирует остальные данные.

## Рабочие разделы

- **Календарь** — месяц, неделя, задачи, сроки, напоминания и происхождение записей.
- **Документы** — неизменяемые версии, локальное извлечение, OCR/preview, поиск, архив и доказательства.
- **Планы** — импорт или ручной годовой план, реальные исходные строки, задачи, календарь и безопасный архив.
- **Поручения** — несколько исполнителей, прогресс, необязательные материалы и одно действие `Выполнено`.
- **План / факт** — плановые и фактические показатели с источниками.
- **Заседания** — повестка, решения, протоколы, выписки и версии DOCX-шаблонов.
- **Наука** и **Учебный процесс** — реестры, отчёты и ведомости с доказуемыми исходными ячейками.
- **Настройки** — PIN, стартовый календарь, структура кафедры и подключение Оформлятора.

![Календарь кафедры](docs/screenshots/calendar.webp)

![Годовой план кафедры](docs/screenshots/annual-plan.webp)

![Задачи по плану](docs/screenshots/plan-tasks.webp)

![План / факт кафедры](docs/screenshots/department-plan-fact.webp)

![Заседание кафедры](docs/screenshots/meeting.webp)

## Импорт сотрудников из Оформлятора

Откройте **Настройки → Структура кафедры → Импорт из Оформлятора**. В поле **Адрес Оформлятора** вставьте адрес, который открывается в браузере, например:

```text
http://192.168.1.50:8080
https://docomator.local
http://[fd00::25]:8080/api/v1
```

Отдельно выбирать протокол, порт или версию API не нужно. Известные окончания `/api/v1`, `/healthz`, `/readyz` и `/api/v1/system/*` автоматически приводятся к адресу сервиса. Логин, пароль, query, fragment и посторонний path отклоняются до сетевого запроса.

Нажмите **Подключить**, при необходимости введите четырёхзначный код Оформлятора, выберите пространство, группу и переносимые поля, проверьте краткий список ФИО и нажмите **Импортировать сотрудников**. Код используется только в текущем запросе и не сохраняется.

Planner обращается к Оформлятору со своей серверной машины, а не из браузера. Поэтому имя должно разрешаться именно на сервере Planner. При отсутствии локального DNS можно сразу вставить IP-адрес. Проверка различает DNS, отказ порта, timeout, TLS, чужой HTTP-сервис, неготовую базу, неверный код и несовместимый API.

Повторная синхронизация идемпотентна по remote employee id. Ошибка одной удалённой записи учитывается как пропуск и не отменяет успешно импортированных сотрудников. Локальные планы, задачи, материалы, назначения и история не удаляются; недоступность Оформлятора не блокирует ручной справочник.

Подробно: [`docs/DOCOMATOR_PEOPLE_IMPORT.md`](docs/DOCOMATOR_PEOPLE_IMPORT.md).

## Планы, задачи и заседания

План кафедры, факультета, подразделения, организации или сотрудника можно импортировать из DOCX, ODT, XLSX, ODS, PDF или текста либо создать вручную. Исходные строки, ячейки и локаторы сохраняются. Одну строку можно разложить на несколько задач с собственными сроками и исполнителями.

Если ФИО точно совпало с единственным активным сотрудником, система создаёт связанную задачу. Неоднозначное имя не угадывается. `Выполнено` сразу синхронизирует задачу, пункт плана, календарь и `План / факт`; отчётный файл и подтверждение руководителем не обязательны.

Заседание существует до итогового файла. Повестка и решения редактируются как рабочие данные, а протокол или выписка формируются по точной версии DOCX-шаблона и регистрируются в обычном неизменяемом контуре документов.

Подробно: [`docs/PLANS.md`](docs/PLANS.md), [`docs/SIMPLE_COMPLETION.md`](docs/SIMPLE_COMPLETION.md), [`docs/MEETINGS.md`](docs/MEETINGS.md).

## Установка и обновление

На целевой машине не требуются `npm install` или `pip install`. Скачайте обязательные файлы одного GitHub Release в любую обычную читаемую папку пользователя и запустите wrapper:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Владельцем папки загрузки и исходного архива не должен быть `root`. Wrapper проверяет внешний SHA-256 и внутренний manifest, извлекает bundle в приватный root staging, создаёт и проверяет резервную копию, атомарно переключает `/opt/kafedra-planner/current` и выполняет rollback при ошибке.

Граница прав намеренная:

- установленный исполняемый release в `/opt/kafedra-planner/releases` принадлежит `root:root` и недоступен для записи службе;
- конфигурация в `/etc/kafedra-planner` доступна только root и группе службы;
- рабочие данные в `/var/lib/kafedra-planner` принадлежат `kafedra-planner:kafedra-planner`;
- исходная пользовательская папка остаётся без `chown`.

После обновления installer сверяет активные обязательные UI-файлы с выбранным bundle. Статические HTML/JS/CSS выдаются с `Cache-Control: no-store`, поэтому старый сайт не должен пережить успешное переключение release. После установки браузер достаточно один раз перезагрузить.

Проверка установленной версии:

```bash
cat /opt/kafedra-planner/current/VERSION
readlink -f /opt/kafedra-planner/current
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
```

Подробно: [`docs/GITHUB_RELEASES.md`](docs/GITHUB_RELEASES.md), [`docs/OFFLINE_INSTALL.md`](docs/OFFLINE_INSTALL.md), [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md).

## Перезапуск Planner

Перезапуск рабочего ядра:

```bash
sudo systemctl restart kafedra-planner-api.service kafedra-planner-worker.service
```

Статус и последние сообщения:

```bash
sudo systemctl status --no-pager -l kafedra-planner-api.service kafedra-planner-worker.service
sudo journalctl -u kafedra-planner-api.service -u kafedra-planner-worker.service -n 100 --no-pager
```

`kafedra-planner-llama.service` перезапускается отдельно только при использовании управляемой локальной LLM:

```bash
sudo systemctl restart kafedra-planner-llama.service
```

## Разработка и проверка

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run docs:check
npm test
npm run smoke
npm run test:browser:plans
npm run test:browser:core
npm run test:browser:academic
npm run test:browser:release
```

Обычный GitHub CI выполняет только locked install, check, docs, unit/integration и smoke. Targeted Playwright запускается для затронутого UI-сценария. Полный browser, backup/restore и offline/systemd install-update-rollback относятся только к профильному риск-контуру или к явному ручному запуску workflow `Release`; обычный merge их не запускает.

## Эксплуатация и документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — слои и инварианты.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — текущий рубеж и следующие этапы.
- [`docs/UX_FLOWS.md`](docs/UX_FLOWS.md) — пользовательские сценарии.
- [`docs/DOCOMATOR_PEOPLE_IMPORT.md`](docs/DOCOMATOR_PEOPLE_IMPORT.md) — подключение Оформлятора.
- [`docs/TARGET_ACCEPTANCE.md`](docs/TARGET_ACCEPTANCE.md) — целевая Astra/Debian-приёмка.
- [`docs/RELEASE_CANDIDATE.md`](docs/RELEASE_CANDIDATE.md) — текущий release candidate.
- [`SECURITY.md`](SECURITY.md) — политика безопасности.

Интерфейс и основная эксплуатационная документация ведутся на русском языке.
