#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
RUNTIME=""; DEFAULT_MODEL=""; ENABLED=true; PORT=8081; CONTEXT_SIZE=8192; THREADS=0; PARALLEL=1; PYTHON_BIN=python3
MODELS=(); FORWARD=()
usage() {
  cat <<'HELP'
Использование:
  npm run bundle:offline:llm -- --llama-runtime DIR --model ALIAS=/path/model.gguf [--model ...] [options]

Создаёт обычный полный Astra/Debian offline bundle и добавляет в него managed
llama.cpp runtime + 1..N локальных GGUF. Интернет на целевой машине не нужен.

Опции LLM:
  --default-model ALIAS
  --disabled-by-default
  --port N --context-size N --threads N --parallel N

Опции full bundle:
  --output DIR --python PYTHON --reuse-os-packages --refresh-os-packages --apt-update
HELP
}
while (($#)); do
  case "$1" in
    --llama-runtime) RUNTIME="$2"; shift 2;;
    --model) MODELS+=("$2"); shift 2;;
    --default-model) DEFAULT_MODEL="$2"; shift 2;;
    --disabled-by-default) ENABLED=false; shift;;
    --port) PORT="$2"; shift 2;;
    --context-size) CONTEXT_SIZE="$2"; shift 2;;
    --threads) THREADS="$2"; shift 2;;
    --parallel) PARALLEL="$2"; shift 2;;
    --output) OUT_DIR="$2"; FORWARD+=(--output "$2"); shift 2;;
    --python) PYTHON_BIN="$2"; FORWARD+=(--python "$2"); shift 2;;
    --reuse-os-packages|--refresh-os-packages|--apt-update) FORWARD+=("$1"); shift;;
    -h|--help) usage; exit 0;;
    *) echo "Неизвестный параметр: $1" >&2; usage >&2; exit 2;;
  esac
done
[[ -n "$RUNTIME" ]] || { echo 'Укажите --llama-runtime DIR.' >&2; exit 2; }
[[ ${#MODELS[@]} -gt 0 ]] || { echo 'Добавьте хотя бы одну --model ALIAS=FILE.gguf.' >&2; exit 2; }
PAYLOAD="$(mktemp -d)"; trap 'rm -rf "$PAYLOAD"' EXIT
PREPARE=(--llama-runtime "$RUNTIME" --output "$PAYLOAD/payload" --port "$PORT" --context-size "$CONTEXT_SIZE" --threads "$THREADS" --parallel "$PARALLEL")
[[ "$ENABLED" == true ]] || PREPARE+=(--disabled-by-default)
[[ -z "$DEFAULT_MODEL" ]] || PREPARE+=(--default-model "$DEFAULT_MODEL")
for model in "${MODELS[@]}"; do PREPARE+=(--model "$model"); done
"$SCRIPT_DIR/prepare-llm-payload.sh" "${PREPARE[@]}" >/dev/null
mkdir -p "$OUT_DIR"
ARCHIVE="$({ KAFEDRA_LLM_PAYLOAD_DIR="$PAYLOAD/payload" KAFEDRA_FULL_BUNDLE_TAG_SUFFIX=llm OUT_DIR="$OUT_DIR" "$SCRIPT_DIR/build-full-bundle.sh" "${FORWARD[@]}"; } | tail -n 1)"
[[ -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || { echo 'LLM full bundle не создан.' >&2; exit 4; }
{
  echo
  echo 'LLAMA.CPP / GGUF'
  echo 'В этом комплекте есть локальный managed llama-server и GGUF-модели.'
  echo "Модель по умолчанию: $(node "$SCRIPT_DIR/llm-contract.mjs" values --root "$PAYLOAD/payload" | sed -n '2p')"
  echo 'После установки: /opt/kafedra-planner/current/scripts/llm-doctor.mjs'
  echo 'Отключение без удаления моделей: KAFEDRA_LLM_ENABLED=false в /etc/kafedra-planner/kafedra-planner.env, затем повторный install или systemctl disable --now kafedra-planner-llama.service.'
} >> "$OUT_DIR/README-INSTALL.txt"
printf '%s\n' "$ARCHIVE"
