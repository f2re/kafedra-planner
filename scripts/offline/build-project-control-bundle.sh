#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
PYTHON="${PROJECT_CONTROL_PYTHON_BIN:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || { echo "Для Project Control ZIP на build-машине нужен python3." >&2; exit 2; }
BUILD_OUTPUT="$($SCRIPT_DIR/build-full-bundle.sh "$@")"
ARCHIVE="$(printf '%s\n' "$BUILD_OUTPUT" | awk 'NF{line=$0} END{print line}')"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || { echo "Full offline builder не вернул готовый archive" >&2; exit 3; }
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
GIT_COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"; fi
PACKAGE_ARGS=(
  --archive "$ARCHIVE"
  --output "$(dirname "$ARCHIVE")"
  --project-id kafedra-planner
  --display-name "Кафедра Planner"
  --adapter kafedra-planner-v1
  --version "$VERSION"
  --source-commit "$GIT_COMMIT"
  --native-format kafedra-full-airgap-v2
)
[[ -z "${F2RE_RELEASE_SIGNING_KEY:-}" ]] || PACKAGE_ARGS+=(--signing-key "$F2RE_RELEASE_SIGNING_KEY")
"$PYTHON" "$SCRIPT_DIR/project-control-package.py" "${PACKAGE_ARGS[@]}"
