#!/usr/bin/env bash
set -Eeuo pipefail

OUT_DIR="${1:-}"
[[ -n "$OUT_DIR" && -d "$OUT_DIR" ]] || { echo "Использование: systemd-deploy-selftest.sh OUT_DIR" >&2; exit 2; }
for command in docker find sha256sum stat awk; do command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда: $command" >&2; exit 2; }; done

mapfile -t archives < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print | LC_ALL=C sort)
((${#archives[@]} == 1)) || { echo "Ожидался ровно один full bundle archive в $OUT_DIR, найдено: ${#archives[@]}" >&2; exit 3; }
ARCHIVE="${archives[0]}"
ARCHIVE_NAME="$(basename "$ARCHIVE")"
CHECKSUM="$ARCHIVE.sha256"
WRAPPER="$OUT_DIR/install-kafedra-planner.sh"
README="$OUT_DIR/README-INSTALL.txt"
[[ -f "$CHECKSUM" && -x "$WRAPPER" && -f "$README" ]] || { echo "Release-комплект неполон: нужны archive, .sha256, executable wrapper и README-INSTALL.txt" >&2; exit 3; }
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

# Docker применяется только как disposable reference-VM в CI. Production bundle
# и target deployment Docker не требуют.
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

# После подготовки базовой ОС сеть target отключена. Все application packages
# должны прийти только из bundle.
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
[[ "$SYSTEMD_READY" == true ]] || { docker logs "$CONTAINER" >&2 || true; echo "systemd reference target не запустился" >&2; exit 4; }

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
}
assert_llm_deployed() {
  [[ "$EXPECT_LLM" == true ]] || return 0
  docker exec "$CONTAINER" systemctl is-enabled --quiet kafedra-planner-llama.service
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-llama.service
  docker exec "$CONTAINER" grep -q '^KAFEDRA_LLM_ENABLED=true$' /etc/kafedra-planner/kafedra-planner.env
  docker exec "$CONTAINER" grep -q '^KAFEDRA_LLM_MANAGED=true$' /etc/kafedra-planner/kafedra-planner.env
  docker exec "$CONTAINER" test -x /opt/kafedra-planner/current/runtime/llama/bin/llama-server
  docker exec "$CONTAINER" bash -lc 'MODEL=$(sed -n "s/^KAFEDRA_LLM_MODEL_PATH=//p" /etc/kafedra-planner/kafedra-planner.env); test -n "$MODEL" && test -f "$MODEL"'
  docker exec "$CONTAINER" /opt/kafedra-planner/current/runtime/node/bin/node /opt/kafedra-planner/current/scripts/llm-doctor.mjs --json >/dev/null
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
  [[ -n "$current" ]] || { echo "Не удалось определить release перед legacy-layout test" >&2; exit 6; }
  docker exec "$CONTAINER" systemctl stop kafedra-planner-api.service kafedra-planner-worker.service kafedra-planner-llama.service >/dev/null 2>&1 || true
  docker exec "$CONTAINER" bash -lc "rm -f /opt/kafedra-planner/current && mv '$current' /opt/kafedra-planner/current && printf '%s\\n' '$marker' > /opt/kafedra-planner/current/VERSION"
  docker exec "$CONTAINER" test -d /opt/kafedra-planner/current
  docker exec "$CONTAINER" bash -lc 'test ! -L /opt/kafedra-planner/current'
  docker exec "$CONTAINER" systemctl start kafedra-planner-api.service kafedra-planner-worker.service
  [[ "$EXPECT_LLM" != true ]] || docker exec "$CONTAINER" systemctl start kafedra-planner-llama.service
}

run_installer
assert_deployed
assert_llm_deployed

docker exec "$CONTAINER" test ! -e /root/kafedra-planner-first-login.txt
FIRST_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
[[ -n "$FIRST_RELEASE" ]] || { echo "current release не определён" >&2; exit 5; }
FIRST_MODEL_INODE=""
if [[ "$EXPECT_LLM" == true ]]; then FIRST_MODEL_INODE="$(docker exec "$CONTAINER" bash -lc 'MODEL=$(sed -n "s/^KAFEDRA_LLM_MODEL_PATH=//p" /etc/kafedra-planner/kafedra-planner.env); stat -c %i "$MODEL"')"; fi

# Config — данные, а не shell. Даже при update значение с $() должно остаться
# буквальным и не выполнить команду от root.
docker exec "$CONTAINER" sed -i 's|^KAFEDRA_SMTP_PASSWORD=.*$|KAFEDRA_SMTP_PASSWORD=$(touch /tmp/kafedra-config-executed)|' /etc/kafedra-planner/kafedra-planner.env

# Тот же комплект должен безопасно проходить как повторный update: без нового
# администратора, без второго release-каталога, с pre-update backup.
run_installer
assert_deployed
assert_llm_deployed
if [[ "$EXPECT_LLM" == true ]]; then
  SECOND_MODEL_INODE="$(docker exec "$CONTAINER" bash -lc 'MODEL=$(sed -n "s/^KAFEDRA_LLM_MODEL_PATH=//p" /etc/kafedra-planner/kafedra-planner.env); stat -c %i "$MODEL"')"
  [[ "$FIRST_MODEL_INODE" == "$SECOND_MODEL_INODE" ]] || { echo "Повторный install заменил уже проверенную GGUF" >&2; exit 6; }
fi
docker exec "$CONTAINER" test ! -e /tmp/kafedra-config-executed
docker exec "$CONTAINER" test ! -e /root/kafedra-planner-first-login.txt
SECOND_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
[[ "$FIRST_RELEASE" == "$SECOND_RELEASE" ]] || { echo "Повторный install создал другой release для того же bundle" >&2; exit 6; }
RELEASE_COUNT="$(docker exec "$CONTAINER" bash -lc "find /opt/kafedra-planner/releases -mindepth 1 -maxdepth 1 -type d ! -name '.*' | wc -l")"
[[ "$RELEASE_COUNT" == 1 ]] || { echo "После повторной установки ожидается один release, получено: $RELEASE_COUNT" >&2; exit 6; }
docker exec "$CONTAINER" bash -lc 'find /var/backups/kafedra-planner -type f -print -quit | grep -q .'

# Сохраняем реальный PIN, затем воспроизводим старую схему, где current был
# обычным каталогом. Update обязан сам принять layout, не потерять PIN/config и
# вернуть current к атомарному release symlink.
docker exec "$CONTAINER" bash -lc 'printf "4826\n" > /root/kafedra-test-pin; chmod 0600 /root/kafedra-test-pin; KAFEDRA_PIN_FILE=/root/kafedra-test-pin /opt/kafedra-planner/current/runtime/node/bin/node /opt/kafedra-planner/current/scripts/reset-pin.mjs >/dev/null; rm -f /root/kafedra-test-pin'
PIN_HASH_BEFORE="$(pin_hash)"
[[ -n "$PIN_HASH_BEFORE" ]] || { echo "Не удалось зафиксировать PIN hash перед update" >&2; exit 6; }
make_current_legacy_directory '0.1.0-legacy-ci'
run_installer
assert_deployed
assert_llm_deployed
docker exec "$CONTAINER" bash -lc 'find /opt/kafedra-planner/releases -mindepth 1 -maxdepth 1 -type d -name "legacy-*" -print -quit | grep -q .'
[[ "$(pin_hash)" == "$PIN_HASH_BEFORE" ]] || { echo "Обновление legacy-layout изменило PIN" >&2; exit 6; }
docker exec "$CONTAINER" test ! -e /tmp/kafedra-config-executed
LEGACY_UPGRADED_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
[[ "$LEGACY_UPGRADED_RELEASE" == "$SECOND_RELEASE" ]] || { echo "Legacy update не восстановил стандартный versioned release path" >&2; exit 6; }

# Параллельный второй installer должен завершиться до любых изменений.
docker exec -d "$CONTAINER" bash -lc 'echo $$ > /tmp/kafedra-lock-holder.pid; exec 9>/run/lock/kafedra-planner-install.lock; flock 9; touch /tmp/kafedra-lock-held; exec sleep 60'
LOCK_READY=false
for _attempt in $(seq 1 30); do
  if docker exec "$CONTAINER" test -e /tmp/kafedra-lock-held; then LOCK_READY=true; break; fi
  sleep 1
done
[[ "$LOCK_READY" == true ]] || { echo "Не удалось удержать installer lock для E2E" >&2; exit 6; }
LOCK_RELEASE="$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)"
if run_installer; then echo "Параллельный installer обошёл exclusive lock" >&2; exit 6; fi
[[ "$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)" == "$LOCK_RELEASE" ]] || { echo "Lock rejection изменил current" >&2; exit 6; }
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
docker exec "$CONTAINER" bash -lc 'kill "$(cat /tmp/kafedra-lock-holder.pid)" 2>/dev/null || true; rm -f /tmp/kafedra-lock-holder.pid /tmp/kafedra-lock-held'
sleep 1

# Для LLM-варианта принудительно роняем managed server после backup/migration.
# Дополнительно возвращаем legacy directory: внешний transaction wrapper обязан
# восстановить именно исходный layout, данные/PIN и рабочие API/worker, а затем
# следующий запуск должен успешно обновить ту же установку.
if [[ "$EXPECT_LLM" == true ]]; then
  make_current_legacy_directory '0.1.0-rollback-ci'
  docker exec "$CONTAINER" sed -i 's/^KAFEDRA_LLM_START_TIMEOUT_SECONDS=.*/KAFEDRA_LLM_START_TIMEOUT_SECONDS=3/' /etc/kafedra-planner/kafedra-planner.env
  ROLLBACK_MODEL_INODE="$(docker exec "$CONTAINER" bash -lc 'MODEL=$(sed -n "s/^KAFEDRA_LLM_MODEL_PATH=//p" /etc/kafedra-planner/kafedra-planner.env); stat -c %i "$MODEL"')"
  docker exec "$CONTAINER" touch /tmp/kafedra-fail-llama
  if run_installer; then
    echo "Installer не откатился после принудительного сбоя llama-server" >&2
    exit 8
  fi
  docker exec "$CONTAINER" test -d /opt/kafedra-planner/current
  docker exec "$CONTAINER" bash -lc 'test ! -L /opt/kafedra-planner/current'
  [[ "$(docker exec "$CONTAINER" cat /opt/kafedra-planner/current/VERSION)" == '0.1.0-rollback-ci' ]] || { echo "Rollback не вернул legacy current" >&2; exit 8; }
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
  [[ "$(pin_hash)" == "$PIN_HASH_BEFORE" ]] || { echo "Rollback изменил PIN" >&2; exit 8; }
  AFTER_ROLLBACK_MODEL_INODE="$(docker exec "$CONTAINER" bash -lc 'MODEL=$(sed -n "s/^KAFEDRA_LLM_MODEL_PATH=//p" /etc/kafedra-planner/kafedra-planner.env); test -f "$MODEL"; stat -c %i "$MODEL"')"
  [[ "$ROLLBACK_MODEL_INODE" == "$AFTER_ROLLBACK_MODEL_INODE" ]] || { echo "Rollback потерял или заменил GGUF model cache" >&2; exit 8; }
  docker exec "$CONTAINER" rm -f /tmp/kafedra-fail-llama
  docker exec "$CONTAINER" systemctl start kafedra-planner-llama.service
  for _attempt in $(seq 1 20); do
    if docker exec "$CONTAINER" /opt/kafedra-planner/current/runtime/node/bin/node /opt/kafedra-planner/current/scripts/llm-doctor.mjs --json >/dev/null 2>&1; then break; fi
    sleep 1
    [[ "$_attempt" -lt 20 ]] || { echo "llama-server не восстановился после rollback" >&2; exit 8; }
  done
  run_installer
  assert_deployed
  assert_llm_deployed
  [[ "$(pin_hash)" == "$PIN_HASH_BEFORE" ]] || { echo "Успешный повтор после rollback изменил PIN" >&2; exit 8; }
fi

# Package deployment имеет один стандартный контур данных. Если существующий
# config указывает другую БД, update обязан остановиться до остановки служб и
# переключения current вместо молчаливой миграции другой базы.
docker exec "$CONTAINER" sed -i 's|^KAFEDRA_DATABASE_PATH=.*$|KAFEDRA_DATABASE_PATH=/tmp/wrong-kafedra.sqlite3|' /etc/kafedra-planner/kafedra-planner.env
if run_installer; then
  echo "Installer принял конфликтующий KAFEDRA_DATABASE_PATH" >&2
  exit 7
fi
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
[[ "$(docker exec "$CONTAINER" readlink -f /opt/kafedra-planner/current)" == "$SECOND_RELEASE" ]] || { echo "Неуспешная проверка config изменила current release" >&2; exit 7; }
docker exec "$CONTAINER" test ! -e /tmp/wrong-kafedra.sqlite3
docker exec "$CONTAINER" sed -i 's|^KAFEDRA_DATABASE_PATH=.*$|KAFEDRA_DATABASE_PATH=/var/lib/kafedra-planner/kafedra-planner.sqlite3|' /etc/kafedra-planner/kafedra-planner.env
assert_deployed

if [[ "$EXPECT_LLM" == true ]]; then
  docker exec "$CONTAINER" sed -i 's/^KAFEDRA_LLM_ENABLED=true$/KAFEDRA_LLM_ENABLED=false/' /etc/kafedra-planner/kafedra-planner.env
  run_installer
  assert_deployed
  docker exec "$CONTAINER" bash -lc '! systemctl is-active --quiet kafedra-planner-llama.service'
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-api.service
  docker exec "$CONTAINER" systemctl is-active --quiet kafedra-planner-worker.service
fi

echo "Full systemd deployment selftest: OK ($ARCHIVE_NAME; llm=$EXPECT_LLM)"
