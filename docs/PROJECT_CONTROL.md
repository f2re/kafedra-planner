# Project Control

`kafedra-planner` подключается к F2RE Project Control как внешний deployment adapter. Существующий `full-airgap-v2 / additive-only-v2`, системный package gate, backup/restore, migration, systemd и rollback не переносятся в контроллер и не ослабляются.

## Сборка для контроллера

На reference-машине той же Astra/Debian версии и архитектуры:

```bash
./scripts/offline/build-project-control-bundle.sh \
  --output release
```

Сценарий сначала запускает штатный `build-full-bundle.sh`. Только после его полного успеха готовый native TAR.GZ оборачивается в:

```text
kafedra-planner-<version>-project-control.f2re.zip
kafedra-planner-<version>-project-control.f2re.zip.sha256
```

Native archive, `release.json`, `deployment.json`, `manifest.sha256`, Node/Python runtime и air-gap `.deb` closure остаются неизменными. Wrapper содержит `projectId=kafedra-planner`, `adapter=kafedra-planner-v1`, source commit и SHA-256 native payload.

В Project Control файл `*.f2re.zip` перетаскивается на карточку «Кафедра Planner». После проверки wrapper контроллер вызывает только allowlisted native `install.sh`; тот самостоятельно выполняет package preflight, backup, migration, atomic release switch, запуск API/worker/LLM и rollback при ошибке. После возврата контроллер дополнительно требует совпадения активного `VERSION`, зелёного systemd и `/api/system/health`.

Для криптографической аутентификации release задайте на build-машине `F2RE_RELEASE_SIGNING_KEY=/secure/release-ed25519-private.pem`; на target хранится только соответствующий public key.
