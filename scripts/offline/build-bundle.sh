#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
WORK_DIR="$(mktemp -d)"
BUNDLE_ROOT="$WORK_DIR/kafedra-planner-$VERSION"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$OUT_DIR" "$BUNDLE_ROOT/application" "$BUNDLE_ROOT/runtime/node/bin"
cp -a \
  "$ROOT/apps" "$ROOT/packages" "$ROOT/public" "$ROOT/migrations" \
  "$ROOT/scripts" "$ROOT/deploy" "$ROOT/docs" "$ROOT/tests" \
  "$ROOT/package.json" "$ROOT/VERSION" "$ROOT/README.md" \
  "$ROOT/SECURITY.md" "$ROOT/.env.example" \
  "$BUNDLE_ROOT/application/"
cp "$ROOT/deploy/install.sh" "$BUNDLE_ROOT/install.sh"
chmod +x "$BUNDLE_ROOT/install.sh"

NODE_VERSION=""
NODE_PLATFORM=""
NODE_ARCH=""
if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
  [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || { echo "NODE_RUNTIME_DIR не содержит bin/node" >&2; exit 2; }
  install -m 0755 "$NODE_RUNTIME_DIR/bin/node" "$BUNDLE_ROOT/runtime/node/bin/node"
  [[ ! -f "$NODE_RUNTIME_DIR/LICENSE" ]] || cp "$NODE_RUNTIME_DIR/LICENSE" "$BUNDLE_ROOT/runtime/node/LICENSE"
  NODE_VERSION="$("$BUNDLE_ROOT/runtime/node/bin/node" -p 'process.version')"
  NODE_PLATFORM="$("$BUNDLE_ROOT/runtime/node/bin/node" -p 'process.platform')"
  NODE_ARCH="$("$BUNDLE_ROOT/runtime/node/bin/node" -p 'process.arch')"
elif [[ "${REQUIRE_NODE_RUNTIME:-false}" == "true" ]]; then
  echo "Для release-сборки требуется NODE_RUNTIME_DIR со встроенным Node.js" >&2
  exit 3
fi

cat > "$BUNDLE_ROOT/release.json" <<JSON
{
  "name": "kafedra-planner",
  "version": "$VERSION",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitCommit": "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)",
  "nodeRuntimeIncluded": $([[ -x "$BUNDLE_ROOT/runtime/node/bin/node" ]] && echo true || echo false),
  "nodeVersion": $([[ -n "$NODE_VERSION" ]] && printf '"%s"' "$NODE_VERSION" || printf 'null'),
  "nodePlatform": $([[ -n "$NODE_PLATFORM" ]] && printf '"%s"' "$NODE_PLATFORM" || printf 'null'),
  "nodeArch": $([[ -n "$NODE_ARCH" ]] && printf '"%s"' "$NODE_ARCH" || printf 'null')
}
JSON

UNSUPPORTED_ENTRY="$(find "$BUNDLE_ROOT" ! -type f ! -type d -print -quit)"
if [[ -n "$UNSUPPORTED_ENTRY" ]]; then
  echo "Release-комплект не должен содержать симлинки или специальные файлы: $UNSUPPORTED_ENTRY" >&2
  exit 4
fi

(
  cd "$BUNDLE_ROOT"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256
)

ARCHIVE_BASENAME="kafedra-planner-$VERSION.tar.gz"
ARCHIVE="$OUT_DIR/$ARCHIVE_BASENAME"
rm -f "$ARCHIVE" "$ARCHIVE.sha256"
tar -C "$WORK_DIR" -czf "$ARCHIVE" "kafedra-planner-$VERSION"
(
  cd "$OUT_DIR"
  sha256sum "$ARCHIVE_BASENAME" > "$ARCHIVE_BASENAME.sha256"
)
echo "$ARCHIVE"
