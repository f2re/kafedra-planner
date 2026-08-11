# Аудит полного offline deployment

Дата: 2026-08-11.

## Почему прежняя поставка была неполной

Предыдущий `kafedra-planner` bundle решал только одну часть задачи — приложение со встроенным Node.js. На целевой машине оставались внешние предположения: Tesseract, русский language pack, Poppler, LibreOffice и первый администратор. Python runtime вообще отсутствовал, потому что OCR был реализован как прямой запуск системного `tesseract` из Node.js.

Отдельный дефект deployment находился в `loadConfig()`: `migrationsDir` и `publicDir` вычислялись от текущего working directory процесса. Systemd маскировал это `WorkingDirectory=/opt/kafedra-planner/current`, но installer запускает migration script из распакованного bundle. Поэтому на target он мог искать `./migrations` не в новом release и падать до запуска службы.

## Что взято из Docomator

Из `docomator` перенесён принцип target-specific full bundle:

- сборка на reference Debian/Astra той же версии;
- полное APT dependency closure, а не список «установите сами»;
- metadata целевой ОС и package inventory;
- строгая проверка closure;
- установка через локальные `.deb` с запретом network download;
- один installer для install/update.

## Что взято из «Бориса по парам»

Из `planer-solving` перенесён принцип managed Python runtime:

- Python runtime принадлежит приложению, а не пользовательскому shell;
- systemd не зависит от pyenv/venv/home пользователя;
- runtime экспортируется вместе со stdlib и необходимыми shared libraries;
- target не выполняет `pip install`;
- Python проходит probe до активации release.

В Kafedra Planner wheelhouse пока не нужен: OCR adapter использует только Python stdlib, а Tesseract/Poppler поставляются `.deb`. Если появятся реальные Python runtime dependencies, к этому слою можно добавить wheelhouse без изменения install flow.

## Новый контракт

Полный bundle имеет три runtime-layer:

```text
application/       код и миграции
runtime/node/      Node.js 24 LTS
runtime/python/    managed CPython
os-packages/       exact Debian/Astra .deb closure
```

`deployment.json` связывает Python runtime и OS package profile с архивом. `manifest.sha256` защищает каждый файл.

Нормальная эксплуатационная команда теперь одна:

```bash
sudo ./install-kafedra-planner.sh
```

Installer не спрашивает путь к Python, не просит вручную установить OCR, не требует npm/pip и не требует ручного создания первого admin.

## Автоматические проверки

CI дополнен отдельным Debian 12 acceptance layer. Он:

- собирает full bundle внутри `node:24-bookworm`;
- собирает полный `.deb` closure;
- устанавливает его с `apt-get --no-download`;
- проверяет Tesseract `rus+eng`, Poppler, LibreOffice и managed Python;
- запускает migration/admin scripts из `/tmp`, чтобы cwd больше не мог маскировать ошибку;
- вручную поднимает API+worker в контейнере и проверяет HTTP health;
- публикует full artifact только после этих проверок.
