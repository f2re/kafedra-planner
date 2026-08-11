#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Установку необходимо запускать от root" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IS_BUNDLE=false
if [[ -d "$SCRIPT_DIR/application" && -d "$SCRIPT_DIR/runtime" ]]; then
  IS_BUNDLE=true
  BUNDLE_ROOT="$SCRIPT_DIR"
  APP_SOURCE="$BUNDLE_ROOT/application"
  RUNTIME_SOURCE="$BUNDLE_ROOT/runtime/node"
else
  APP_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"
  BUNDLE_ROOT="$APP_SOURCE"
  RUNTIME_SOURCE="$APP_SOURCE/runtime/node"
fi
VERSION="$(tr -d '[:space:]' < "$APP_SOURCE/VERSION")"
APP_ROOT="/opt/kafedra-planner"
RELEASE_ID="$VERSION"
RELEASE_DIR=""
DATA_DIR="/var/lib/kafedra-planner"
BACKUP_DIR="/var/backups/kafedra-planner"
CONFIG_DIR="/etc/kafedra-planner"
CONFIG_FILE="$CONFIG_DIR/kafedra-planner.env"
API_SERVICE="kafedra-planner-api.service"
WORKER_SERVICE="kafedra-planner-worker.service"
[[ -x "$RUNTIME_SOURCE/bin/node" ]] || { echo "В комплекте отсутствует runtime/node/bin/node" >&2; exit 3; }
if command -v ldd >/dev/null 2>&1; then
  RUNTIME_LDD="$(ldd "$RUNTIME_SOURCE/bin/node" 2>&1 || true)"
  if grep -q 'not found' <<<"$RUNTIME_LDD"; then
    echo "Встроенный Node.js несовместим с библиотеками этой ОС:" >&2
    printf '%s\n' "$RUNTIME_LDD" >&2
    exit 3
  fi
fi
if [[ "$IS_BUNDLE" == true ]]; then
  [[ -f "$BUNDLE_ROOT/manifest.sha256" && -f "$BUNDLE_ROOT/release.json" ]] || {
    echo "В автономном комплекте отсутствует manifest.sha256 или release.json" >&2
    exit 3
  }
  echo "Проверка целостности автономного комплекта..."
  (
    VERIFY_WORK_DIR="$(mktemp -d)"
    trap 'rm -rf "$VERIFY_WORK_DIR"' EXIT
    for command in sha256sum find sort uniq cmp; do
      command -v "$command" >/dev/null 2>&1 || {
        echo "Для проверки комплекта отсутствует команда $command" >&2
        exit 3
      }
    done
    UNSUPPORTED_ENTRY="$(find "$BUNDLE_ROOT" ! -type f ! -type d -print -quit)"
    [[ -z "$UNSUPPORTED_ENTRY" ]] || {
      echo "Автономный комплект содержит симлинк или специальный файл: $UNSUPPORTED_ENTRY" >&2
      exit 3
    }
    MANIFEST_PATHS="$VERIFY_WORK_DIR/manifest-paths.txt"
    ACTUAL_PATHS="$VERIFY_WORK_DIR/actual-paths.txt"
    while IFS= read -r line; do
      [[ "$line" =~ ^[0-9a-fA-F]{64}[[:space:]][\ \*](\./)?(.+)$ ]] || {
        echo "Некорректная строка manifest.sha256" >&2
        exit 3
      }
      path="${BASH_REMATCH[2]}"
      if [[ "$path" == /* || "$path" == ".." || "$path" == ../* || "$path" == */../* || "$path" == */.. || "$path" =~ [[:cntrl:]\\] ]]; then
        echo "Небезопасный путь в manifest.sha256: $path" >&2
        exit 3
      fi
      printf '%s\n' "$path"
    done < "$BUNDLE_ROOT/manifest.sha256" | LC_ALL=C sort > "$MANIFEST_PATHS"
    DUPLICATE="$(uniq -d "$MANIFEST_PATHS" | head -n 1 || true)"
    [[ -z "$DUPLICATE" ]] || {
      echo "Повтор пути в manifest.sha256: $DUPLICATE" >&2
      exit 3
    }
    (
      cd "$BUNDLE_ROOT"
      LC_ALL=C find . -type f ! -path './manifest.sha256' -printf '%P\n' | LC_ALL=C sort
    ) > "$ACTUAL_PATHS"
    cmp -s "$MANIFEST_PATHS" "$ACTUAL_PATHS" || {
      echo "manifest.sha256 не перечисляет в точности все файлы комплекта" >&2
      exit 3
    }
    if ! (
      cd "$BUNDLE_ROOT"
      sha256sum -c --strict manifest.sha256
    ) > "$VERIFY_WORK_DIR/manifest-check.txt" 2>&1; then
      cat "$VERIFY_WORK_DIR/manifest-check.txt" >&2
      exit 3
    fi
    echo "Внутренний manifest: OK ($(wc -l < "$MANIFEST_PATHS") файлов)"
  )
  "$RUNTIME_SOURCE/bin/node" \
    "$APP_SOURCE/scripts/offline/runtime-contract.mjs" verify-bundle \
    --root "$BUNDLE_ROOT"
