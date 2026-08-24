#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Установку необходимо запускать от root" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IS_BUNDLE=false
if [[ -d "$SCRIPT_DIR/application" && -d "$SCRIPT_DIR/runtime" ]]; then
  IS_BUNDLE=true; BUNDLE_ROOT="$SCRIPT_DIR"; APP_SOURCE="$BUNDLE_ROOT/application"; RUNTIME_SOURCE="$BUNDLE_ROOT/runtime/node"
else
  APP_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"; BUNDLE_ROOT="$APP_SOURCE"; RUNTIME_SOURCE="$APP_SOURCE/runtime/node"
fi
VERSION="$(tr -d '[:space:]' < "$APP_SOURCE/VERSION")"
APP_ROOT="/opt/kafedra-planner"; RELEASE_ID="$VERSION"; RELEASE_DIR=""
DATA_DIR="/var/lib/kafedra-planner"; BACKUP_DIR="/var/backups/kafedra-planner"; CONFIG_DIR="/etc/kafedra-planner"; CONFIG_FILE="$CONFIG_DIR/kafedra-planner.env"
API_SERVICE="kafedra-planner-api.service"; WORKER_SERVICE="kafedra-planner-worker.service"; LLM_SERVICE="kafedra-planner-llama.service"
[[ -x "$RUNTIME_SOURCE/bin/node" ]] || { echo "В комплекте отсутствует runtime/node/bin/node" >&2; exit 3; }
if command -v ldd >/dev/null 2>&1; then
  RUNTIME_LDD="$(ldd "$RUNTIME_SOURCE/bin/node" 2>&1 || true)"
  if grep -q 'not found' <<<"$RUNTIME_LDD"; then echo "Встроенный Node.js несовместим с библиотеками этой ОС:" >&2; printf '%s\n' "$RUNTIME_LDD" >&2; exit 3; fi
fi
if ! NODE_EXEC_OUTPUT="$("$RUNTIME_SOURCE/bin/node" -e 'process.exit(0)' 2>&1)"; then
  echo "Встроенный Node.js не может выполниться в текущей операционной системе:" >&2
  printf '%s\n' "$NODE_EXEC_OUTPUT" >&2
  echo "Убедитесь, что release bundle собран для совместимой версии ОС (Astra Linux 1.7 / 1.8 / Debian 12) и архитектуры ($(uname -m 2>/dev/null || echo 'amd64'))." >&2
  exit 3
fi
if [[ "$IS_BUNDLE" == true ]]; then
  [[ -f "$BUNDLE_ROOT/manifest.sha256" && -f "$BUNDLE_ROOT/release.json" ]] || { echo "В автономном комплекте отсутствует manifest.sha256 или release.json" >&2; exit 3; }
  echo "Проверка целостности автономного комплекта..."
  (
    VERIFY_WORK_DIR="$(mktemp -d)"; trap 'rm -rf "$VERIFY_WORK_DIR"' EXIT
    for command in sha256sum find sort uniq cmp; do command -v "$command" >/dev/null 2>&1 || { echo "Для проверки комплекта отсутствует команда $command" >&2; exit 3; }; done
    UNSUPPORTED_ENTRY="$(find "$BUNDLE_ROOT" ! -type f ! -type d -print -quit)"
    [[ -z "$UNSUPPORTED_ENTRY" ]] || { echo "Автономный комплект содержит симлинк или специальный файл: $UNSUPPORTED_ENTRY" >&2; exit 3; }
    MANIFEST_PATHS="$VERIFY_WORK_DIR/manifest-paths.txt"; ACTUAL_PATHS="$VERIFY_WORK_DIR/actual-paths.txt"
    while IFS= read -r line; do
      [[ "$line" =~ ^[0-9a-fA-F]{64}[[:space:]][\ \*](\./)?(.+)$ ]] || { echo "Некорректная строка manifest.sha256" >&2; exit 3; }
      path="${BASH_REMATCH[2]}"
      if [[ "$path" == /* || "$path" == ".." || "$path" == ../* || "$path" == */../* || "$path" == */.. || "$path" =~ [[:cntrl:]\\] ]]; then echo "Небезопасный путь в manifest.sha256: $path" >&2; exit 3; fi
      printf '%s\n' "$path"
    done < "$BUNDLE_ROOT/manifest.sha256" | LC_ALL=C sort > "$MANIFEST_PATHS"
    DUPLICATE="$(uniq -d "$MANIFEST_PATHS" | head -n 1 || true)"; [[ -z "$DUPLICATE" ]] || { echo "Повтор пути в manifest.sha256: $DUPLICATE" >&2; exit 3; }
    (cd "$BUNDLE_ROOT"; LC_ALL=C find . -type f ! -path './manifest.sha256' -printf '%P\n' | LC_ALL=C sort) > "$ACTUAL_PATHS"
    cmp -s "$MANIFEST_PATHS" "$ACTUAL_PATHS" || { echo "manifest.sha256 не перечисляет в точности все файлы комплекта" >&2; exit 3; }
    if ! (cd "$BUNDLE_ROOT"; sha256sum -c --strict manifest.sha256) > "$VERIFY_WORK_DIR/manifest-check.txt" 2>&1; then cat "$VERIFY_WORK_DIR/manifest-check.txt" >&2; exit 3; fi
    echo "Внутренний manifest: OK ($(wc -l < "$MANIFEST_PATHS") файлов)"
  )
  "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/runtime-contract.mjs" verify-bundle --root "$BUNDLE_ROOT"
