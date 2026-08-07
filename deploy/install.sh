#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Установку необходимо запускать от root" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/application" && -d "$SCRIPT_DIR/runtime" ]]; then
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
RELEASE_DIR="$APP_ROOT/releases/$VERSION"
DATA_DIR="/var/lib/kafedra-planner"
BACKUP_DIR="/var/backups/kafedra-planner"
CONFIG_DIR="/etc/kafedra-planner"
CONFIG_FILE="$CONFIG_DIR/kafedra-planner.env"
API_SERVICE="kafedra-planner-api.service"
WORKER_SERVICE="kafedra-planner-worker.service"

[[ -x "$RUNTIME_SOURCE/bin/node" ]] || { echo "В комплекте отсутствует runtime/node/bin/node" >&2; exit 3; }
id kafedra-planner >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin kafedra-planner
install -d -o root -g root -m 0755 "$APP_ROOT/releases"
install -d -o kafedra-planner -g kafedra-planner -m 0700 "$DATA_DIR" "$DATA_DIR/blobs" "$DATA_DIR/tmp" "$BACKUP_DIR"
install -d -o root -g kafedra-planner -m 0750 "$CONFIG_DIR"

if [[ -e "$RELEASE_DIR" ]]; then
  echo "Версия $VERSION уже установлена: $RELEASE_DIR" >&2
  exit 4
fi
mkdir -p "$RELEASE_DIR"
cp -a "$APP_SOURCE/." "$RELEASE_DIR/"
mkdir -p "$RELEASE_DIR/runtime"
cp -a "$RUNTIME_SOURCE" "$RELEASE_DIR/runtime/node"
chown -R root:root "$RELEASE_DIR"
chmod -R go-w "$RELEASE_DIR"

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
chown root:kafedra-planner "$CONFIG_FILE"
chmod 0640 "$CONFIG_FILE"

for command in unzip pdftotext pdftoppm tesseract tar sha256sum curl; do
  command -v "$command" >/dev/null 2>&1 || echo "Предупреждение: $command не найден; часть функций будет недоступна." >&2
done
if ! command -v soffice >/dev/null 2>&1 && ! command -v libreoffice >/dev/null 2>&1; then
  echo "Предупреждение: LibreOffice не найден; предпросмотр DOCX/XLSX/ODT/ODS будет недоступен." >&2
fi

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
sleep 2
load_environment
curl --fail --silent "http://127.0.0.1:${KAFEDRA_PORT:-8080}/api/system/health" >/dev/null || {
  journalctl -u "$API_SERVICE" -n 50 --no-pager >&2
  false
}
trap - ERR
echo "Установлена версия $VERSION"
[[ -n "$BACKUP_ARCHIVE" ]] && echo "Точка отката: $BACKUP_ARCHIVE"