fi
"$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/system-preflight.mjs" --strict

# Семантическая VERSION описывает продукт, а каталог release должен различать
# разные сборки одной и той же RC-версии. Иначе обновление main с неизменённым
# VERSION блокируется сообщением «версия уже установлена».
if [[ "$IS_BUNDLE" == true ]]; then
  readarray -t RELEASE_META < <("$RUNTIME_SOURCE/bin/node" - "$BUNDLE_ROOT/release.json" <<'NODE'
const fs = require('node:fs');
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(`${release.gitCommit || ''}\n${release.nodeVersion || ''}\n`);
NODE
  )
  RELEASE_GIT_COMMIT="${RELEASE_META[0]:-}"
  RELEASE_NODE_VERSION="${RELEASE_META[1]:-}"
  if [[ "$RELEASE_GIT_COMMIT" =~ ^[0-9a-f]{7,64}$ ]]; then
    RELEASE_ID="${VERSION}-${RELEASE_GIT_COMMIT:0:12}-node${RELEASE_NODE_VERSION#v}"
  else
    RELEASE_FINGERPRINT="$(sha256sum "$BUNDLE_ROOT/manifest.sha256" | awk '{print substr($1,1,12)}')"
    RELEASE_ID="${VERSION}-${RELEASE_FINGERPRINT}-node${RELEASE_NODE_VERSION#v}"
  fi
elif command -v git >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$APP_SOURCE" rev-parse HEAD 2>/dev/null || true)"
  [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{7,64}$ ]] || RELEASE_ID="${VERSION}-${SOURCE_COMMIT:0:12}"
fi
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
REUSE_RELEASE=false
if [[ -e "$RELEASE_DIR" ]]; then
  CURRENT_RELEASE="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
  if [[ "$IS_BUNDLE" == true && -f "$RELEASE_DIR/release.json" ]] && cmp -s "$BUNDLE_ROOT/release.json" "$RELEASE_DIR/release.json"; then
    REUSE_RELEASE=true
    if [[ "$CURRENT_RELEASE" == "$RELEASE_DIR" ]]; then
      echo "Релиз $RELEASE_ID уже выбран как current; повторно проверяю миграции, службы и health-check."
    else
      echo "Релиз $RELEASE_ID уже скопирован; повторяю безопасное переключение/миграцию."
    fi
  else
    echo "Каталог релиза уже существует, но его содержимое не совпадает: $RELEASE_DIR" >&2
    exit 4
  fi
fi

