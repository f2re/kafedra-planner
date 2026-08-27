# GitHub Releases и offline bundle

Каждый GitHub Release содержит проверенный full offline bundle, собранный из
точного post-merge commit `main`. Это готовый для скачивания комплект, а не
исходный archive GitHub. LLM/`llama.cpp` и GGUF намеренно не публикуются: их
лицензии, размер и выбор модели зависят от организации. При необходимости
соберите такой вариант по [LLAMA_OFFLINE_DEPLOYMENT.md](LLAMA_OFFLINE_DEPLOYMENT.md).

## Скачать и проверить

1. Откройте страницу [Releases](https://github.com/f2re/kafedra-planner/releases) и выберите нужную версию.
2. Скачайте в один каталог четыре обязательных файла:

   ```text
   kafedra-planner-<version>-<profile>.tar.gz
   kafedra-planner-<...>.tar.gz.sha256
   install-kafedra-planner.sh
   README-INSTALL.txt
   ```

3. Для полной проверки также скачайте `SHA256SUMS`; в него входят archive,
   wrapper, install guide и optional F2RE Project Control package. Проверьте:

   ```bash
   sha256sum -c --strict SHA256SUMS
   ```

4. На совместимой target-машине запустите штатный wrapper:

   ```bash
   sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh
   ```

Wrapper дополнительно сверяет внешний SHA-256, внутренний manifest, runtime и
OS profile. Не распаковывайте archive и не запускайте его внутренний
`install.sh` вручную.

## Совместимость и обновление

Bundle собирается в Debian 12 reference environment. Для Astra Linux, другой
архитектуры или иной серии ОС соберите bundle на совместимой reference-машине:

```bash
npm run bundle:offline
```

Повторный запуск wrapper — штатное обновление: перед изменением он создаёт и
проверяет backup, выполняет миграции, делает health-check и при ошибке
автоматически возвращает прежний release/data state. Полный контракт описан в
[OFFLINE_INSTALL.md](OFFLINE_INSTALL.md) и [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Как создаётся GitHub Release

Workflow [Публикация GitHub Release](../.github/workflows/release.yml)
запускается после успешного `Release gate` для `main`. Он сначала принимает
явное решение о выпуске:

- нового тега для текущего `VERSION` нет — дождаться остальных обязательных
  post-merge workflows того же SHA, повторно проверить проект, собрать bundle и
  опубликовать release;
- tag/release уже указывает на текущий SHA — завершить идемпотентно без
  пересборки и замены assets;
- `VERSION` не менялась, а существующий release указывает на предыдущий commit-
  предок — обычный post-release commit проходит как успешный no-op; тег и assets
  остаются неизменными;
- версия повторно использована, release потерял tag либо tag относится к другой
  истории — workflow останавливается с ошибкой.

Таким образом, каждый commit `main` проходит release gate, но новый GitHub
Release создаётся только после явного изменения `VERSION` на ещё не
опубликованную версию. Существующий tag никогда не передвигается к более новому
commit молча.

При реальной публикации workflow ждёт остальные обязательные post-merge
workflows для того же SHA, повторно проверяет исходный код и recovery path,
собирает/проверяет full bundle и Project Control package, а затем создаёт tag и
GitHub Release с контрольными суммами. Stable promotion по-прежнему требует
реальной Astra/Debian приёмки из [TARGET_ACCEPTANCE.md](TARGET_ACCEPTANCE.md) и
issue #27.
