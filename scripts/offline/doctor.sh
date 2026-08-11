#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
NODE="$ROOT/runtime/node/bin/node"
PYTHON="$ROOT/runtime/python/python"
OCR="$ROOT/scripts/recognition/ocr.py"
[[ -x "$NODE" ]] || { echo "✗ Node runtime: $NODE" >&2; exit 2; }
[[ -x "$PYTHON" ]] || { echo "✗ Python runtime: $PYTHON" >&2; exit 2; }
[[ -f "$OCR" ]] || { echo "✗ OCR adapter: $OCR" >&2; exit 2; }
set -a
[[ ! -f "$CONFIG" ]] || source "$CONFIG"
set +a
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
echo 'Kafedra Planner: готов к работе.'