fi
FULL_BUNDLE=false; PYTHON_SOURCE=""; DOCUMENT_CAPABILITIES_DEGRADED=false
if [[ "$IS_BUNDLE" == true && -f "$BUNDLE_ROOT/deployment.json" ]]; then
  FULL_BUNDLE=true; PYTHON_SOURCE="$BUNDLE_ROOT/runtime/python"
  [[ -x "$PYTHON_SOURCE/python" && -f "$PYTHON_SOURCE/runtime.json" ]] || { echo "Full bundle не содержит managed Python runtime" >&2; exit 3; }
  "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/deployment-contract.mjs" verify --root "$BUNDLE_ROOT" >/dev/null
  PACKAGE_STATUS=0
  "$APP_SOURCE/scripts/offline/install-os-packages.sh" "$BUNDLE_ROOT/os-packages" --scope all || PACKAGE_STATUS=$?
  if (( PACKAGE_STATUS >= 70 )); then
    echo "APT успел начать изменяющую транзакцию и завершился ошибкой (код $PACKAGE_STATUS). Установка остановлена; автоматический --fix-broken запрещён." >&2
    exit "$PACKAGE_STATUS"
  elif (( PACKAGE_STATUS == 20 )); then
    DOCUMENT_CAPABILITIES_DEGRADED=true
    echo "ВНИМАНИЕ: package database ОС уже конфликтует либо безопасный additive-only план невозможен. Пакеты ОС не изменялись; устанавливаю ядро без части обработки документов." >&2
  elif (( PACKAGE_STATUS != 0 )); then
    echo "Проверка package layer завершилась неожиданной ошибкой $PACKAGE_STATUS; установка остановлена до изменения приложения." >&2
    exit "$PACKAGE_STATUS"
  fi
  "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/system-preflight.mjs" --strict
  if ! "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/system-preflight.mjs" --require-full; then
    DOCUMENT_CAPABILITIES_DEGRADED=true
  fi
  if ! "$PYTHON_SOURCE/python" "$APP_SOURCE/scripts/recognition/ocr.py" doctor --languages "${KAFEDRA_OCR_LANGUAGES:-rus+eng}"; then
    DOCUMENT_CAPABILITIES_DEGRADED=true
  fi
  if [[ "$DOCUMENT_CAPABILITIES_DEGRADED" == true ]]; then
    echo "Документные возможности установлены не полностью. Календарь, задачи, данные и исходные файлы будут доступны; автоматическое восстановление: 'sudo $APP_ROOT/current/scripts/offline/doctor.sh --repair'." >&2
  else
    echo "Системные OCR/PDF/Office компоненты готовы."
  fi
else
  "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/system-preflight.mjs" --strict
