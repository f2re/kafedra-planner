#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Сброс PIN-кода необходимо запускать от root." >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE="$APP_DIR/runtime/node/bin/node"
CONFIG_FILE="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
[[ -x "$NODE" ]] || { echo "Не найден встроенный Node.js: $NODE" >&2; exit 2; }
[[ -f "$SCRIPT_DIR/offline/environment-file.sh" ]] || { echo "Не найден parser конфигурации." >&2; exit 2; }
# shellcheck source=/dev/null
source "$SCRIPT_DIR/offline/environment-file.sh"
kafedra_read_environment_file "$CONFIG_FILE"

read -r -s -p 'Новый PIN-код (4 цифры): ' PIN; printf '\n'
[[ "$PIN" =~ ^[0-9]{4}$ ]] || { echo "PIN-код должен состоять ровно из 4 цифр." >&2; exit 2; }
read -r -s -p 'Повторите PIN-код: ' PIN_CONFIRM; printf '\n'
[[ "$PIN" == "$PIN_CONFIRM" ]] || { echo "PIN-коды не совпадают." >&2; exit 2; }

PIN_FILE="$(mktemp /root/kafedra-pin.XXXXXX)"
trap 'rm -f "$PIN_FILE"' EXIT
chmod 0600 "$PIN_FILE"
printf '%s\n' "$PIN" > "$PIN_FILE"
unset PIN PIN_CONFIRM
"$NODE" "$SCRIPT_DIR/reset-pin.mjs" --pin-file "$PIN_FILE"
