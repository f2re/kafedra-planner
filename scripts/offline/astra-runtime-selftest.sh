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
cleanup() {
  local status=$?
  if ((status != 0)); then
    docker logs "$CONTAINER" >&2 || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# Verify Astra userspace without invoking its kernel/PARSEC bootstrap.
# Networking stays disabled throughout package installation and runtime checks.
docker run -d --name "$CONTAINER" --network none --entrypoint /bin/sh "$BASE_IMAGE" \
  -c 'while :; do sleep 3600; done' >/dev/null
docker exec "$CONTAINER" mkdir -p /installer
docker cp "$ARCHIVE" "$CONTAINER:/installer/$ARCHIVE_NAME"
docker cp "$ARCHIVE.sha256" "$CONTAINER:/installer/$ARCHIVE_NAME.sha256"

docker exec -i "$CONTAINER" bash -s -- "$ARCHIVE_NAME" <<'REMOTE'
set -Eeuo pipefail
trap 'status=$?; if ((status != 0)); then cat /tmp/ocr-doctor.json /tmp/office-convert.log 2>/dev/null >&2 || true; fi; exit "$status"' EXIT
cd /installer
sha256sum -c --strict "$1.sha256"
mkdir bundle
tar -xzf "$1" -C bundle
ROOT=$(find /installer/bundle -mindepth 1 -maxdepth 1 -type d -print -quit)
test -n "$ROOT"
"$ROOT/application/scripts/offline/install-os-packages.sh" "$ROOT/os-packages" --mode bundle --scope all
"$ROOT/runtime/python/python" "$ROOT/application/scripts/recognition/ocr.py" doctor --languages rus+eng --self-test > /tmp/ocr-doctor.json
"$ROOT/runtime/python/python" - /tmp/ocr-doctor.json <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as stream:
    result = json.load(stream)
if result.get("status") != "ready":
    raise SystemExit("OCR self-test did not return ready")
PY
command -v pdftotext >/dev/null
command -v pdftoppm >/dev/null
command -v tesseract >/dev/null
tesseract --list-langs > /tmp/tesseract-languages.txt
grep -Fxq rus /tmp/tesseract-languages.txt
grep -Fxq eng /tmp/tesseract-languages.txt

# A present Office executable is insufficient: exercise conversion and readback.
OFFICE=$(command -v soffice || command -v libreoffice)
printf 'KAFEDRA OFFICE TEST\n' > /tmp/office-control.txt
timeout 60 "$OFFICE" -env:UserInstallation=file:///tmp/kafedra-office-profile \
  --headless --convert-to pdf --outdir /tmp /tmp/office-control.txt > /tmp/office-convert.log 2>&1
test -s /tmp/office-control.pdf
pdftotext /tmp/office-control.pdf /tmp/office-readback.txt
grep -Fq 'KAFEDRA OFFICE TEST' /tmp/office-readback.txt
AUDIT=$(dpkg --audit)
if [[ -n "$AUDIT" ]]; then
  printf '%s\n' "$AUDIT" >&2
  exit 1
fi
apt-get check >/dev/null
cat /tmp/ocr-doctor.json
REMOTE

echo "Astra document runtime selftest: OK ($ARCHIVE_NAME; target=$BASE_IMAGE)"
