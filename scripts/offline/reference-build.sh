#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-/src}"
OUTPUT_DIR="${2:-/out}"
[[ -d "$SOURCE_ROOT" && -f "$SOURCE_ROOT/package.json" ]] || { echo "Reference source не найден: $SOURCE_ROOT" >&2; exit 2; }
mkdir -p "$OUTPUT_DIR"

command -v apt-get >/dev/null 2>&1 || { echo "Reference image не содержит apt-get" >&2; exit 2; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  python3 ca-certificates curl xz-utils binutils systemd dpkg findutils coreutils grep sed mawk tar gzip
for command in python3 curl sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "После подготовки reference image не содержит $command" >&2; exit 2; }
done

mapfile -t node_policy < <(python3 - "$SOURCE_ROOT/package.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as stream:
    package = json.load(stream)
policy = package['kafedra']['offlineRuntime']
archive = policy['archives']['linux-x64']
print(str(policy['node']).lstrip('v'))
print(str(policy.get('distBaseUrl') or 'https://nodejs.org/dist').rstrip('/'))
print(archive['file'])
print(archive['sha256'].lower())
PY
)
NODE_VERSION="${node_policy[0]:-}"
NODE_DIST_BASE="${node_policy[1]:-}"
NODE_ARCHIVE="${node_policy[2]:-}"
NODE_SHA256="${node_policy[3]:-}"
[[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$NODE_ARCHIVE" == *linux-x64.tar.gz && "$NODE_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Некорректная политика host Node.js в package.json" >&2
  exit 3
}
NODE_WORK="$(mktemp -d /tmp/kafedra-reference-node.XXXXXX)"
trap 'rm -rf "$NODE_WORK"' EXIT
curl --fail --location --silent --show-error --retry 3 --connect-timeout 15 \
  --output "$NODE_WORK/$NODE_ARCHIVE" \
  "$NODE_DIST_BASE/v$NODE_VERSION/$NODE_ARCHIVE"
printf '%s  %s\n' "$NODE_SHA256" "$NODE_ARCHIVE" > "$NODE_WORK/node.sha256"
(cd "$NODE_WORK" && sha256sum -c --strict node.sha256 >/dev/null)
tar -xzf "$NODE_WORK/$NODE_ARCHIVE" -C "$NODE_WORK"
NODE_HOME="$NODE_WORK/${NODE_ARCHIVE%.tar.gz}"
[[ -x "$NODE_HOME/bin/node" && -f "$NODE_HOME/LICENSE" ]] || { echo "Официальный Node.js archive имеет неожиданную структуру" >&2; exit 3; }
export PATH="$NODE_HOME/bin:$PATH"
node --version

cd "$SOURCE_ROOT"
OUT_DIR="$OUTPUT_DIR" KAFEDRA_FULL_BUNDLE_CACHE_DIR=/tmp/kafedra-full-bundle-cache \
  bash scripts/offline/build-full-bundle.sh
