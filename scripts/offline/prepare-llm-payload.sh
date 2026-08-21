#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME=""; OUTPUT=""; DEFAULT_MODEL=""; ENABLED=true; HOST=127.0.0.1; PORT=8081; CONTEXT_SIZE=8192; THREADS=0; PARALLEL=1
MODELS=()
usage() {
  cat <<'HELP'
Использование:
  prepare-llm-payload.sh --llama-runtime DIR --model ALIAS=/path/model.gguf [--model ...] --output DIR [options]

DIR должен содержать bin/llama-server и необходимые ему shared libraries.
Модели копируются как models/ALIAS.gguf, проверяются SHA-256 и не попадают в Git.

Параметры:
  --default-model ALIAS        модель, запускаемая после установки (по умолчанию первая)
  --disabled-by-default        доставить модели, но не включать LLM автоматически
  --port N                     localhost port (8081)
  --context-size N             llama.cpp context (8192)
  --threads N                  0 = выбор llama.cpp, иначе явное число
  --parallel N                 параллельные slots (1)
HELP
}
while (($#)); do
  case "$1" in
    --llama-runtime) RUNTIME="$2"; shift 2;;
    --model) MODELS+=("$2"); shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    --default-model) DEFAULT_MODEL="$2"; shift 2;;
    --disabled-by-default) ENABLED=false; shift;;
    --port) PORT="$2"; shift 2;;
    --context-size) CONTEXT_SIZE="$2"; shift 2;;
    --threads) THREADS="$2"; shift 2;;
    --parallel) PARALLEL="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Неизвестный параметр: $1" >&2; usage >&2; exit 2;;
  esac
done
[[ -n "$RUNTIME" && -d "$RUNTIME" ]] || { echo 'Укажите --llama-runtime DIR.' >&2; exit 2; }
[[ -x "$RUNTIME/bin/llama-server" ]] || { echo 'В runtime отсутствует executable bin/llama-server.' >&2; exit 2; }
LLAMA_LICENSE=""
for candidate in "$RUNTIME/LICENSE" "$RUNTIME/LICENSE.md" "$RUNTIME/COPYING"; do [[ ! -f "$candidate" ]] || { LLAMA_LICENSE="$candidate"; break; }; done
[[ -n "$LLAMA_LICENSE" ]] || { echo 'В runtime отсутствует LICENSE/LICENSE.md/COPYING llama.cpp.' >&2; exit 2; }
[[ ${#MODELS[@]} -gt 0 ]] || { echo 'Добавьте хотя бы одну --model ALIAS=FILE.gguf.' >&2; exit 2; }
[[ -n "$OUTPUT" ]] || { echo 'Укажите --output DIR.' >&2; exit 2; }
[[ ! -e "$OUTPUT" ]] || { echo "Каталог уже существует: $OUTPUT" >&2; exit 2; }
for command in cp find sha256sum; do command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда: $command" >&2; exit 2; }; done
mkdir -p "$OUTPUT/runtime" "$OUTPUT/models"
cp -aL "$RUNTIME/." "$OUTPUT/runtime/"
[[ -x "$OUTPUT/runtime/bin/llama-server" ]] || chmod 0755 "$OUTPUT/runtime/bin/llama-server"
UNSUPPORTED="$(find "$OUTPUT/runtime" ! -type f ! -type d -print -quit)"
[[ -z "$UNSUPPORTED" ]] || { echo "Runtime содержит неподдерживаемый объект: $UNSUPPORTED" >&2; exit 2; }
if command -v ldd >/dev/null 2>&1; then
  LDD_OUTPUT="$(LD_LIBRARY_PATH="$OUTPUT/runtime/bin:$OUTPUT/runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$OUTPUT/runtime/bin/llama-server" 2>&1 || true)"
  grep -q 'not found' <<<"$LDD_OUTPUT" && { echo "llama-server имеет неразрешённые зависимости:" >&2; printf '%s\n' "$LDD_OUTPUT" >&2; exit 3; }
fi
SEEN='|'
for spec in "${MODELS[@]}"; do
  alias="${spec%%=*}"; source="${spec#*=}"
  [[ "$spec" == *=* && "$alias" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo "Некорректная модель: $spec; ожидается ALIAS=FILE.gguf" >&2; exit 2; }
  [[ "$SEEN" != *"|$alias|"* ]] || { echo "Повтор alias: $alias" >&2; exit 2; }
  SEEN+="$alias|"
  [[ -f "$source" && "${source,,}" == *.gguf ]] || { echo "GGUF не найден: $source" >&2; exit 2; }
  cp -L "$source" "$OUTPUT/models/$alias.gguf"
  [[ -n "$DEFAULT_MODEL" ]] || DEFAULT_MODEL="$alias"
done
node "$SCRIPT_DIR/llm-contract.mjs" write --root "$OUTPUT" --output "$OUTPUT/manifest.json" \
  --default-model "$DEFAULT_MODEL" --enabled-by-default "$ENABLED" --host "$HOST" --port "$PORT" \
  --context-size "$CONTEXT_SIZE" --threads "$THREADS" --parallel "$PARALLEL" >/dev/null
node "$SCRIPT_DIR/llm-contract.mjs" verify --root "$OUTPUT" >/dev/null
printf '%s\n' "$OUTPUT"
