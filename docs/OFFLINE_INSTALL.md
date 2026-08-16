# Полная автономная поставка Kafedra Planner

## Нормальный сценарий

`npm run bundle:offline` собирает полный target-specific комплект для Debian/Astra Linux той же версии и архитектуры, что целевой сервер:

```bash
npm run bundle:offline
```

Результат в `release/`:

```text
kafedra-planner-<version>-<os>-<version>-<arch>.tar.gz
kafedra-planner-<...>.tar.gz.sha256
install-kafedra-planner.sh
README-INSTALL.txt
```

На целевой машине установка и обновление выполняются одной командой:

```bash
sudo ./install-kafedra-planner.sh
```

Интернет не является обязательным: если штатные APT sources целевой ОС недоступны, установщик использует локальный repository из этого же bundle. `npm install`, `pip install` и пользовательский Python на target не выполняются.

## Что входит внутрь

Полный архив содержит:

- приложение, миграции, static UI и systemd units;
- закреплённый Node.js 24 LTS;
- managed CPython runtime для локального распознавания;
- Python OCR adapter `scripts/recognition/ocr.py`;
- автономное транзитивное `.deb`-замыкание application dependencies;
- Tesseract и языки `rus`/`eng`;
- Poppler (`pdftotext`, `pdftoppm`);
- LibreOffice Writer/Calc/Core;
- шрифты для предсказуемого офисного preview;
- `release.json`, `deployment.json`, внутренний manifest и внешний SHA-256.

Базовые компоненты самой ОС (`systemd`, `coreutils`, `util-linux`, `passwd`, `tar`) больше не являются верхнеуровневыми пакетами приложения. Installer предполагает штатную Debian/Astra систему и не должен обновлять её базовый userspace только ради Kafedra Planner. Отдельные базовые `.deb` могут присутствовать в полном fallback-замыкании как транзитивные зависимости, но APT не запрашивает их по версии и использует уже установленные совместимые пакеты target-системы.

## Главное правило APT: никаких `package=version`

`config/offline/os-packages.txt` содержит только имена требуемых возможностей. Ни сборщик, ни installer не формируют команды вида:

```text
package=1.2.3-...
```

Версии в `packages.tsv` — только inventory для проверки SHA-256 и доказательства того, что именно лежит внутри offline fallback. Это не lock-файл установки.

Когда full preflight показывает, что OCR/PDF/Office компонентов не хватает, `install-os-packages.sh` работает в режиме `auto`:

1. проверяет `dpkg --audit`; если package database уже повреждена, останавливается до любых изменений;
2. выполняет обычный `apt-get --simulate ... install <имена пакетов>` со штатными sources целевой ОС;
3. если plan разрешается, сначала выполняет `--download-only`, то есть скачивает весь набор до изменения dpkg;
4. только после успешной загрузки выполняет обычный `apt-get install <имена пакетов>`;
5. если plan или загрузка невозможны, а dpkg ещё не изменялся, автоматически переключается на bundled `file:` repository;
6. после установки повторно выполняет `dpkg --audit`, full preflight и OCR doctor.

Установщик **никогда автоматически не запускает** `apt --fix-broken`/`apt-get --fix-broken`. Если package database была повреждена до запуска или реальная установка уже начала менять dpkg и завершилась ошибкой, процесс останавливается с диагностикой вместо попытки скрыть проблему вторым изменением системы.

## Явные режимы

Обычный режим выбирать не требуется:

```bash
sudo ./install-kafedra-planner.sh
```

Для гарантированно air-gap установки можно запретить использование штатных sources:

```bash
sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
```

Для диагностики администратора можно, наоборот, проверить только штатный APT:

```bash
sudo KAFEDRA_APT_MODE=system ./install-kafedra-planner.sh
```

Допустимые значения `KAFEDRA_APT_MODE`: `auto`, `system`, `bundle`.

## Почему bundle всё ещё привязан к ОС

`.deb` нельзя безопасно считать универсальными между Debian 12, Astra 1.7, Astra 1.8 и другими выпусками. Поэтому offline fallback хранит профиль:

- OS family и `ID`;
- `VERSION_ID`;
- Debian architecture;
- inventory package/version/architecture/SHA-256.

Профиль нужен для совместимости самого fallback-слоя. Он не означает pinning package versions при нормальной установке. Для каждой реально поддерживаемой целевой ОС строится собственный artifact на эталонной VM этой ОС.

## Как собираются системные пакеты

`scripts/offline/collect-os-packages.sh` запускает APT без выражений `package=version` и скачивает полное транзитивное замыкание текущих APT candidates reference-системы. В набор записываются:

```text
manifest.sha256
packages.tsv
requested-packages.txt
source-os.env
*.deb
```

Перед упаковкой проверяются контрольные суммы, inventory, architecture, наличие каждого requested package и отсутствие двух версий одного package.

Release-сборка больше не переиспользует старый OS package cache молча. По умолчанию package layer собирается заново из текущих APT indexes:

