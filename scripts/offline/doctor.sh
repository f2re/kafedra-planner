#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
NODE="$ROOT/runtime/node/bin/node"
PYTHON="$ROOT/runtime/python/python"
OCR="$ROOT/scripts/recognition/ocr.py"
ENV_PARSER="$ROOT/scripts/offline/environment-file.sh"
MODE="${1:-}"
ALLOW_DEGRADED="${KAFEDRA_DOCTOR_ALLOW_DEGRADED:-false}"
if [[ "$MODE" == "--repair" || "$MODE" == "--auto-repair" || "$MODE" == "--heal" ]]; then
  ALLOW_DEGRADED=true
fi
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
  if ! "$PYTHON" "$OCR" doctor --languages "$LANGUAGES" --self-test; then
    DEGRADED=true
    echo "– OCR $LANGUAGES или контрольное распознавание недоступно; календарь, задачи, данные и исходные документы продолжают работать." >&2
  fi
else
  "$PYTHON" "$OCR" doctor --languages "$LANGUAGES" --self-test
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
if [[ "$MODE" == "--repair" || "$MODE" == "--auto-repair" || "$MODE" == "--heal" ]]; then
  echo "=== Автоматическое устранение проблем и восстановление возможностей ==="
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Для автоматического устранения требуются права root (sudo $0 --repair)" >&2
    exit 2
  fi
  audit="$(dpkg --audit 2>&1 || true)"
  if [[ -n "$audit" ]]; then
    echo "Выполняю безопасное завершение конфигурации пакетов (dpkg --configure -a)..."
    dpkg --configure -a || true
    audit="$(dpkg --audit 2>&1 || true)"
    if [[ -z "$audit" ]]; then echo "✓ dpkg --audit: ошибки устранены"; else echo "✗ dpkg --audit: $audit" >&2; fi
  else
    echo "✓ dpkg --audit: чисто"
  fi
  if ! LC_ALL=C apt-get check >/dev/null 2>&1; then
    echo "✗ apt-get check имеет неудовлетворённые зависимости сторонних пакетов." >&2
    LC_ALL=C apt-get check >&2 || true
    echo "Устраните конфликт стороннего ПО в APT и повторите команду." >&2
  else
    echo "✓ apt-get check: чисто"
    if [[ -d "$ROOT/os-packages" ]]; then
      echo "Доустанавливаю недостающие компоненты из сохранённого автономного payload $ROOT/os-packages..."
      if KAFEDRA_APT_MODE=bundle "$ROOT/scripts/offline/install-os-packages.sh" "$ROOT/os-packages" --scope all; then
        echo "✓ Системные компоненты успешно добавлены из установленного release."
      else
        echo "– Пакеты не удалось добавить полностью; ядро продолжает работать." >&2
      fi
    else
      echo "✗ В активном release отсутствует сохранённый os-packages payload; используйте полный совместимый bundle." >&2
    fi
  fi
  echo ""
  echo "=== Итоговая строгая проверка системы ==="
  exec env KAFEDRA_DOCTOR_ALLOW_DEGRADED=false "$0"
fi

if [[ "$MODE" == "--diagnose-apt" ]]; then
  echo "=== Диагностика состояния пакетов ОС ==="
  audit="$(dpkg --audit 2>&1 || true)"
  if [[ -n "$audit" ]]; then
    echo "✗ dpkg --audit обнаружил незавершённые операции:"
    printf '%s\n' "$audit"
    echo "  Рекомендация: выполните 'sudo dpkg --configure -a' или 'sudo $0 --repair'"
  else
    echo "✓ dpkg --audit: чисто"
  fi
  apt_check="$(LC_ALL=C apt-get check 2>&1 || true)"
  if ! LC_ALL=C apt-get check >/dev/null 2>&1; then
    echo "✗ apt-get check обнаружил ошибки зависимостей:"
    printf '%s\n' "$apt_check"
    echo "  Рекомендация: устраните конфликтующие пакеты штатными средствами администратора ОС"
  else
    echo "✓ apt-get check: зависимости в порядке"
  fi
  exit 0
fi

if [[ "$DEGRADED" == true ]]; then
  echo 'Kafedra Planner: ядро готово; часть обработки документов недоступна.'
  if [[ -d "$ROOT/os-packages" ]]; then
    echo 'Для восстановления полной обработки документов после исправления APT ОС выполните:'
    echo "  sudo \"$ROOT/scripts/offline/doctor.sh\" --repair"
  fi
else
  echo 'Kafedra Planner: готов к работе.'
fi
