#!/usr/bin/env bash
set -Eeuo pipefail

OUT_DIR="${1:-}"
[[ -n "$OUT_DIR" && -d "$OUT_DIR" ]] || { echo "Использование: systemd-deploy-selftest.sh OUT_DIR" >&2; exit 2; }
for command in docker find sha256sum stat awk; do
  command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда: $command" >&2; exit 2; }
done

mapfile -t archives < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print | LC_ALL=C sort)
((${#archives[@]} == 1)) || { echo "Ожидался ровно один full bundle archive в $OUT_DIR, найдено: ${#archives[@]}" >&2; exit 3; }
ARCHIVE="${archives[0]}"
ARCHIVE_NAME="$(basename "$ARCHIVE")"
CHECKSUM="$ARCHIVE.sha256"
WRAPPER="$OUT_DIR/install-kafedra-planner.sh"
README="$OUT_DIR/README-INSTALL.txt"
[[ -f "$CHECKSUM" && -x "$WRAPPER" && -f "$README" ]] || {
  echo "Release-комплект неполон: нужны archive, .sha256, executable wrapper и README-INSTALL.txt" >&2
  exit 3
}
(cd "$OUT_DIR" && sha256sum -c --strict "$(basename "$CHECKSUM")" >/dev/null)
EXPECT_LLM=false
if tar -tzf "$ARCHIVE" | grep -q '/llm/manifest.json$'; then EXPECT_LLM=true; fi

RUN_TOKEN="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
IMAGE="kafedra-systemd-selftest:$RUN_TOKEN"
CONTAINER="kafedra-systemd-selftest-$RUN_TOKEN"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Docker — только disposable Debian 12 reference VM в CI. Production bundle и
# target deployment Docker не требуют.
docker build --quiet -t "$IMAGE" - <<'DOCKERFILE' >/dev/null
FROM debian:12
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus tar coreutils util-linux passwd findutils grep sed gzip mawk \
 && rm -rf /var/lib/apt/lists/* \
 && systemd-machine-id-setup
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
DOCKERFILE

docker run -d --name "$CONTAINER" \
  --privileged --cgroupns=host --network none \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "$IMAGE" >/dev/null

SYSTEMD_READY=false
for _attempt in $(seq 1 30); do
  state="$(docker exec "$CONTAINER" systemctl is-system-running 2>/dev/null || true)"
  if [[ "$state" == running || "$state" == degraded ]]; then SYSTEMD_READY=true; break; fi
  sleep 1
done
[[ "$SYSTEMD_READY" == true ]] || {
  docker logs "$CONTAINER" >&2 || true
  echo "systemd reference target не запустился" >&2
  exit 4
}

docker exec "$CONTAINER" mkdir -p /installer
docker cp "$ARCHIVE" "$CONTAINER:/installer/$ARCHIVE_NAME"
docker cp "$CHECKSUM" "$CONTAINER:/installer/$ARCHIVE_NAME.sha256"
docker cp "$WRAPPER" "$CONTAINER:/installer/install-kafedra-planner.sh"
docker cp "$README" "$CONTAINER:/installer/README-INSTALL.txt"
docker exec "$CONTAINER" chmod 0755 /installer/install-kafedra-planner.sh

run_installer() {
  docker exec -e KAFEDRA_APT_MODE=bundle "$CONTAINER" \
    bash -lc 'cd /installer && ./install-kafedra-planner.sh'
}

assert_deployed() {
  docker exec "$CONTAINER" systemctl is-enabled --quiet kafedra-planner-api.service
  docker exec "$CONTAINER" systemctl is-enabled --quiet kafedra-planner-worker.service
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
  docker exec "$CONTAINER" test -L /opt/kafedra-planner/current
  docker exec "$CONTAINER" test -x /opt/kafedra-planner/current/runtime/node/bin/node
  docker exec "$CONTAINER" test -x /opt/kafedra-planner/current/runtime/python/python
  docker exec "$CONTAINER" test "$(docker exec "$CONTAINER" stat -c %a /etc/kafedra-planner/kafedra-planner.env)" = 640
  docker exec "$CONTAINER" /opt/kafedra-planner/current/scripts/offline/doctor.sh
  if [[ "$EXPECT_LLM" == true ]]; then
    docker exec "$CONTAINER" systemctl is-enabled --quiet kafedra-planner-llama.service
    docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-llama.service
  fi
}

pin_hash() {
  docker exec "$CONTAINER" /opt/kafedra-planner/current/runtime/node/bin/node -e '
const {DatabaseSync}=require("node:sqlite");
const database=new DatabaseSync("/var/lib/kafedra-planner/kafedra-planner.sqlite3", {readOnly:true});
try { const row=database.prepare("SELECT password_hash FROM auth_accounts WHERE username = ?").get("admin"); process.stdout.write(String(row?.password_hash||"")); }
finally { database.close(); }
'
}

make_current_legacy_directory() {
  local marker="$1" current
  current="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
  [[ -n "$current" ]] || { echo "Не удалось определить release перед legacy test" >&2; exit 6; }
  docker exec "$CONTAINER" systemctl stop kafedra-planner-api.service kafedra-planner-worker.service kafedra-planner-llama.service >/dev/null 2>&1 || true
  docker exec "$CONTAINER" bash -lc "rm -f /opt/kafedra-planner/current && mv '$current' /opt/kafedra-planner/current && printf '%s\\n' '$marker' > /opt/kafedra-planner/current/VERSION"
  docker exec "$CONTAINER" test -d /opt/kafedra-planner/current
  docker exec "$CONTAINER" bash -lc 'test ! -L /opt/kafedra-planner/current'
  docker exec "$CONTAINER" systemctl start kafedra-planner-api.service kafedra-planner-worker.service
  [[ "$EXPECT_LLM" != true ]] || docker exec "$CONTAINER" systemctl start kafedra-planner-llama.service
}

# 1. Clean offline install of the exact archive.
run_installer
assert_deployed
FIRST_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
[[ -n "$FIRST_RELEASE" ]] || { echo "current release не определён" >&2; exit 5; }

# 2. The same archive is an idempotent update and creates a verified backup.
run_installer
assert_deployed
SECOND_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
[[ "$FIRST_RELEASE" == "$SECOND_RELEASE" ]] || { echo "Повторный install создал другой release для того же bundle" >&2; exit 6; }
docker exec "$CONTAINER" bash -lc 'find /var/backups/kafedra-planner -type f -print -quit | grep -q .'

# 3. Preserve real operator data while upgrading legacy current-directory layout.
docker exec "$CONTAINER" bash -lc 'printf "4826\n" > /root/kafedra-test-pin; chmod 0600 /root/kafedra-test-pin; KAFEDRA_PIN_FILE=/root/kafedra-test-pin /opt/kafedra-planner/current/runtime/node/bin/node /opt/kafedra-planner/current/scripts/reset-pin.mjs >/dev/null; rm -f /root/kafedra-test-pin'
PIN_HASH_BEFORE="$(pin_hash)"
[[ -n "$PIN_HASH_BEFORE" ]] || { echo "Не удалось зафиксировать PIN hash перед update" >&2; exit 6; }
make_current_legacy_directory '0.1.0-legacy-ci'
run_installer
assert_deployed
[[ "$(pin_hash)" == "$PIN_HASH_BEFORE" ]] || { echo "Legacy update изменил PIN" >&2; exit 6; }

# 4. forced-core-rollback: after the new immutable release becomes current,
# corrupt one required static file. The outer transaction must reject its own
# post-update verification and restore the previous legacy current + data/PIN.
make_current_legacy_directory '0.1.0-forced-core-rollback'
docker exec -d "$CONTAINER" bash -lc '
  while [[ ! -L /opt/kafedra-planner/current ]]; do :; done
  target="$(readlink -f /opt/kafedra-planner/current)"
  printf "forced rollback fixture\n" > "$target/public/index.html"
  touch /tmp/kafedra-forced-core-rollback
'
if run_installer; then
  echo "Installer принял повреждённый post-update release вместо rollback" >&2
  exit 8
fi
docker exec "$CONTAINER" test -e /tmp/kafedra-forced-core-rollback
docker exec "$CONTAINER" test -d /opt/kafedra-planner/current
docker exec "$CONTAINER" bash -lc 'test ! -L /opt/kafedra-planner/current'
[[ "$(docker exec "$CONTAINER" cat /opt/kafedra-planner/current/VERSION)" == '0.1.0-forced-core-rollback' ]] || {
  echo "Rollback не вернул предыдущий current" >&2
  exit 8
}
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
[[ "$(pin_hash)" == "$PIN_HASH_BEFORE" ]] || { echo "Forced rollback изменил PIN" >&2; exit 8; }

# No subsequent install is needed here: clean install, repeated update and
# successful legacy upgrade were already proved before the forced failure.
echo "Full systemd deployment selftest: OK ($ARCHIVE_NAME; llm=$EXPECT_LLM; forced-rollback=ok)"
