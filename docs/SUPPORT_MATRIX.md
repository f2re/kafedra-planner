# Матрица совместимости

Для приложения поддерживается Node.js `>=24.15.0 <25`. Автономный bundle закрепляет production runtime **Node.js 24.19.0**; host Node build-машины может отличаться и в поставку автоматически не копируется.

| Профиль | Runtime/application capabilities | Автоматическая проверка | Эксплуатационная приёмка |
|---|---|---|---|
| Debian 12 x86-64 | Node 24.19 + managed CPython + target-specific `.deb` fallback | full bundle, ordinary/bundle APT paths, OCR/Office, systemd install/update, optional LLM fixture | backup/restore/rollback и реальные документы на контрольной машине |
| Astra Linux 1.7 x86-64 | тот же контракт, но bundle собирается на совместимой Astra 1.7 reference VM | contract/scripts/CI; `.deb` нельзя брать из Debian | обязательный акт на фактической целевой машине |
| Astra Linux 1.8 x86-64 | тот же контракт, но bundle собирается на совместимой Astra 1.8 reference VM | contract/scripts/CI; собственный OS profile | обязательный акт на фактической целевой машине |

Full bundle не переносит `.deb` fallback между разными `ID/VERSION_ID/architecture`: installer сравнивает профиль и прекращает установку при несовпадении.

Версии `.deb` в inventory используются для integrity/evidence самого offline repository, но target installer не формирует `package=version`. В режиме `auto` сначала используется обычный APT target-системы по именам пакетов, затем безопасный bundled fallback. В `bundle` используется только локальный repository.

Nginx не является обязательной зависимостью: штатная установка слушает `0.0.0.0:8080`. Reverse proxy подключается отдельно для TLS/единого endpoint.

Optional `llama.cpp` bundle имеет тот же OS profile. Настоящий `llama-server` должен быть собран/подготовлен для совместимой target-системы; fake LLM CI проверяет packaging/systemd contract, а не бинарную совместимость реальной GGUF-нагрузки.

Подробно: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md), [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md), [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md).
