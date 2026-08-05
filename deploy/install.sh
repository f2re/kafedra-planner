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
CONFIG_DIR="/etc/kafedra-planner"

[[ -x "$RUNTIME_SOURCE/bin/node" ]] || { echo "В комплекте отсутствует runtime/node/bin/node" >&2; exit 3; }
id kafedra-planner >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin kafedra-planner
install -d -o root -g root -m 0755 "$APP_ROOT/releases"
install -d -o kafedra-planner -g kafedra-planner -m 0700 "$DATA_DIR" "$DATA_DIR/blobs" "$DATA_DIR/tmp"
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

if [[ ! -f "$CONFIG_DIR/kafedra-planner.env" ]]; then
  cat > "$CONFIG_DIR/kafedra-planner.env" <<ENV
KAFEDRA_HOST=127.0.0.1
KAFEDRA_PORT=8080
KAFEDRA_DATA_DIR=$DATA_DIR
KAFEDRA_DATABASE_PATH=$DATA_DIR/kafedra-planner.sqlite3
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
  chown root:kafedra-planner "$CONFIG_DIR/kafedra-planner.env"
  chmod 0640 "$CONFIG_DIR/kafedra-planner.env"
fi

for command in pdftotext pdftoppm tesseract; do
  command -v "$command" >/dev/null 2>&1 || echo "Предупреждение: $command не найден; часть OCR/PDF-функций будет недоступна." >&2
done
if ! command -v soffice >/dev/null 2>&1 && ! command -v libreoffice >/dev/null 2>&1; then
  echo "Предупреждение: LibreOffice не найден; предпросмотр DOCX/XLSX/ODT/ODS будет недоступен." >&2
fi

ln -sfn "$RELEASE_DIR" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-api.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/deploy/systemd/kafedra-planner-worker.service" /etc/systemd/system/
systemctl daemon-reload
runuser -u kafedra-planner -- env KAFEDRA_DATA_DIR="$DATA_DIR" KAFEDRA_DATABASE_PATH="$DATA_DIR/kafedra-planner.sqlite3"   "$RELEASE_DIR/runtime/node/bin/node" "$RELEASE_DIR/scripts/migrate.mjs"
systemctl enable --now kafedra-planner-api.service kafedra-planner-worker.service
sleep 2
curl --fail --silent http://127.0.0.1:8080/api/system/health >/dev/null || {
  journalctl -u kafedra-planner-api.service -n 50 --no-pager >&2
  exit 5
}
echo "Установлена версия $VERSION"
