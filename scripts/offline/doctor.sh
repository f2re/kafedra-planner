#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
NODE="$ROOT/runtime/node/bin/node"
PYTHON="$ROOT/runtime/python/python"
OCR="$ROOT/scripts/recognition/ocr.py"
ENV_PARSER="$ROOT/scripts/offline/environment-file.sh"
[[ -x "$NODE" ]] || { echo "✗ Node runtime: $NODE" >&2; exit 2; }
[[ -x "$PYTHON" ]] || { echo "✗ Python runtime: $PYTHON" >&2; exit 2; }
[[ -f "$OCR" ]] || { echo "✗ OCR adapter: $OCR" >&2; exit 2; }
[[ -f "$ENV_PARSER" ]] || { echo "✗ Парсер конфигурации: $ENV_PARSER" >&2; exit 2; }
# shellcheck source=/dev/null
source "$ENV_PARSER"
[[ ! -f "$CONFIG" ]] || kafedra_read_environment_file "$CONFIG"
LANGUAGES="${KAFEDRA_OCR_LANGUAGES:-rus+eng}"
echo "✓ Node: $($NODE --version)"
"$PYTHON" "$OCR" doctor --languages "$LANGUAGES"
"$NODE" "$ROOT/scripts/system-preflight.mjs" --require-full
if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active --quiet kafedra-planner-api.service && echo '✓ API service active' || { echo '✗ API service inactive' >&2; exit 3; }
  systemctl is-active --quiet kafedra-planner-worker.service && echo '✓ Worker service active' || { echo '✗ Worker service inactive' >&2; exit 3; }
fi
PORT="${KAFEDRA_PORT:-8080}"
KAFEDRA_PORT="$PORT" "$NODE" -e '
const http=require("node:http");
const req=http.get({host:"127.0.0.1",port:Number(process.env.KAFEDRA_PORT),path:"/api/system/health",timeout:3000},r=>{r.resume();process.exit(r.statusCode>=200&&r.statusCode<300?0:1)});
req.on("timeout",()=>req.destroy());req.on("error",()=>process.exit(1));
' && echo "✓ HTTP health: 127.0.0.1:$PORT" || { echo "✗ HTTP health" >&2; exit 3; }
if [[ "${KAFEDRA_LLM_ENABLED:-false}" == true ]]; then
  LLM_ARGS=()
  [[ "${KAFEDRA_LLM_MANAGED:-false}" == true ]] || LLM_ARGS+=(--optional)
  KAFEDRA_APPLICATION_DIR="$ROOT" KAFEDRA_CONFIG_PATH="$CONFIG" "$NODE" "$ROOT/scripts/llm-doctor.mjs" "${LLM_ARGS[@]}"
else
  echo '✓ LLM: выключен (основной контур автономен)'
fi
echo 'Kafedra Planner: готов к работе.'
