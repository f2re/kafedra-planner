#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
NODE="$ROOT/runtime/node/bin/node"
PYTHON="$ROOT/runtime/python/python"
OCR="$ROOT/scripts/recognition/ocr.py"
ENV_PARSER="$ROOT/scripts/offline/environment-file.sh"
PACKAGE_LIB="$ROOT/scripts/offline/lib.sh"
PACKAGE_INSTALLER="$ROOT/scripts/offline/install-os-packages.sh"
MODE="${1:-}"
ALLOW_DEGRADED="${KAFEDRA_DOCTOR_ALLOW_DEGRADED:-false}"
CACHE_ROOT="${KAFEDRA_OS_PACKAGE_CACHE_ROOT:-/var/cache/kafedra-planner/os-packages}"

[[ "$ALLOW_DEGRADED" == true || "$ALLOW_DEGRADED" == false ]] || { echo "Некорректный KAFEDRA_DOCTOR_ALLOW_DEGRADED=$ALLOW_DEGRADED" >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "✗ Node runtime: $NODE" >&2; exit 2; }
[[ -x "$PYTHON" ]] || { echo "✗ Python runtime: $PYTHON" >&2; exit 2; }
[[ -f "$OCR" ]] || { echo "✗ OCR adapter: $OCR" >&2; exit 2; }
[[ -f "$ENV_PARSER" ]] || { echo "✗ Парсер конфигурации: $ENV_PARSER" >&2; exit 2; }
# shellcheck source=/dev/null
source "$ENV_PARSER"
[[ ! -f "$CONFIG" ]] || kafedra_read_environment_file "$CONFIG"
LANGUAGES="${KAFEDRA_OCR_LANGUAGES:-rus+eng}"

resolve_package_payload() {
  local candidate="" resolved=""
  if [[ -f "$ROOT/os-package-cache" && ! -L "$ROOT/os-package-cache" ]]; then
    IFS= read -r candidate < "$ROOT/os-package-cache" || true
    if [[ "$candidate" == "$CACHE_ROOT"/* && -d "$candidate" && ! -L "$candidate" ]]; then
      resolved="$(readlink -f "$candidate" 2>/dev/null || true)"
      if [[ "$resolved" == "$CACHE_ROOT"/* && -d "$resolved" ]]; then
        printf '%s' "$resolved"
        return 0
      fi
    fi
    echo "✗ Указатель os-package-cache повреждён или выходит за управляемый cache root." >&2
    return 1
  fi
  if [[ -d "$ROOT/os-packages" && ! -L "$ROOT/os-packages" ]]; then
    printf '%s' "$ROOT/os-packages"
    return 0
  fi
  return 1
}

repair_document_runtime() {
  echo "=== Автоматическое восстановление document runtime ==="
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Для восстановления требуются права root (sudo $0 --repair)" >&2
    return 2
  fi
  [[ -f "$PACKAGE_LIB" && -x "$PACKAGE_INSTALLER" ]] || {
    echo "✗ В release отсутствуют скрипты безопасной установки пакетов ОС." >&2
    return 2
  }

  local audit payload
  audit="$(dpkg --audit 2>&1 || true)"
  if [[ -n "$audit" ]]; then
    echo "Завершаю прерванную конфигурацию пакетов (dpkg --configure -a)..."
    LC_ALL=C DEBIAN_FRONTEND=noninteractive dpkg --configure -a
    audit="$(dpkg --audit 2>&1 || true)"
    [[ -z "$audit" ]] || { echo "✗ dpkg --audit: $audit" >&2; return 3; }
  fi
  LC_ALL=C apt-get check >/dev/null 2>&1 || {
    echo "✗ APT имеет неудовлетворённые зависимости сторонних пакетов; automatic --fix-broken запрещён." >&2
    LC_ALL=C apt-get check >&2 || true
    return 3
  }

  payload="$(resolve_package_payload)" || {
    echo "✗ Не найден verified os-package-cache и отсутствует совместимый legacy payload $ROOT/os-packages." >&2
    return 3
  }
  # shellcheck source=/dev/null
  source "$PACKAGE_LIB"
  verify_os_package_set "$payload" 1
  echo "Использую проверенный автономный payload: $payload"
  KAFEDRA_APT_MODE=bundle "$PACKAGE_INSTALLER" "$payload" --scope all
  echo "✓ Недостающие OCR/PDF/Office компоненты добавлены из локального payload."
}

if [[ "$MODE" == "--repair" || "$MODE" == "--auto-repair" || "$MODE" == "--heal" ]]; then
  repair_document_runtime
  echo
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
  if LC_ALL=C apt-get check >/dev/null 2>&1; then
    echo "✓ apt-get check: зависимости в порядке"
  else
    echo "✗ apt-get check обнаружил ошибки зависимостей:"
    LC_ALL=C apt-get check >&2 || true
  fi
  if payload="$(resolve_package_payload 2>/dev/null)"; then
    echo "✓ os-package-cache: $payload"
  else
    echo "– os-package-cache: verified payload не найден"
  fi
  exit 0
fi

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
    echo "– OCR $LANGUAGES или контрольные smoke_pdf/smoke_tesseract недоступны; ядро продолжает работать." >&2
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

if [[ "$DEGRADED" == true ]]; then
  echo 'Kafedra Planner: ядро готово; часть обработки документов недоступна.'
  echo 'Для восстановления полной обработки выполните:'
  echo "  sudo \"$ROOT/scripts/offline/doctor.sh\" --repair"
else
  echo 'Kafedra Planner: готов к работе.'
fi
