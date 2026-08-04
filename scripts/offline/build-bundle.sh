#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
WORK_DIR="$(mktemp -d)"
BUNDLE_ROOT="$WORK_DIR/kafedra-planner-$VERSION"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$OUT_DIR" "$BUNDLE_ROOT/application" "$BUNDLE_ROOT/runtime"
cp -a \
  "$ROOT/apps" "$ROOT/packages" "$ROOT/public" "$ROOT/migrations" \
  "$ROOT/scripts" "$ROOT/deploy" "$ROOT/docs" "$ROOT/tests" \
  "$ROOT/package.json" "$ROOT/VERSION" "$ROOT/README.md" \
  "$ROOT/SECURITY.md" "$ROOT/.env.example" \
  "$BUNDLE_ROOT/application/"
cp "$ROOT/deploy/install.sh" "$BUNDLE_ROOT/install.sh"
chmod +x "$BUNDLE_ROOT/install.sh"

if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
  [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || { echo "NODE_RUNTIME_DIR не содержит bin/node" >&2; exit 2; }
  cp -a "$NODE_RUNTIME_DIR" "$BUNDLE_ROOT/runtime/node"
fi

cat > "$BUNDLE_ROOT/release.json" <<JSON
{
  "name": "kafedra-planner",
  "version": "$VERSION",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitCommit": "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)",
  "nodeRuntimeIncluded": $([[ -x "$BUNDLE_ROOT/runtime/node/bin/node" ]] && echo true || echo false)
}
JSON

(
  cd "$BUNDLE_ROOT"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256
)

ARCHIVE="$OUT_DIR/kafedra-planner-$VERSION.tar.gz"
tar -C "$WORK_DIR" -czf "$ARCHIVE" "kafedra-planner-$VERSION"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
echo "$ARCHIVE"