id kafedra-planner >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin kafedra-planner
install -d -o root -g root -m 0755 "$APP_ROOT/releases"
install -d -o kafedra-planner -g kafedra-planner -m 0700 "$DATA_DIR" "$DATA_DIR/blobs" "$DATA_DIR/tmp" "$BACKUP_DIR"
install -d -o root -g kafedra-planner -m 0750 "$CONFIG_DIR"
STAGING_RELEASE=""
cleanup_staging_release() {
  [[ -z "$STAGING_RELEASE" ]] || rm -rf "$STAGING_RELEASE"
}
trap cleanup_staging_release EXIT
if [[ "$REUSE_RELEASE" == false ]]; then
  STAGING_RELEASE="$APP_ROOT/releases/.${RELEASE_ID}.staging.$$"
  rm -rf "$STAGING_RELEASE"
  mkdir -p "$STAGING_RELEASE"
  cp -a "$APP_SOURCE/." "$STAGING_RELEASE/"
  mkdir -p "$STAGING_RELEASE/runtime"
  cp -a "$RUNTIME_SOURCE" "$STAGING_RELEASE/runtime/node"
  if [[ "$IS_BUNDLE" == true ]]; then
    install -m 0644 "$BUNDLE_ROOT/release.json" "$STAGING_RELEASE/release.json"
  fi
  chown -R root:root "$STAGING_RELEASE"
  chmod -R go-w "$STAGING_RELEASE"
  mv "$STAGING_RELEASE" "$RELEASE_DIR"
  STAGING_RELEASE=""
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  cat > "$CONFIG_FILE" <<ENV
KAFEDRA_HOST=127.0.0.1
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
KAFEDRA_OCR_LANGUAGES=rus+eng
KAFEDRA_OCR_DPI=250
KAFEDRA_OCR_MAX_PAGES=50
KAFEDRA_OCR_MIN_CHARACTERS=40
KAFEDRA_PREVIEW_ENABLED=true
KAFEDRA_LLM_ENABLED=false
KAFEDRA_LLM_ENDPOINT=http://127.0.0.1:8081
KAFEDRA_LLM_MODEL=local-model
KAFEDRA_LLM_TIMEOUT_MS=45000
KAFEDRA_LLM_MAX_TOKENS=4096
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
  chown root:kafedra-planner "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