```bash
npm run bundle:offline
```

Если перед сборкой требуется обновить indexes:

```bash
sudo npm run bundle:offline -- --apt-update
```

Повторное использование заранее подготовленного cache разрешается только явно:

```bash
npm run bundle:offline -- --reuse-os-packages
```

При этом `requested-packages.txt` cache обязан в точности совпадать с текущим `config/offline/os-packages.txt`; иначе сборка останавливается.

## Полностью отключённая сборочная машина

Для air-gapped reference VM заранее передайте подготовленные runtime/cache и явно разрешите reuse:

```bash
KAFEDRA_PYTHON_RUNTIME_DIR=/srv/kafedra-cache/python \
KAFEDRA_OS_PACKAGES_DIR=/srv/kafedra-cache/os-packages \
NODE_RUNTIME_DIR=/srv/kafedra-cache/node \
npm run bundle:offline -- --reuse-os-packages
```

Каждый слой всё равно проходит contract verification.

## Что делает installer

`sudo ./install-kafedra-planner.sh` последовательно:

1. проверяет внешний SHA-256 и безопасно распаковывает archive;
2. проверяет полный внутренний `manifest.sha256`;
3. проверяет Node runtime, `deployment.json`, managed Python и OS profile;
4. проверяет текущие OCR/PDF/Office capabilities;
5. если они уже готовы — не трогает APT;
6. иначе устанавливает требуемые **имена** пакетов: штатный APT target-системы → безопасный offline fallback;
7. повторно проверяет Tesseract, `rus+eng`, Poppler, LibreOffice и Python;
8. создаёт immutable release через staging + atomic rename;
9. сохраняет существующий config/data и перед update делает проверенный backup;
10. атомарно переключает `current` и выполняет миграции;
11. на чистой системе автоматически создаёт `admin` со случайным временным паролем и обязательной сменой пароля;
12. сохраняет первый пароль только в `/root/kafedra-planner-first-login.txt` с mode `0600`;
13. включает API и worker;
14. проверяет обе службы, HTTP health и полный offline doctor;
15. при ошибке приложения возвращает прежний release/data/systemd state.

Новый full deployment слушает `0.0.0.0:8080`, поэтому приложение доступно из локальной сети без обязательного nginx.

## Обновление

Тот же installer используется и для обновления:

```bash
sudo ./install-kafedra-planner.sh
```

Системный package layer не трогается при каждом update: если full preflight и OCR doctor уже зелёные, APT шаг полностью пропускается.

## Конфигурация установки

Штатный package deployment намеренно использует один предсказуемый контур хранения:

```text
приложение: /opt/kafedra-planner/current
данные:     /var/lib/kafedra-planner
SQLite:     /var/lib/kafedra-planner/kafedra-planner.sqlite3
backup:     /var/backups/kafedra-planner
config:     /etc/kafedra-planner/kafedra-planner.env
```

`kafedra-planner.env` — **файл данных, а не shell-скрипт**. Installer не выполняет его через `source` или `eval`; конструкции `$()`, backticks, `;` и `#` внутри значения остаются обычными символами. Поддерживается простой однострочный формат `KAFEDRA_NAME=value`, а всё значение можно целиком заключить в одинарные или двойные кавычки. Повторяющиеся переменные, чужие имена без префикса `KAFEDRA_`, незакрытые кавычки и многострочные значения считаются ошибкой конфигурации.

Параметры SMTP, Telegram, уведомлений, OCR и другие прикладные настройки можно менять в этом файле. Пять путей package deployment (`KAFEDRA_DATA_DIR`, `KAFEDRA_DATABASE_PATH`, `KAFEDRA_APPLICATION_DIR`, `KAFEDRA_CONFIG_PATH`, `KAFEDRA_BACKUP_DIR`) должны оставаться стандартными. Это сознательное ограничение: systemd hardening и автоматический rollback рассчитаны на эти каталоги. Если существующая установка содержит другие значения, updater **останавливается до остановки служб, backup, миграции и переключения `current`**, а не пытается угадать, какую БД считать рабочей.

Такое поведение делает обновление повторяемым: одна и та же конфигурация используется для проверки, backup/migrate, запуска systemd и health-check, а конфликт путей превращается в явную административную ошибку вместо риска работы с другой базой.

## Диагностика после установки

```bash
sudo /opt/kafedra-planner/current/scripts/offline/doctor.sh
systemctl status kafedra-planner-api kafedra-planner-worker --no-pager -l
```

Файл первого входа создаётся только если в базе ещё нет активного администратора:

```bash
sudo cat /root/kafedra-planner-first-login.txt
```

## Runtime-only bundle

Для инженерной диагностики сохранён компактный профиль:

```bash
npm run bundle:offline:runtime
```

Он содержит приложение + Node.js, но не является полной поставкой целевой ОС: managed Python и `.deb` fallback в нём отсутствуют. Для эксплуатационной установки используется `npm run bundle:offline`.
