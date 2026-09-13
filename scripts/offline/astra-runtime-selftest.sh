#!/usr/bin/env bash
set -Eeuo pipefail

OUT_DIR="${1:-}"
BASE_IMAGE="${KAFEDRA_SELFTEST_BASE_IMAGE:-}"
[[ -n "$OUT_DIR" && -d "$OUT_DIR" && -n "$BASE_IMAGE" ]] || {
  echo "Использование: KAFEDRA_SELFTEST_BASE_IMAGE=image astra-runtime-selftest.sh OUT_DIR" >&2
  exit 2
}
for command in docker find sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда: $command" >&2; exit 2; }
done

mapfile -t archives < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print | LC_ALL=C sort)
((${#archives[@]} == 1)) || { echo "Ожидался ровно один archive, найдено: ${#archives[@]}" >&2; exit 3; }
ARCHIVE="${archives[0]}"
ARCHIVE_NAME="$(basename "$ARCHIVE")"
(cd "$OUT_DIR" && sha256sum -c --strict "$ARCHIVE_NAME.sha256" >/dev/null)

TOKEN="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
CONTAINER="kafedra-astra-runtime-$TOKEN"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Standard Astra UBI validates the userspace/package layer. Networking is
# disabled before the release archive is copied in: document capabilities must
# be installed only from the bundle's matching file: repository.
docker run -d --name "$CONTAINER" --network none "$BASE_IMAGE" \
  /bin/sh -c 'while :; do sleep 3600; done' >/dev/null
docker exec "$CONTAINER" mkdir -p /installer
docker cp "$ARCHIVE" "$CONTAINER:/installer/$ARCHIVE_NAME"
docker exec "$CONTAINER" bash -lc "cd /installer && sha256sum '$ARCHIVE_NAME' >/dev/null && mkdir bundle && tar -xzf '$ARCHIVE_NAME' -C bundle"

docker exec "$CONTAINER" bash -lc '
  set -Eeuo pipefail
  ROOT=$(find /installer/bundle -mindepth 1 -maxdepth 1 -type d -print -quit)
  test -n "$ROOT"
  "$ROOT/application/scripts/offline/install-os-packages.sh" "$ROOT/os-packages" --mode bundle --scope all
  "$ROOT/runtime/python/python" "$ROOT/application/scripts/recognition/ocr.py" doctor --languages rus+eng --self-test > /tmp/ocr-doctor.json
  grep -q '"status":"ready"' /tmp/ocr-doctor.json
  command -v pdftotext >/dev/null
  command -v pdftoppm >/dev/null
  command -v tesseract >/dev/null
  (command -v soffice >/dev/null || command -v libreoffice >/dev/null)
  tesseract --list-langs 2>/dev/null | grep -Fxq rus
  tesseract --list-langs 2>/dev/null | grep -Fxq eng
  dpkg --audit | grep -q . && exit 1 || true
  apt-get check >/dev/null
  cat /tmp/ocr-doctor.json
'

echo "Astra document runtime selftest: OK ($ARCHIVE_NAME; target=$BASE_IMAGE)"
