# GitHub Releases и offline bundle

Каждый GitHub Release содержит проверенный **обычный full offline bundle** для
указанного Debian 12 `amd64` profile. Это готовый для скачивания комплект, а не
исходный архив GitHub. LLM/`llama.cpp` и GGUF намеренно не публикуются: их
лицензии, размер и выбор модели зависят от организации. При необходимости
соберите такой вариант по [LLAMA_OFFLINE_DEPLOYMENT.md](LLAMA_OFFLINE_DEPLOYMENT.md).

## Скачать и проверить

1. Откройте страницу [Releases](https://github.com/f2re/kafedra-planner/releases) и выберите нужный prerelease.
2. Скачайте в один каталог четыре файла:

   ```text
   kafedra-planner-<version>-debian-12-amd64.tar.gz
   kafedra-planner-<...>.tar.gz.sha256
   install-kafedra-planner.sh
   README-INSTALL.txt
   ```

3. До установки проверьте checksum:

   ```bash
   sha256sum -c --strict kafedra-planner-*.tar.gz.sha256
   ```

4. На совместимой target-машине запустите штатный wrapper:

   ```bash
   sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
   ```

Wrapper дополнительно сверяет внешний SHA-256, внутренний manifest, runtime и
OS profile. Не распаковывайте archive и не запускайте его внутренний
`install.sh` вручную.

## Совместимость и обновление

Выпущенный bundle предназначен для Debian 12 `amd64`. Для Astra Linux, другой
архитектуры или другой серии ОС соберите bundle на совместимой reference-машине:

```bash
npm run bundle:offline
```

Повторный запуск wrapper — штатное обновление: перед изменением он создаёт и
проверяет backup, выполняет миграции, делает health-check и при ошибке
автоматически возвращает прежний release/data state. Полный контракт описан в
[OFFLINE_INSTALL.md](OFFLINE_INSTALL.md) и [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Как создаётся GitHub Release

Workflow [Publish offline release](../.github/workflows/release.yml) запускается
только по exact tag `v<значение VERSION>`, который уже вошёл в `main`. Он
повторно выполняет quality/backup проверки, собирает full bundle внутри Debian
12, проверяет archive и его SHA-256, затем прикрепляет четыре файла к GitHub
Release. Выпуск текущей линии помечается как **prerelease**: зелёный CI не
заменяет реальную Astra/Debian приёмку из [TARGET_ACCEPTANCE.md](TARGET_ACCEPTANCE.md)
и issue #27.
