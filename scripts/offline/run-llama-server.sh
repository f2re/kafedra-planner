#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${KAFEDRA_APPLICATION_DIR:-/opt/kafedra-planner/current}"
CONFIG="${KAFEDRA_CONFIG_PATH:-/etc/kafedra-planner/kafedra-planner.env}"
PARSER="$ROOT/scripts/offline/environment-file.sh"
[[ -f "$PARSER" ]] || { echo "Не найден parser конфигурации: $PARSER" >&2; exit 2; }
# shellcheck source=/dev/null
source "$PARSER"
[[ ! -f "$CONFIG" ]] || kafedra_read_environment_file "$CONFIG"
[[ "${KAFEDRA_LLM_MANAGED:-false}" == true ]] || { echo 'Managed llama-server выключен конфигурацией.' >&2; exit 2; }
[[ "${KAFEDRA_LLM_ENABLED:-false}" == true ]] || { echo 'LLM выключен конфигурацией.' >&2; exit 2; }
SERVER="$ROOT/runtime/llama/bin/llama-server"
MODEL_PATH="${KAFEDRA_LLM_MODEL_PATH:-}"
MODEL_ALIAS="${KAFEDRA_LLM_MODEL:-local-model}"
HOST="${KAFEDRA_LLM_HOST:-127.0.0.1}"
PORT="${KAFEDRA_LLM_PORT:-8081}"
CTX="${KAFEDRA_LLM_CONTEXT_SIZE:-8192}"
THREADS="${KAFEDRA_LLM_THREADS:-0}"
PARALLEL="${KAFEDRA_LLM_PARALLEL:-1}"
[[ "$HOST" == 127.0.0.1 ]] || { echo 'Managed llama-server разрешён только на 127.0.0.1.' >&2; exit 2; }
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || { echo 'Некорректный KAFEDRA_LLM_PORT.' >&2; exit 2; }
[[ -x "$SERVER" ]] || { echo "Не найден llama-server: $SERVER" >&2; exit 2; }
[[ -f "$MODEL_PATH" ]] || { echo "Не найдена GGUF-модель: $MODEL_PATH" >&2; exit 2; }
[[ "$MODEL_ALIAS" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo 'Некорректный alias модели.' >&2; exit 2; }
ARGS=(--host "$HOST" --port "$PORT" --model "$MODEL_PATH" --alias "$MODEL_ALIAS" --ctx-size "$CTX" --parallel "$PARALLEL")
if [[ "$THREADS" =~ ^[0-9]+$ ]] && ((THREADS > 0)); then ARGS+=(--threads "$THREADS"); fi
export LD_LIBRARY_PATH="$ROOT/runtime/llama/bin:$ROOT/runtime/llama/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$SERVER" "${ARGS[@]}"
