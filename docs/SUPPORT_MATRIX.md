# Матрица совместимости

Для приложения поддерживается Node.js `>=24.15.0 <25`. Автономный bundle закрепляет production runtime **Node.js 24.19.0**; host Node build-машины может отличаться и в поставку автоматически не копируется.

| Профиль | Runtime/application capabilities | Автоматическая проверка | Эксплуатационная приёмка |
|---|---|---|---|
| Debian 12 x86-64 | Node 24.19 + managed CPython + target-specific `.deb` fallback | full bundle, system/bundle APT, additive-only guard, OCR/Office, systemd install/update, optional LLM fixture | backup/restore/rollback и реальные документы на контрольной машине |
| Astra Linux 1.7 x86-64 | тот же контракт, bundle собирается на здоровой Astra 1.7 reference VM | contract/scripts/CI; `.deb` нельзя брать из Debian | обязательный акт на фактической целевой машине |
| Astra Linux 1.8 x86-64 | тот же контракт, bundle собирается на здоровой Astra 1.8 reference VM | contract/scripts/CI; собственный OS profile | обязательный акт на фактической целевой машине |

Full bundle не переносит `.deb` fallback между разными `ID/VERSION_ID/architecture`: installer сравнивает профиль и прекращает package step при несовпадении.

Package layer имеет контракт `full-airgap-v2 + additive-only-v2`. Полный closure нужен для air-gap, но его версии не являются target pins. Перед изменением package database выполняются `dpkg --audit` и `apt-get check`; APT получает только фактически отсутствующие application packages и работает с `--no-remove --no-upgrade`. План, который пытается изменить уже установленный пакет, отклоняется до dpkg transaction.

`unzip`, Poppler, Tesseract и LibreOffice являются document capabilities. На clean supported target full bundle обязан установить их и пройти строгий acceptance. На машине с уже повреждённым APT их безопасный пропуск не блокирует API/worker и хранение исходных документов; состояние явно показывается как degraded.

Nginx не является обязательной зависимостью: штатная установка слушает `0.0.0.0:8080`. Reverse proxy подключается отдельно для TLS/единого endpoint.

Optional `llama.cpp` bundle имеет тот же OS profile. Настоящий `llama-server` должен быть собран/подготовлен для совместимой target-системы; fake LLM CI проверяет packaging/systemd contract, а не бинарную совместимость реальной GGUF-нагрузки.

Подробно: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md), [`FULL_OFFLINE_DEPLOYMENT.md`](FULL_OFFLINE_DEPLOYMENT.md), [`LLAMA_OFFLINE_DEPLOYMENT.md`](LLAMA_OFFLINE_DEPLOYMENT.md), [`TARGET_ACCEPTANCE.md`](TARGET_ACCEPTANCE.md).