fi
LLM_BUNDLE=false; LLM_DEFAULT_ENABLED=false; LLM_DEFAULT_MODEL=local-model; LLM_DEFAULT_MODEL_SHA=""; LLM_MANIFEST_SHA=""
LLM_HOST=127.0.0.1; LLM_PORT=8081; LLM_CONTEXT_SIZE=8192; LLM_THREADS=0; LLM_PARALLEL=1; LLM_MODEL_COUNT=0
if [[ "$IS_BUNDLE" == true && -f "$BUNDLE_ROOT/llm/manifest.json" ]]; then
  LLM_BUNDLE=true
  LLM_MANIFEST_SHA="$(sha256sum "$BUNDLE_ROOT/llm/manifest.json" | awk '{print $1}')"
  [[ "$LLM_MANIFEST_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "Не удалось вычислить SHA-256 LLM manifest" >&2; exit 3; }
  "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/llm-contract.mjs" verify --root "$BUNDLE_ROOT" >/dev/null
  readarray -t LLM_META < <("$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/llm-contract.mjs" values --root "$BUNDLE_ROOT")
  LLM_DEFAULT_ENABLED="${LLM_META[0]:-false}"; LLM_DEFAULT_MODEL="${LLM_META[1]:-local-model}"; LLM_DEFAULT_MODEL_SHA="${LLM_META[2]:-}"
  LLM_HOST="${LLM_META[3]:-127.0.0.1}"; LLM_PORT="${LLM_META[4]:-8081}"; LLM_CONTEXT_SIZE="${LLM_META[5]:-8192}"
  LLM_THREADS="${LLM_META[6]:-0}"; LLM_PARALLEL="${LLM_META[7]:-1}"; LLM_MODEL_COUNT="${LLM_META[8]:-0}"
  [[ "$LLM_DEFAULT_MODEL_SHA" =~ ^[0-9a-f]{64}$ && "$LLM_MODEL_COUNT" -gt 0 ]] || { echo "Некорректный LLM manifest" >&2; exit 3; }
fi
if [[ "$IS_BUNDLE" == true ]]; then
  readarray -t RELEASE_META < <("$RUNTIME_SOURCE/bin/node" - "$BUNDLE_ROOT/release.json" <<'NODE'
const fs = require('node:fs');
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(`${release.gitCommit || ''}\n${release.nodeVersion || ''}\n`);
NODE
  )
  RELEASE_GIT_COMMIT="${RELEASE_META[0]:-}"; RELEASE_NODE_VERSION="${RELEASE_META[1]:-}"
  if [[ "$RELEASE_GIT_COMMIT" =~ ^[0-9a-f]{7,64}$ ]]; then RELEASE_ID="${VERSION}-${RELEASE_GIT_COMMIT:0:12}-node${RELEASE_NODE_VERSION#v}"; else RELEASE_FINGERPRINT="$(sha256sum "$BUNDLE_ROOT/manifest.sha256" | awk '{print substr($1,1,12)}')"; RELEASE_ID="${VERSION}-${RELEASE_FINGERPRINT}-node${RELEASE_NODE_VERSION#v}"; fi
  [[ "$LLM_BUNDLE" != true ]] || RELEASE_ID="${RELEASE_ID}-llm${LLM_MANIFEST_SHA:0:12}"
elif command -v git >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$APP_SOURCE" rev-parse HEAD 2>/dev/null || true)"; [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{7,64}$ ]] || RELEASE_ID="${VERSION}-${SOURCE_COMMIT:0:12}"
fi
PREVIOUS_RELEASE=""; if [[ -L "$APP_ROOT/current" || -d "$APP_ROOT/current" ]]; then PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"; fi
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"; REUSE_RELEASE=false
if [[ -e "$RELEASE_DIR" ]]; then
  CURRENT_RELEASE="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
  if [[ "$IS_BUNDLE" == true && -f "$RELEASE_DIR/release.json" ]] && cmp -s "$BUNDLE_ROOT/release.json" "$RELEASE_DIR/release.json" \
    && { [[ "$LLM_BUNDLE" != true ]] || { [[ -f "$RELEASE_DIR/runtime/llama/manifest.json" ]] && cmp -s "$BUNDLE_ROOT/llm/manifest.json" "$RELEASE_DIR/runtime/llama/manifest.json"; }; }; then REUSE_RELEASE=true; if [[ "$CURRENT_RELEASE" == "$RELEASE_DIR" ]]; then echo "Релиз $RELEASE_ID уже выбран как current; повторно проверяю миграции, службы и health-check."; else echo "Релиз $RELEASE_ID уже скопирован; повторяю безопасное переключение/миграцию."; fi
  else echo "Каталог релиза уже существует, но его содержимое не совпадает: $RELEASE_DIR" >&2; exit 4; fi
fi
id kafedra-planner >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin kafedra-planner
install -d -o root -g root -m 0755 "$APP_ROOT/releases"
install -d -o kafedra-planner -g kafedra-planner -m 0700 "$DATA_DIR" "$DATA_DIR/blobs" "$DATA_DIR/tmp" "$DATA_DIR/models" "$BACKUP_DIR"
install -d -o root -g kafedra-planner -m 0750 "$CONFIG_DIR"
LLM_DEFAULT_MODEL_PATH=""
if [[ "$LLM_BUNDLE" == true ]]; then
  while IFS=$'\t' read -r alias digest size relative_path; do
    [[ "$alias" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ && "$digest" =~ ^[0-9a-f]{64}$ && "$size" =~ ^[0-9]+$ ]] || { echo "Некорректная строка LLM models manifest" >&2; exit 3; }
    source_model="$BUNDLE_ROOT/llm/$relative_path"; target_model="$DATA_DIR/models/$digest.gguf"
    [[ -f "$source_model" ]] || { echo "В bundle отсутствует модель: $relative_path" >&2; exit 3; }
    if [[ -f "$target_model" ]]; then
      [[ "$(sha256sum "$target_model" | awk '{print $1}')" == "$digest" ]] || { echo "Существующий model cache повреждён: $target_model" >&2; exit 3; }
      echo "GGUF уже установлен: $alias ($digest)"
    else
      temp_model="$DATA_DIR/models/.${digest}.tmp.$$"
      install -m 0400 -o kafedra-planner -g kafedra-planner "$source_model" "$temp_model"
      [[ "$(sha256sum "$temp_model" | awk '{print $1}')" == "$digest" ]] || { rm -f "$temp_model"; echo "SHA-256 модели изменился при копировании: $alias" >&2; exit 3; }
      mv "$temp_model" "$target_model"; chown kafedra-planner:kafedra-planner "$target_model"; chmod 0400 "$target_model"
      echo "Установлен GGUF: $alias → $target_model"
    fi
    [[ "$alias" != "$LLM_DEFAULT_MODEL" ]] || LLM_DEFAULT_MODEL_PATH="$target_model"
  done < <("$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/llm-contract.mjs" models --root "$BUNDLE_ROOT")
  [[ -n "$LLM_DEFAULT_MODEL_PATH" ]] || { echo "Не удалось определить модель по умолчанию" >&2; exit 3; }
fi
STAGING_RELEASE=""; cleanup_staging_release() { [[ -z "$STAGING_RELEASE" ]] || rm -rf "$STAGING_RELEASE"; }; trap cleanup_staging_release EXIT
if [[ "$REUSE_RELEASE" == false ]]; then
  STAGING_RELEASE="$APP_ROOT/releases/.${RELEASE_ID}.staging.$$"; rm -rf "$STAGING_RELEASE"; mkdir -p "$STAGING_RELEASE"; cp -a "$APP_SOURCE/." "$STAGING_RELEASE/"; mkdir -p "$STAGING_RELEASE/runtime"; cp -a "$RUNTIME_SOURCE" "$STAGING_RELEASE/runtime/node"
  if [[ "$FULL_BUNDLE" == true ]]; then cp -a "$PYTHON_SOURCE" "$STAGING_RELEASE/runtime/python"; install -m 0644 "$BUNDLE_ROOT/deployment.json" "$STAGING_RELEASE/deployment.json"; fi
  if [[ "$LLM_BUNDLE" == true ]]; then
    mkdir -p "$STAGING_RELEASE/runtime/llama"
    cp -a "$BUNDLE_ROOT/llm/runtime/." "$STAGING_RELEASE/runtime/llama/"
    install -m 0644 "$BUNDLE_ROOT/llm/manifest.json" "$STAGING_RELEASE/runtime/llama/manifest.json"
  elif [[ -n "${PREVIOUS_RELEASE:-}" && -d "$PREVIOUS_RELEASE/runtime/llama" ]]; then
    cp -a "$PREVIOUS_RELEASE/runtime/llama" "$STAGING_RELEASE/runtime/llama"
  fi
  [[ "$IS_BUNDLE" != true ]] || install -m 0644 "$BUNDLE_ROOT/release.json" "$STAGING_RELEASE/release.json"
  chown -R root:root "$STAGING_RELEASE"; chmod -R go-w "$STAGING_RELEASE"; mv "$STAGING_RELEASE" "$RELEASE_DIR"; STAGING_RELEASE=""
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  cat > "$CONFIG_FILE" <<ENV
KAFEDRA_HOST=0.0.0.0
KAFEDRA_PORT=8080
KAFEDRA_DATA_DIR=$DATA_DIR
KAFEDRA_DATABASE_PATH=$DATA_DIR/kafedra-planner.sqlite3
KAFEDRA_APPLICATION_DIR=$APP_ROOT/current
KAFEDRA_CONFIG_PATH=$CONFIG_FILE
KAFEDRA_BACKUP_DIR=$BACKUP_DIR
KAFEDRA_BACKUP_KEEP=14
KAFEDRA_BACKUP_MAX_AGE_HOURS=36
KAFEDRA_BACKUP_REQUIRED=true
KAFEDRA_BACKUP_INCLUDE_APPLICATION=true
KAFEDRA_BACKUP_KEY_FILE=
KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION=true
KAFEDRA_AUTH_ENABLED=true
KAFEDRA_AUTH_CSRF_ENABLED=true
KAFEDRA_AUTH_SECURE_COOKIES=false
KAFEDRA_AUTH_SESSION_HOURS=12
KAFEDRA_AUTH_HIERARCHY_MAX_DEPTH=32
KAFEDRA_MAX_UPLOAD_BYTES=209715200
KAFEDRA_WORKER_POLL_MS=1500
KAFEDRA_WORKER_LEASE_SECONDS=120
KAFEDRA_OCR_ENABLED=true
KAFEDRA_OCR_BACKEND=python
KAFEDRA_OCR_LANGUAGES=rus+eng
KAFEDRA_OCR_DPI=250
KAFEDRA_OCR_MAX_PAGES=50
KAFEDRA_OCR_MIN_CHARACTERS=40
KAFEDRA_RECOGNITION_PYTHON=$APP_ROOT/current/runtime/python/python
KAFEDRA_RECOGNITION_SCRIPT=$APP_ROOT/current/scripts/recognition/ocr.py
KAFEDRA_PREVIEW_ENABLED=true
KAFEDRA_LLM_ENABLED=$([[ "$LLM_BUNDLE" == true ]] && printf '%s' "$LLM_DEFAULT_ENABLED" || printf 'false')
KAFEDRA_LLM_ENDPOINT=http://${LLM_HOST}:${LLM_PORT}
KAFEDRA_LLM_MODEL=$LLM_DEFAULT_MODEL
KAFEDRA_LLM_TIMEOUT_MS=45000
KAFEDRA_LLM_MAX_TOKENS=4096
KAFEDRA_LLM_MANAGED=$([[ "$LLM_BUNDLE" == true ]] && printf 'true' || printf 'false')
KAFEDRA_LLM_HOST=$LLM_HOST
KAFEDRA_LLM_PORT=$LLM_PORT
KAFEDRA_LLM_MODEL_PATH=$LLM_DEFAULT_MODEL_PATH
KAFEDRA_LLM_CONTEXT_SIZE=$LLM_CONTEXT_SIZE
KAFEDRA_LLM_THREADS=$LLM_THREADS
KAFEDRA_LLM_PARALLEL=$LLM_PARALLEL
KAFEDRA_LLM_START_TIMEOUT_SECONDS=180
KAFEDRA_NOTIFICATION_DELIVERY_ENABLED=false
KAFEDRA_NOTIFICATION_SWEEP_MS=60000
KAFEDRA_NOTIFICATION_DEFAULT_TIMEZONE=Europe/Moscow
KAFEDRA_SMTP_HOST=
KAFEDRA_SMTP_PORT=25
KAFEDRA_SMTP_SECURE=false
KAFEDRA_SMTP_STARTTLS=true
KAFEDRA_SMTP_REQUIRE_TLS=false
KAFEDRA_SMTP_REJECT_UNAUTHORIZED=true
KAFEDRA_SMTP_USERNAME=
KAFEDRA_SMTP_PASSWORD=
KAFEDRA_SMTP_FROM=
KAFEDRA_SMTP_TIMEOUT_MS=15000
KAFEDRA_TELEGRAM_BOT_TOKEN=
KAFEDRA_TELEGRAM_API_BASE=https://api.telegram.org
KAFEDRA_TELEGRAM_TIMEOUT_MS=15000
KAFEDRA_LOG_LEVEL=info
ENV
  chown root:kafedra-planner "$CONFIG_FILE"; chmod 0640 "$CONFIG_FILE"
fi
LLM_MANAGED_SETTING_EXISTED=false; LLM_MANAGED_DEFAULT=false
grep -q '^KAFEDRA_LLM_MANAGED=' "$CONFIG_FILE" && LLM_MANAGED_SETTING_EXISTED=true
ensure_env_setting() { local name="$1" value="$2"; grep -qE "^${name}=" "$CONFIG_FILE" || printf '%s=%s\n' "$name" "$value" >> "$CONFIG_FILE"; }
ensure_env_setting KAFEDRA_DATA_DIR "$DATA_DIR"
ensure_env_setting KAFEDRA_DATABASE_PATH "$DATA_DIR/kafedra-planner.sqlite3"
ensure_env_setting KAFEDRA_APPLICATION_DIR "$APP_ROOT/current"
ensure_env_setting KAFEDRA_CONFIG_PATH "$CONFIG_FILE"
ensure_env_setting KAFEDRA_BACKUP_DIR "$BACKUP_DIR"
ensure_env_setting KAFEDRA_BACKUP_KEEP 14
ensure_env_setting KAFEDRA_BACKUP_MAX_AGE_HOURS 36
ensure_env_setting KAFEDRA_BACKUP_REQUIRED true
ensure_env_setting KAFEDRA_BACKUP_INCLUDE_APPLICATION true
ensure_env_setting KAFEDRA_BACKUP_KEY_FILE ''
ensure_env_setting KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION true
ensure_env_setting KAFEDRA_AUTH_ENABLED true
ensure_env_setting KAFEDRA_AUTH_CSRF_ENABLED true
ensure_env_setting KAFEDRA_AUTH_SECURE_COOKIES false
ensure_env_setting KAFEDRA_AUTH_TRUST_PROXY false
ensure_env_setting KAFEDRA_OCR_ENABLED true
ensure_env_setting KAFEDRA_OCR_BACKEND python
ensure_env_setting KAFEDRA_OCR_LANGUAGES rus+eng
ensure_env_setting KAFEDRA_OCR_DPI 250
ensure_env_setting KAFEDRA_OCR_MAX_PAGES 50
ensure_env_setting KAFEDRA_OCR_MIN_CHARACTERS 40
ensure_env_setting KAFEDRA_RECOGNITION_PYTHON "$APP_ROOT/current/runtime/python/python"
ensure_env_setting KAFEDRA_RECOGNITION_SCRIPT "$APP_ROOT/current/scripts/recognition/ocr.py"
ensure_env_setting KAFEDRA_PREVIEW_ENABLED true
# Legacy rc.6 config already contains LLM_ENABLED=false but not the managed flag.
# Installing an explicit LLM bundle upgrades only that untouched local default; an
# enabled/external configuration is never rewritten silently.
if [[ "$LLM_BUNDLE" == true && "$LLM_MANAGED_SETTING_EXISTED" == false ]] \
  && grep -q '^KAFEDRA_LLM_ENABLED=false$' "$CONFIG_FILE" \
  && grep -qE '^KAFEDRA_LLM_ENDPOINT=(|http://127\.0\.0\.1:8081)$' "$CONFIG_FILE" \
  && { ! grep -q '^KAFEDRA_LLM_MODEL=' "$CONFIG_FILE" || grep -q '^KAFEDRA_LLM_MODEL=local-model$' "$CONFIG_FILE"; }; then
  LLM_MANAGED_DEFAULT=true
  sed -i "s/^KAFEDRA_LLM_ENABLED=false$/KAFEDRA_LLM_ENABLED=$LLM_DEFAULT_ENABLED/" "$CONFIG_FILE"
  sed -i "s|^KAFEDRA_LLM_ENDPOINT=.*$|KAFEDRA_LLM_ENDPOINT=http://$LLM_HOST:$LLM_PORT|" "$CONFIG_FILE"
  sed -i "s/^KAFEDRA_LLM_MODEL=.*$/KAFEDRA_LLM_MODEL=$LLM_DEFAULT_MODEL/" "$CONFIG_FILE"
fi
ensure_env_setting KAFEDRA_LLM_ENABLED "$([[ "$LLM_BUNDLE" == true ]] && printf '%s' "$LLM_DEFAULT_ENABLED" || printf 'false')"
ensure_env_setting KAFEDRA_LLM_ENDPOINT "http://$LLM_HOST:$LLM_PORT"
ensure_env_setting KAFEDRA_LLM_MODEL "$LLM_DEFAULT_MODEL"
ensure_env_setting KAFEDRA_LLM_TIMEOUT_MS 45000
ensure_env_setting KAFEDRA_LLM_MAX_TOKENS 4096
ensure_env_setting KAFEDRA_LLM_MANAGED "$LLM_MANAGED_DEFAULT"
ensure_env_setting KAFEDRA_LLM_HOST "$LLM_HOST"
ensure_env_setting KAFEDRA_LLM_PORT "$LLM_PORT"
ensure_env_setting KAFEDRA_LLM_MODEL_PATH "$LLM_DEFAULT_MODEL_PATH"
ensure_env_setting KAFEDRA_LLM_CONTEXT_SIZE "$LLM_CONTEXT_SIZE"
ensure_env_setting KAFEDRA_LLM_THREADS "$LLM_THREADS"
ensure_env_setting KAFEDRA_LLM_PARALLEL "$LLM_PARALLEL"
ensure_env_setting KAFEDRA_LLM_START_TIMEOUT_SECONDS 180
if [[ "$FULL_BUNDLE" == true ]] && grep -q '^KAFEDRA_HOST=127\.0\.0\.1$' "$CONFIG_FILE"; then sed -i 's/^KAFEDRA_HOST=127\.0\.0\.1$/KAFEDRA_HOST=0.0.0.0/' "$CONFIG_FILE"; echo "Full deployment: API переведён с loopback на 0.0.0.0 для доступа из локальной сети."; fi
ensure_env_setting KAFEDRA_NOTIFICATION_DELIVERY_ENABLED false
ensure_env_setting KAFEDRA_NOTIFICATION_SWEEP_MS 60000
ensure_env_setting KAFEDRA_NOTIFICATION_DEFAULT_TIMEZONE Europe/Moscow
ensure_env_setting KAFEDRA_SMTP_HOST ''
ensure_env_setting KAFEDRA_SMTP_PORT 25
ensure_env_setting KAFEDRA_SMTP_SECURE false
ensure_env_setting KAFEDRA_SMTP_STARTTLS true
ensure_env_setting KAFEDRA_SMTP_REQUIRE_TLS false
ensure_env_setting KAFEDRA_SMTP_REJECT_UNAUTHORIZED true
ensure_env_setting KAFEDRA_SMTP_USERNAME ''
ensure_env_setting KAFEDRA_SMTP_PASSWORD ''
ensure_env_setting KAFEDRA_SMTP_FROM ''
ensure_env_setting KAFEDRA_SMTP_TIMEOUT_MS 15000
ensure_env_setting KAFEDRA_TELEGRAM_BOT_TOKEN ''
ensure_env_setting KAFEDRA_TELEGRAM_API_BASE https://api.telegram.org
ensure_env_setting KAFEDRA_TELEGRAM_TIMEOUT_MS 15000
chown root:kafedra-planner "$CONFIG_FILE"; chmod 0640 "$CONFIG_FILE"

[[ -f "$RELEASE_DIR/scripts/offline/environment-file.sh" ]] || { echo "В релизе отсутствует безопасный parser конфигурации" >&2; exit 5; }
# shellcheck source=/dev/null
source "$RELEASE_DIR/scripts/offline/environment-file.sh"
load_environment() { kafedra_read_environment_file "$CONFIG_FILE"; }
validate_managed_deployment_path() {
  local name="$1"
  local expected="$2"
  local actual="${!name:-$expected}"
  if [[ "$actual" != "$expected" ]]; then
    echo "Неподдерживаемый путь $name=$actual в $CONFIG_FILE" >&2
    echo "Штатный offline installer использует $name=$expected. Исправьте config до обновления; данные не изменены." >&2
    return 5
  fi
}
validate_managed_deployment_paths() {
  validate_managed_deployment_path KAFEDRA_DATA_DIR "$DATA_DIR"
  validate_managed_deployment_path KAFEDRA_DATABASE_PATH "$DATA_DIR/kafedra-planner.sqlite3"
  validate_managed_deployment_path KAFEDRA_APPLICATION_DIR "$APP_ROOT/current"
  validate_managed_deployment_path KAFEDRA_CONFIG_PATH "$CONFIG_FILE"
  validate_managed_deployment_path KAFEDRA_BACKUP_DIR "$BACKUP_DIR"
  [[ "${KAFEDRA_PORT:-8080}" =~ ^[0-9]+$ ]] && ((KAFEDRA_PORT >= 1 && KAFEDRA_PORT <= 65535)) || { echo "Некорректный KAFEDRA_PORT=${KAFEDRA_PORT:-}: ожидается 1..65535" >&2; return 5; }
}
# Конфигурация проверяется до остановки служб, backup, миграции и изменения current.
load_environment
validate_managed_deployment_paths

API_UNIT_EXISTED=false; WORKER_UNIT_EXISTED=false; LLM_UNIT_EXISTED=false
[[ -f "/etc/systemd/system/$API_SERVICE" ]] && API_UNIT_EXISTED=true
[[ -f "/etc/systemd/system/$WORKER_SERVICE" ]] && WORKER_UNIT_EXISTED=true
[[ -f "/etc/systemd/system/$LLM_SERVICE" ]] && LLM_UNIT_EXISTED=true
SERVICES_WERE_ACTIVE=false; if systemctl is-active --quiet "$API_SERVICE" || systemctl is-active --quiet "$WORKER_SERVICE"; then SERVICES_WERE_ACTIVE=true; fi
LLM_WAS_ACTIVE=false; systemctl is-active --quiet "$LLM_SERVICE" && LLM_WAS_ACTIVE=true || true
MANAGED_DATABASE_PATH="${KAFEDRA_DATABASE_PATH:-$DATA_DIR/kafedra-planner.sqlite3}"
MANAGED_BACKUP_DIR="${KAFEDRA_BACKUP_DIR:-$BACKUP_DIR}"
BACKUP_ARCHIVE=""; DATABASE_EXISTED_BEFORE=false; [[ -f "$MANAGED_DATABASE_PATH" ]] && DATABASE_EXISTED_BEFORE=true; ROLLBACK_STARTED=false
rollback_installation() {
  local status=$?; [[ "$ROLLBACK_STARTED" == false ]] || exit "$status"; ROLLBACK_STARTED=true; set +e
  echo "Обновление не завершено. Выполняется автоматический откат." >&2; systemctl stop "$API_SERVICE" "$WORKER_SERVICE" "$LLM_SERVICE" >/dev/null 2>&1
  if [[ -n "$BACKUP_ARCHIVE" && -f "$BACKUP_ARCHIVE" ]]; then
    MODEL_CACHE_STASH=""
    if [[ -d "$DATA_DIR/models" ]]; then
      MODEL_CACHE_STASH="$(dirname "$DATA_DIR")/.kafedra-planner-models-rollback-$$"
      rm -rf "$MODEL_CACHE_STASH"
      if ! mv "$DATA_DIR/models" "$MODEL_CACHE_STASH"; then
        echo "Не удалось временно сохранить model cache перед restore; GGUF можно восстановить повторной установкой LLM bundle." >&2
        MODEL_CACHE_STASH=""
      fi
    fi
    load_environment
    "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/backup-restore.mjs" "$BACKUP_ARCHIVE" --target-data-dir "$DATA_DIR" --target-config "$CONFIG_FILE" --apply --force >&2
    RESTORE_STATUS=$?
    if [[ -n "$MODEL_CACHE_STASH" && -d "$MODEL_CACHE_STASH" ]]; then
      rm -rf "$DATA_DIR/models"
      mv "$MODEL_CACHE_STASH" "$DATA_DIR/models" || echo "Не удалось вернуть model cache после restore; переустановите исходный LLM bundle." >&2
    fi
    install -d -o kafedra-planner -g kafedra-planner -m 0700 "$DATA_DIR/models"
    chown -R kafedra-planner:kafedra-planner "$DATA_DIR"; chown root:kafedra-planner "$CONFIG_FILE"; chmod 0640 "$CONFIG_FILE"
    [[ "$RESTORE_STATUS" -eq 0 ]] || echo "Восстановление backup во время rollback завершилось ошибкой $RESTORE_STATUS." >&2
  fi
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -sfn "$PREVIOUS_RELEASE" "$APP_ROOT/current.rollback"; mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
    install -m 0644 "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-api.service" /etc/systemd/system/
    install -m 0644 "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-worker.service" /etc/systemd/system/
    if [[ -f "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-llama.service" ]]; then install -m 0644 "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-llama.service" /etc/systemd/system/; else systemctl disable "$LLM_SERVICE" >/dev/null 2>&1 || true; [[ "$LLM_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$LLM_SERVICE"; fi
    systemctl daemon-reload; [[ "$SERVICES_WERE_ACTIVE" != true ]] || systemctl start "$API_SERVICE" "$WORKER_SERVICE"; [[ "$LLM_WAS_ACTIVE" != true ]] || systemctl start "$LLM_SERVICE"
  else
    rm -f "$APP_ROOT/current"; if [[ "$DATABASE_EXISTED_BEFORE" == false ]]; then rm -f "$MANAGED_DATABASE_PATH" "$MANAGED_DATABASE_PATH-wal" "$MANAGED_DATABASE_PATH-shm"; fi; [[ -z "${FIRST_LOGIN_FILE:-}" ]] || rm -f "$FIRST_LOGIN_FILE"
    systemctl disable "$API_SERVICE" "$WORKER_SERVICE" "$LLM_SERVICE" >/dev/null 2>&1 || true
    [[ "$API_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$API_SERVICE"; [[ "$WORKER_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$WORKER_SERVICE"; [[ "$LLM_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$LLM_SERVICE"; systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  echo "Автоматический откат завершён. Неуспешная версия оставлена в $RELEASE_DIR для диагностики." >&2; exit "$status"
}
trap rollback_installation ERR
systemctl stop "$API_SERVICE" "$WORKER_SERVICE" "$LLM_SERVICE" >/dev/null 2>&1 || true
load_environment
if [[ -f "$MANAGED_DATABASE_PATH" ]]; then
  BACKUP_JSON="$(env KAFEDRA_DATA_DIR="$KAFEDRA_DATA_DIR" KAFEDRA_DATABASE_PATH="$MANAGED_DATABASE_PATH" KAFEDRA_APPLICATION_DIR="${PREVIOUS_RELEASE:-$RELEASE_DIR}" KAFEDRA_CONFIG_PATH="$KAFEDRA_CONFIG_PATH" KAFEDRA_BACKUP_DIR="$MANAGED_BACKUP_DIR" KAFEDRA_BACKUP_KEY_FILE="${KAFEDRA_BACKUP_KEY_FILE:-}" "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/backup-create.mjs" --reason pre-update)"
  BACKUP_ARCHIVE="$(printf '%s' "$BACKUP_JSON" | "$RELEASE_DIR/runtime/node/bin/node" -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.parse(s).archivePath||''));")"
  [[ -n "$BACKUP_ARCHIVE" && -f "$BACKUP_ARCHIVE" ]] || { echo "Не удалось определить созданную резервную копию" >&2; exit 6; }
  chown -R kafedra-planner:kafedra-planner "$MANAGED_BACKUP_DIR"; chmod 0700 "$MANAGED_BACKUP_DIR"; echo "Создана и проверена резервная копия: $BACKUP_ARCHIVE"
fi
ln -sfn "$RELEASE_DIR" "$APP_ROOT/current.new"; mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-api.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-worker.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-llama.service" /etc/systemd/system/
systemctl daemon-reload
runuser -u kafedra-planner -- env KAFEDRA_DATA_DIR="$KAFEDRA_DATA_DIR" KAFEDRA_DATABASE_PATH="$MANAGED_DATABASE_PATH" KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" KAFEDRA_CONFIG_PATH="$KAFEDRA_CONFIG_PATH" KAFEDRA_BACKUP_DIR="$MANAGED_BACKUP_DIR" KAFEDRA_SKIP_AUTO_BACKUP=true "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/migrate.mjs"
INITIAL_ADMIN_JSON="$(runuser -u kafedra-planner -- env KAFEDRA_DATA_DIR="$KAFEDRA_DATA_DIR" KAFEDRA_DATABASE_PATH="$MANAGED_DATABASE_PATH" KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" KAFEDRA_CONFIG_PATH="$KAFEDRA_CONFIG_PATH" "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/ensure-initial-admin.mjs")"
INITIAL_ADMIN_CREATED="$(printf '%s' "$INITIAL_ADMIN_JSON" | "$RELEASE_DIR/runtime/node/bin/node" -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.parse(s).created?'yes':'no'));" )"
FIRST_LOGIN_FILE=""
if [[ "$INITIAL_ADMIN_CREATED" == yes ]]; then
  FIRST_LOGIN_FILE="${KAFEDRA_FIRST_LOGIN_FILE:-/root/kafedra-planner-first-login.txt}"
  "$RELEASE_DIR/runtime/node/bin/node" -e '
const fs=require("node:fs"); const value=JSON.parse(process.argv[1]); fs.writeFileSync(process.argv[2], `Kafedra Planner — первый вход\nЛогин: ${value.username}\nВременный пароль: ${value.password}\nПароль необходимо изменить после входа.\n`, {mode:0o600});
' "$INITIAL_ADMIN_JSON" "$FIRST_LOGIN_FILE"; chmod 0600 "$FIRST_LOGIN_FILE"
fi
load_environment
if [[ "${KAFEDRA_LLM_ENABLED:-false}" == true && "${KAFEDRA_LLM_MANAGED:-false}" == true ]]; then
  [[ -x "$RELEASE_DIR/runtime/llama/bin/llama-server" ]] || { echo "Managed LLM включён, но runtime llama.cpp отсутствует в release." >&2; false; }
  [[ -f "${KAFEDRA_LLM_MODEL_PATH:-}" ]] || { echo "Managed LLM включён, но GGUF не найден: ${KAFEDRA_LLM_MODEL_PATH:-}" >&2; false; }
  systemctl enable --now "$LLM_SERVICE"
  LLM_READY=false; LLM_WAIT="${KAFEDRA_LLM_START_TIMEOUT_SECONDS:-180}"
  [[ "$LLM_WAIT" =~ ^[0-9]+$ ]] || LLM_WAIT=180
  for ((_llm_wait=0; _llm_wait<LLM_WAIT; _llm_wait++)); do
    if systemctl is-active --quiet "$LLM_SERVICE" && KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" KAFEDRA_CONFIG_PATH="$CONFIG_FILE" "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/llm-doctor.mjs" --json >/dev/null 2>&1; then LLM_READY=true; break; fi
    sleep 1
  done
  if [[ "$LLM_READY" != true ]]; then echo "Managed llama-server не вышел в ready за ${LLM_WAIT} с." >&2; journalctl -u "$LLM_SERVICE" -n 100 --no-pager >&2 || true; false; fi
else
  systemctl disable --now "$LLM_SERVICE" >/dev/null 2>&1 || true
fi
systemctl enable --now "$API_SERVICE" "$WORKER_SERVICE"
load_environment
health_request() { KAFEDRA_PORT="${KAFEDRA_PORT:-8080}" "$RELEASE_DIR/runtime/node/bin/node" -e '
const http=require("node:http"); const port=Number(process.env.KAFEDRA_PORT||8080); const request=http.get({host:"127.0.0.1",port,path:"/api/system/health",timeout:3000},response=>{response.resume();process.exitCode=response.statusCode>=200&&response.statusCode<300?0:1;}); request.on("timeout",()=>request.destroy(new Error("timeout"))); request.on("error",()=>{process.exitCode=1;});
'; }
HEALTH_OK=false
for _attempt in {1..15}; do if systemctl is-active --quiet "$API_SERVICE" && systemctl is-active --quiet "$WORKER_SERVICE" && health_request; then HEALTH_OK=true; break; fi; sleep 1; done
if [[ "$HEALTH_OK" != true ]]; then echo "Службы не вышли в рабочее состояние после установки." >&2; journalctl -u "$API_SERVICE" -u "$WORKER_SERVICE" -n 80 --no-pager >&2 || true; false; fi
if [[ "$FULL_BUNDLE" == true ]]; then
  if [[ "$DOCUMENT_CAPABILITIES_DEGRADED" == true ]]; then
    KAFEDRA_DOCTOR_ALLOW_DEGRADED=true KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" KAFEDRA_CONFIG_PATH="$CONFIG_FILE" "$RELEASE_DIR/scripts/offline/doctor.sh"
  else
    KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" KAFEDRA_CONFIG_PATH="$CONFIG_FILE" "$RELEASE_DIR/scripts/offline/doctor.sh"
  fi
fi
trap - ERR
echo "Установлен релиз $RELEASE_ID (версия $VERSION)"
[[ -n "$BACKUP_ARCHIVE" ]] && echo "Точка отката: $BACKUP_ARCHIVE"
[[ -z "${FIRST_LOGIN_FILE:-}" ]] || echo "Первый вход: $FIRST_LOGIN_FILE"
load_environment
DISPLAY_HOST="<IP-сервера>"; if command -v hostname >/dev/null 2>&1; then CANDIDATE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; [[ -z "$CANDIDATE_IP" ]] || DISPLAY_HOST="$CANDIDATE_IP"; fi
echo "Откройте: http://${DISPLAY_HOST}:${KAFEDRA_PORT:-8080}/"
