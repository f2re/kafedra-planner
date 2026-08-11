# Полная автономная поставка Kafedra Planner

## Нормальный сценарий

`npm run bundle:offline` теперь означает **полный target-specific комплект**, а не архив исходников с Node.js.

Сборка выполняется на эталонной Debian или Astra Linux той же версии и архитектуры, что целевой сервер:

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

На целевой машине все три обязательных файла кладутся в один каталог и запускается одна команда:

```bash
sudo ./install-kafedra-planner.sh
```

Интернет на целевой машине не требуется. Установщик не задаёт вопросов конфигурации и не выполняет `npm install`/`pip install`.

## Что входит внутрь

Полный архив содержит:

- приложение, миграции, static UI и systemd units;
- закреплённый Node.js 24 LTS;
- managed CPython runtime для локального распознавания;
- Python OCR adapter `scripts/recognition/ocr.py`;
- полное транзитивное замыкание `.deb` для целевой ОС;
- Tesseract и языки `rus`/`eng`;
- Poppler (`pdftotext`, `pdftoppm`);
- LibreOffice Writer/Calc/Core;
- системные CLI, необходимые installer (`tar`, `coreutils`, `util-linux`, `passwd`, `systemd`, `unzip`);
- шрифты для предсказуемого офисного preview;
- `release.json`, `deployment.json`, внутренний manifest и внешний SHA-256.

Python не использует пакеты из пользовательского `site-packages`. В текущем OCR-контуре сторонние Python wheels не нужны: Tesseract/Poppler устанавливаются как пакеты ОС, а bundled CPython является управляемым orchestration runtime. Это устраняет зависимость от `/usr/bin/python`, venv пользователя, pyenv и сети.

## Почему bundle привязан к ОС

`.deb` нельзя безопасно считать универсальными между Debian 12, Astra 1.7, Astra 1.8 и другими выпусками. Поэтому full bundle хранит точный профиль:

- OS family и `ID`;
- `VERSION_ID`;
- Debian architecture;
- полный inventory package/version/architecture/SHA-256.

Installer откажется ставить package closure на другую ОС. Для каждой реально поддерживаемой целевой ОС строится собственный artifact на эталонной VM этой ОС.

## Как собираются системные пакеты

`config/offline/os-packages.txt` содержит только верхнеуровневые требования. `scripts/offline/collect-os-packages.sh` запускает APT с пустой package status database и `--no-install-recommends`, поэтому скачиваются не только непосредственные `.deb`, а полное транзитивное замыкание.

В набор записываются:

```text
manifest.sha256
packages.tsv
requested-packages.txt
source-os.env
*.deb
```

Перед упаковкой проверяются контрольные суммы, exact inventory, architecture, наличие каждого requested package и отсутствие двух версий одного package.

Повторная сборка использует cache. Для принудительного обновления closure:

```bash
npm run bundle:offline -- --refresh-os-packages
```

Если нужно предварительно обновить APT indexes:

```bash
sudo apt-get update
npm run bundle:offline -- --refresh-os-packages
```

## Полностью отключённая сборочная машина

Сеть нужна только для первоначального наполнения cache Node/.deb. Если эталонная VM сама air-gapped, заранее передайте:

```bash
KAFEDRA_PYTHON_RUNTIME_DIR=/srv/kafedra-cache/python \
KAFEDRA_OS_PACKAGES_DIR=/srv/kafedra-cache/os-packages \
NODE_RUNTIME_DIR=/srv/kafedra-cache/node \
npm run bundle:offline
```

Каждый переданный слой всё равно проходит тот же contract verification.

## Что делает installer

`sudo ./install-kafedra-planner.sh` последовательно:

1. проверяет внешний SHA-256 и безопасно распаковывает archive;
2. проверяет полный внутренний `manifest.sha256`;
3. проверяет Node runtime, `deployment.json`, managed Python и точный OS profile;
4. проверяет текущие OCR/PDF/Office capabilities;
5. если они уже готовы — не трогает системные пакеты;
6. иначе проверяет APT plan и устанавливает **только** `.deb` из bundle с `--no-download --no-remove`;
7. повторно проверяет Tesseract, `rus+eng`, Poppler, LibreOffice и Python;
8. создаёт immutable release через staging + atomic rename;
9. сохраняет существующий config/data и перед update делает проверенный backup;
10. атомарно переключает `current` и выполняет миграции;
11. на чистой системе автоматически создаёт `admin` со случайным временным паролем и обязательной сменой пароля;
12. сохраняет первый пароль только в `/root/kafedra-planner-first-login.txt` с mode `0600`;
13. включает API и worker;
14. проверяет обе службы, HTTP health и полный offline doctor;
15. при ошибке возвращает прежний release/data/systemd state.

Новый full deployment слушает `0.0.0.0:8080`, поэтому приложение доступно из локальной сети без обязательного nginx. Reverse proxy можно добавить отдельно, если нужен TLS/единый внешний endpoint.

## Обновление

Тот же файл installer используется и для обновления:

```bash
sudo ./install-kafedra-planner.sh
```

Semantic `VERSION` и build identity разделены, поэтому два разных commit одной RC-версии устанавливаются как разные release и могут быть откатаны независимо.

Системный package layer не переустанавливается при каждом update: если full preflight и OCR doctor уже зелёные, APT шаг пропускается.

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

Для инженерной диагностики сохранён старый более компактный профиль:

```bash
npm run bundle:offline:runtime
```

Он содержит приложение + Node.js, но **не является полной поставкой целевой ОС**: Python OCR runtime и `.deb` closure в нём отсутствуют. Для эксплуатационной установки используется только `npm run bundle:offline`.
