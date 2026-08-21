#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
NODE="$ROOT/runtime/node/bin/node"
PYTHON="$ROOT/runtime/python/python"
OCR="$ROOT/scripts/recognition/ocr.py"
ENV_PARSER="$ROOT/scripts/offline/environment-file.sh"
ALLOW_DEGRADED="${KAFEDRA_DOCTOR_ALLOW_DEGRADED:-false}"
[[ "$ALLOW_DEGRADED" == true || "$ALLOW_DEGRADED" == false ]] || { echo "Некорректный KAFEDRA_DOCTOR_ALLOW_DEGRADED=$ALLOW_DEGRADED" >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "✗ Node runtime: $NODE" >&2; exit 2; }
[[ -x "$PYTHON" ]] || { echo "✗ Python runtime: $PYTHON" >&2; exit 2; }
[[ -f "$OCR" ]] || { echo "✗ OCR adapter: $OCR" >&2; exit 2; }
[[ -f "$ENV_PARSER" ]] || { echo "✗ Парсер конфигурации: $ENV_PARSER" >&2; exit 2; }
# shellcheck source=/dev/null
source "$ENV_PARSER"
[[ ! -f "$CONFIG" ]] || kafedra_read_environment_file "$CONFIG"
LANGUAGES="${KAFEDRA_OCR_LANGUAGES:-rus+eng}"
DEGRADED=false
echo "✓ Node: $($NODE --version)"
if [[ "$ALLOW_DEGRADED" == true ]]; then
  PREFLIGHT_JSON="$("$NODE" "$ROOT/scripts/system-preflight.mjs" --json)"
  "$NODE" "$ROOT/scripts/system-preflight.mjs" --strict
  if ! "$NODE" -e '
const p=JSON.parse(process.argv[1]);
const c=p.capabilities||{};
process.exit(c.officeExtract&&c.pdfText&&c.ocr&&c.officePreview?0:1);
' "$PREFLIGHT_JSON"; then
    DEGRADED=true
  fi
  if ! "$PYTHON" "$OCR" doctor --languages "$LANGUAGES"; then
    DEGRADED=true
    echo "– OCR $LANGUAGES недоступен; календарь, задачи, данные и исходные документы продолжают работать." >&2
  fi
else
  # Default doctor remains the strict release/acceptance gate. The installer
  # opts into degraded mode explicitly only after a non-mutating package failure.
  "$PYTHON" "$OCR" doctor --languages "$LANGUAGES"
  "$NODE" "$ROOT/scripts/system-preflight.mjs" --require-full
fi
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
if [[ "$DEGRADED" == true ]]; then
  echo 'Kafedra Planner: ядро готово; часть обработки документов недоступна.'
else
  echo 'Kafedra Planner: готов к работе.'
fi
