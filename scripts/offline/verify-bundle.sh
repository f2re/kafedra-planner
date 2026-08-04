#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "Использование: $0 <bundle.tar.gz>" >&2; exit 2; }
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

tar -tzf "$ARCHIVE" >/dev/null
tar -xzf "$ARCHIVE" -C "$WORK_DIR"
ROOT="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)"
[[ -f "$ROOT/manifest.sha256" && -f "$ROOT/release.json" ]] || { echo "Комплект неполон" >&2; exit 3; }
(
  cd "$ROOT"
  sha256sum -c manifest.sha256
)
NODE="$ROOT/runtime/node/bin/node"
if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
[[ -n "$NODE" ]] || { echo "Нет встроенного или системного Node.js" >&2; exit 4; }
"$NODE" --version
(
  cd "$ROOT/application"
  KAFEDRA_DATA_DIR="$WORK_DIR/data" "$NODE" scripts/smoke-test.mjs
)
echo "Комплект проверен"