fi
ensure_env_setting() {
  local name="$1" value="$2"
  grep -qE "^${name}=" "$CONFIG_FILE" || printf '%s=%s\n' "$name" "$value" >> "$CONFIG_FILE"
}
ensure_env_setting KAFEDRA_APPLICATION_DIR "$APP_ROOT/current"
ensure_env_setting KAFEDRA_CONFIG_PATH "$CONFIG_FILE"
ensure_env_setting KAFEDRA_BACKUP_DIR "$BACKUP_DIR"
ensure_env_setting KAFEDRA_BACKUP_KEEP 14
ensure_env_setting KAFEDRA_BACKUP_MAX_AGE_HOURS 36
ensure_env_setting KAFEDRA_BACKUP_REQUIRED true
ensure_env_setting KAFEDRA_BACKUP_INCLUDE_APPLICATION true
ensure_env_setting KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION true
ensure_env_setting KAFEDRA_AUTH_ENABLED true
ensure_env_setting KAFEDRA_AUTH_CSRF_ENABLED true
ensure_env_setting KAFEDRA_AUTH_SECURE_COOKIES false
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
chown root:kafedra-planner "$CONFIG_FILE"
chmod 0640 "$CONFIG_FILE"
API_UNIT_EXISTED=false
WORKER_UNIT_EXISTED=false
[[ -f "/etc/systemd/system/$API_SERVICE" ]] && API_UNIT_EXISTED=true
[[ -f "/etc/systemd/system/$WORKER_SERVICE" ]] && WORKER_UNIT_EXISTED=true
PREVIOUS_RELEASE=""
if [[ -L "$APP_ROOT/current" || -d "$APP_ROOT/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
fi
SERVICES_WERE_ACTIVE=false
if systemctl is-active --quiet "$API_SERVICE" || systemctl is-active --quiet "$WORKER_SERVICE"; then
  SERVICES_WERE_ACTIVE=true
fi
BACKUP_ARCHIVE=""
ROLLBACK_STARTED=false

load_environment() {
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
}
rollback_installation() {
  local status=$?
  [[ "$ROLLBACK_STARTED" == false ]] || exit "$status"
  ROLLBACK_STARTED=true
  set +e
  echo "Обновление не завершено. Выполняется автоматический откат." >&2
  systemctl stop "$API_SERVICE" "$WORKER_SERVICE" >/dev/null 2>&1
  if [[ -n "$BACKUP_ARCHIVE" && -f "$BACKUP_ARCHIVE" ]]; then
    load_environment
    "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/backup-restore.mjs" \
      "$BACKUP_ARCHIVE" \
      --target-data-dir "$DATA_DIR" \
      --target-config "$CONFIG_FILE" \
      --apply --force >&2
    chown -R kafedra-planner:kafedra-planner "$DATA_DIR"
    chown root:kafedra-planner "$CONFIG_FILE"
    chmod 0640 "$CONFIG_FILE"
  fi
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -sfn "$PREVIOUS_RELEASE" "$APP_ROOT/current.rollback"
    mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
    install -m 0644 "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-api.service" /etc/systemd/system/
    install -m 0644 "$PREVIOUS_RELEASE/deploy/systemd/kafedra-planner-worker.service" /etc/systemd/system/
    systemctl daemon-reload
    if [[ "$SERVICES_WERE_ACTIVE" == true ]]; then
      systemctl start "$API_SERVICE" "$WORKER_SERVICE"
    fi
  else
    rm -f "$APP_ROOT/current"
    systemctl disable "$API_SERVICE" "$WORKER_SERVICE" >/dev/null 2>&1 || true
    [[ "$API_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$API_SERVICE"
    [[ "$WORKER_UNIT_EXISTED" == true ]] || rm -f "/etc/systemd/system/$WORKER_SERVICE"
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  echo "Автоматический откат завершён. Неуспешная версия оставлена в $RELEASE_DIR для диагностики." >&2
  exit "$status"
}
trap rollback_installation ERR
systemctl stop "$API_SERVICE" "$WORKER_SERVICE" >/dev/null 2>&1 || true
load_environment
if [[ -f "$DATA_DIR/kafedra-planner.sqlite3" ]]; then
  BACKUP_JSON="$(env \
    KAFEDRA_DATA_DIR="$DATA_DIR" \
    KAFEDRA_DATABASE_PATH="$DATA_DIR/kafedra-planner.sqlite3" \
    KAFEDRA_APPLICATION_DIR="${PREVIOUS_RELEASE:-$RELEASE_DIR}" \
    KAFEDRA_CONFIG_PATH="$CONFIG_FILE" \
    KAFEDRA_BACKUP_DIR="$BACKUP_DIR" \
    KAFEDRA_BACKUP_KEY_FILE="${KAFEDRA_BACKUP_KEY_FILE:-}" \
    "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/backup-create.mjs" \
    --reason pre-update)"
  BACKUP_ARCHIVE="$(printf '%s' "$BACKUP_JSON" | "$RELEASE_DIR/runtime/node/bin/node" -e \
    "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.parse(s).archivePath||''));")"
  [[ -n "$BACKUP_ARCHIVE" && -f "$BACKUP_ARCHIVE" ]] || { echo "Не удалось определить созданную резервную копию" >&2; exit 6; }
  chown -R kafedra-planner:kafedra-planner "$BACKUP_DIR"
  chmod 0700 "$BACKUP_DIR"
  echo "Создана и проверена резервная копия: $BACKUP_ARCHIVE"
fi
ln -sfn "$RELEASE_DIR" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-api.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-worker.service" /etc/systemd/system/
systemctl daemon-reload
runuser -u kafedra-planner -- env \
  KAFEDRA_DATA_DIR="$DATA_DIR" \
  KAFEDRA_DATABASE_PATH="$DATA_DIR/kafedra-planner.sqlite3" \
  KAFEDRA_APPLICATION_DIR="$RELEASE_DIR" \
  KAFEDRA_CONFIG_PATH="$CONFIG_FILE" \
  KAFEDRA_BACKUP_DIR="$BACKUP_DIR" \
  KAFEDRA_SKIP_AUTO_BACKUP=true \
  "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/migrate.mjs"
systemctl enable --now "$API_SERVICE" "$WORKER_SERVICE"
load_environment
health_request() {
  KAFEDRA_PORT="${KAFEDRA_PORT:-8080}" "$RELEASE_DIR/runtime/node/bin/node" -e '
const http = require("node:http");
const port = Number(process.env.KAFEDRA_PORT || 8080);
const request = http.get({ host: "127.0.0.1", port, path: "/api/system/health", timeout: 3000 }, (response) => {
  response.resume();
  process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
});
request.on("timeout", () => request.destroy(new Error("timeout")));
request.on("error", () => { process.exitCode = 1; });
'
}
HEALTH_OK=false
for _attempt in {1..15}; do
  if systemctl is-active --quiet "$API_SERVICE" \
    && systemctl is-active --quiet "$WORKER_SERVICE" \
    && health_request; then
    HEALTH_OK=true
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != true ]]; then
  echo "Службы не вышли в рабочее состояние после установки." >&2
  journalctl -u "$API_SERVICE" -u "$WORKER_SERVICE" -n 80 --no-pager >&2 || true
  false
fi
trap - ERR
echo "Установлен релиз $RELEASE_ID (версия $VERSION)"
[[ -n "$BACKUP_ARCHIVE" ]] && echo "Точка отката: $BACKUP_ARCHIVE"
