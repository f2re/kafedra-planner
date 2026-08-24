#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Установку необходимо запускать от root" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -d "$SCRIPT_DIR/application" && -d "$SCRIPT_DIR/runtime" ]]; then
  BUNDLE_ROOT="$SCRIPT_DIR"
  APP_SOURCE="$BUNDLE_ROOT/application"
  RUNTIME_SOURCE="$BUNDLE_ROOT/runtime/node"
else
  APP_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd -P)"
  BUNDLE_ROOT="$APP_SOURCE"
  RUNTIME_SOURCE="$APP_SOURCE/runtime/node"
fi
# Внутренний installer остаётся единственным владельцем package/migration/app logic:
# install-os-packages.sh, ensure-initial-admin.mjs, KAFEDRA_OCR_BACKEND=python и
# KAFEDRA_HOST=0.0.0.0. Этот файл добавляет транзакционную границу вокруг него.
CORE_INSTALLER="$SCRIPT_DIR/install-core.sh"
[[ -x "$CORE_INSTALLER" ]] || { echo "В комплекте отсутствует внутренний install-core.sh" >&2; exit 3; }
[[ -x "$RUNTIME_SOURCE/bin/node" ]] || { echo "В комплекте отсутствует runtime/node/bin/node" >&2; exit 3; }
[[ -f "$APP_SOURCE/VERSION" ]] || { echo "В комплекте отсутствует VERSION" >&2; exit 3; }

VERSION="$(tr -d '[:space:]' < "$APP_SOURCE/VERSION")"
APP_ROOT="/opt/kafedra-planner"
DATA_DIR="/var/lib/kafedra-planner"
BACKUP_DIR="/var/backups/kafedra-planner"
CONFIG_DIR="/etc/kafedra-planner"
CONFIG_FILE="$CONFIG_DIR/kafedra-planner.env"
API_SERVICE="kafedra-planner-api.service"
WORKER_SERVICE="kafedra-planner-worker.service"
LLM_SERVICE="kafedra-planner-llama.service"
TX_ROOT="/var/lib/kafedra-planner-installer"
TX_DIR="$TX_ROOT/active"
LOCK_FILE="/run/lock/kafedra-planner-install.lock"
GLOBAL_LOG="/var/log/kafedra-planner-install.log"

for command in flock df du sha256sum systemctl install cp mv ln rm mkdir readlink awk sed grep date seq sleep cat tail chmod chown id tr find sort uniq cmp mktemp head; do
  command -v "$command" >/dev/null 2>&1 || { echo "Для безопасного обновления отсутствует команда: $command" >&2; exit 3; }
done

install -d -o root -g root -m 0700 "$TX_ROOT"
install -d -o root -g root -m 0755 "$(dirname "$LOCK_FILE")"
if [[ ! -e "$GLOBAL_LOG" ]]; then
  install -m 0600 -o root -g root /dev/null "$GLOBAL_LOG"
else
  chmod 0600 "$GLOBAL_LOG"
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Установка или обновление Kafedra Planner уже выполняется. Дождитесь завершения текущей операции и повторите запуск." >&2
  exit 9
fi

log_event() {
  local message="$*" stamp
  stamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '%s\n' "$message" >&2
  printf '[%s] %s\n' "$stamp" "$message" >> "$GLOBAL_LOG"
}

write_state() {
  local name="$1" value="$2"
  local tmp="$TX_DIR/.${name}.tmp.$$"
  printf '%s\n' "$value" > "$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$TX_DIR/$name"
}

read_state() {
  local name="$1"
  [[ -f "$TX_DIR/$name" ]] && cat "$TX_DIR/$name" || true
}

service_key() {
  case "$1" in
    "$API_SERVICE") printf 'api' ;;
    "$WORKER_SERVICE") printf 'worker' ;;
    "$LLM_SERVICE") printf 'llm' ;;
    *) return 2 ;;
  esac
}

snapshot_service() {
  local service="$1" key unit state
  key="$(service_key "$service")"
  unit="/etc/systemd/system/$service"
  if [[ -f "$unit" ]]; then cp -a "$unit" "$TX_DIR/$key.unit"; fi
  if systemctl is-active --quiet "$service"; then : > "$TX_DIR/$key.was-active"; fi
  state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
  printf '%s\n' "$state" > "$TX_DIR/$key.enabled-state"
}

begin_transaction() {
  rm -rf "$TX_DIR"
  install -d -o root -g root -m 0700 "$TX_DIR"
  write_state format 1
  write_state target-version "$VERSION"
  write_state started-at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if [[ -L "$APP_ROOT/current" ]]; then
    write_state previous-current-kind symlink
    write_state previous-current-target "$(readlink -f "$APP_ROOT/current")"
  elif [[ -d "$APP_ROOT/current" ]]; then
    write_state previous-current-kind directory
    write_state previous-current-target "$APP_ROOT/current"
  else
    write_state previous-current-kind none
    write_state previous-current-target ''
  fi

  if [[ -f "$CONFIG_FILE" ]]; then
    cp -a "$CONFIG_FILE" "$TX_DIR/config.before"
    : > "$TX_DIR/config.existed"
  fi
  if [[ -f "$DATA_DIR/kafedra-planner.sqlite3" ]]; then : > "$TX_DIR/database.existed"; fi

  snapshot_service "$API_SERVICE"
  snapshot_service "$WORKER_SERVICE"
  snapshot_service "$LLM_SERVICE"
  : > "$TX_DIR/active"
  write_state phase snapshot
}

all_services_stopped() {
  ! systemctl is-active --quiet "$API_SERVICE" \
    && ! systemctl is-active --quiet "$WORKER_SERVICE" \
    && ! systemctl is-active --quiet "$LLM_SERVICE"
}

stop_services_verified() {
  systemctl stop "$API_SERVICE" "$WORKER_SERVICE" "$LLM_SERVICE" >/dev/null 2>&1 || true
  for _attempt in $(seq 1 30); do
    all_services_stopped && return 0
    sleep 1
  done
  log_event "Не удалось гарантированно остановить службы Kafedra Planner. Данные и active release не будут изменяться дальше."
  return 1
}

restore_config_snapshot() {
  if [[ -f "$TX_DIR/config.existed" ]]; then
    install -d -o root -g kafedra-planner -m 0750 "$CONFIG_DIR" 2>/dev/null || install -d -o root -g root -m 0750 "$CONFIG_DIR"
    cp -a "$TX_DIR/config.before" "$CONFIG_FILE"
    chown root:kafedra-planner "$CONFIG_FILE" 2>/dev/null || chown root:root "$CONFIG_FILE"
    chmod 0640 "$CONFIG_FILE"
  else
    rm -f "$CONFIG_FILE"
  fi
}

backup_path_from_log() {
  local path=''
  if [[ -f "$TX_DIR/backup-path" ]]; then
    path="$(read_state backup-path)"
  elif [[ -f "$TX_DIR/core.log" ]]; then
    path="$(sed -n 's/^Создана и проверена резервная копия: //p' "$TX_DIR/core.log" | tail -n 1)"
  fi
  printf '%s' "$path"
}

select_restore_pair() {
  local previous legacy candidate
  previous="$(read_state previous-current-target)"
  legacy="$(read_state legacy-path)"
  for candidate in "$legacy" "$previous"; do
    [[ -n "$candidate" ]] || continue
    if [[ -x "$candidate/runtime/node/bin/node" && -f "$candidate/scripts/backup-restore.mjs" ]]; then
      printf '%s\n%s\n' "$candidate/runtime/node/bin/node" "$candidate"
      return 0
    fi
  done
  if [[ -x "$RUNTIME_SOURCE/bin/node" && -f "$APP_SOURCE/scripts/backup-restore.mjs" ]]; then
    printf '%s\n%s\n' "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE"
    return 0
  fi
  return 1
}

restore_backup_if_available() {
  local archive restore_app node model_stash=''
  archive="$(backup_path_from_log)"
  [[ -n "$archive" ]] || return 0
  [[ "$archive" == "$BACKUP_DIR"/* && -f "$archive" ]] || {
    log_event "Точка отката указана, но архив недоступен или находится вне штатного backup-каталога: $archive"
    return 1
  }
  local restore_pair=()
  readarray -t restore_pair < <(select_restore_pair)
  node="${restore_pair[0]:-}"
  restore_app="${restore_pair[1]:-}"
  [[ -x "$node" && -n "$restore_app" ]] || {
    log_event "Не найден совместимый runtime для восстановления резервной копии."
    return 1
  }

  # Конфигурация до обновления нужна в том числе для пути ключа зашифрованного backup.
  restore_config_snapshot
  model_stash="$(read_state model-stash-path)"
  if [[ -n "$model_stash" && ! -d "$model_stash" ]]; then
    model_stash=''
    write_state model-stash-path ''
  fi
  if [[ -z "$model_stash" && -d "$DATA_DIR/models" ]]; then
    model_stash="$TX_ROOT/model-cache-recovery"
    rm -rf "$model_stash"
    write_state model-stash-path "$model_stash"
    if ! mv "$DATA_DIR/models" "$model_stash"; then
      model_stash=''
      write_state model-stash-path ''
    fi
  fi

  if ! env KAFEDRA_CONFIG_PATH="$CONFIG_FILE" KAFEDRA_APPLICATION_DIR="$restore_app" \
      "$node" "$restore_app/scripts/backup-restore.mjs" "$archive" \
      --target-data-dir "$DATA_DIR" --target-config "$CONFIG_FILE" --apply --force >> "$GLOBAL_LOG" 2>&1; then
    [[ -z "$model_stash" || ! -d "$model_stash" ]] || { rm -rf "$DATA_DIR/models"; mv "$model_stash" "$DATA_DIR/models"; write_state model-stash-path ''; }
    log_event "Восстановление transaction backup завершилось ошибкой. Автоматическое обновление остановлено; состояние транзакции сохранено в $TX_DIR."
    return 1
  fi

  if [[ -n "$model_stash" && -d "$model_stash" ]]; then
    rm -rf "$DATA_DIR/models"
    mv "$model_stash" "$DATA_DIR/models"
    write_state model-stash-path ''
  fi
  if id kafedra-planner >/dev/null 2>&1; then
    chown -R kafedra-planner:kafedra-planner "$DATA_DIR" 2>/dev/null || true
  fi
  restore_config_snapshot
  log_event "Данные восстановлены из проверенной точки отката: $archive"
}

move_current_aside() {
  local failed="$APP_ROOT/releases/.failed-current-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
  if [[ -d "$APP_ROOT/current" && ! -L "$APP_ROOT/current" ]]; then
    install -d -o root -g root -m 0755 "$APP_ROOT/releases"
    mv "$APP_ROOT/current" "$failed"
    write_state failed-current-path "$failed"
  else
    rm -f "$APP_ROOT/current"
  fi
}

restore_current_snapshot() {
  local kind previous legacy temp
  kind="$(read_state previous-current-kind)"
  previous="$(read_state previous-current-target)"
  legacy="$(read_state legacy-path)"
  case "$kind" in
    symlink)
      [[ -n "$previous" && -d "$previous" ]] || { log_event "Предыдущий release для rollback не найден: $previous"; return 1; }
      move_current_aside
      temp="$APP_ROOT/.current.rollback.$$"
      ln -s "$previous" "$temp"
      mv -Tf "$temp" "$APP_ROOT/current"
      ;;
    directory)
      if [[ -d "$legacy" ]]; then
        move_current_aside
        mv "$legacy" "$APP_ROOT/current"
      elif [[ -d "$APP_ROOT/current" && ! -L "$APP_ROOT/current" ]]; then
        :
      else
        log_event "Не найден сохранённый legacy current для rollback: $legacy"
        return 1
      fi
      ;;
    none)
      move_current_aside
      ;;
    *)
      log_event "Некорректный transaction state previous-current-kind=$kind"
      return 1
      ;;
  esac
}

restore_unit_file() {
  local service="$1" key unit
  key="$(service_key "$service")"
  unit="/etc/systemd/system/$service"
  if [[ -f "$TX_DIR/$key.unit" ]]; then cp -a "$TX_DIR/$key.unit" "$unit"; else rm -f "$unit"; fi
}

restore_service_enablement() {
  local service="$1" key state
  key="$(service_key "$service")"
  state="$(cat "$TX_DIR/$key.enabled-state" 2>/dev/null || true)"
  case "$state" in
    enabled|enabled-runtime|linked|linked-runtime|alias)
      systemctl enable "$service" >/dev/null 2>&1 || true
      ;;
    *)
      systemctl disable "$service" >/dev/null 2>&1 || true
      ;;
  esac
}

configured_port() {
  local value
  value="$(sed -n 's/^KAFEDRA_PORT=//p' "$CONFIG_FILE" 2>/dev/null | tail -n 1)"
  [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= 65535)) || value=8080
  printf '%s' "$value"
}

health_request() {
  local port
  port="$(configured_port)"
  KAFEDRA_PORT="$port" "$RUNTIME_SOURCE/bin/node" -e '
const http=require("node:http");
const port=Number(process.env.KAFEDRA_PORT||8080);
const request=http.get({host:"127.0.0.1",port,path:"/api/system/health",timeout:3000},response=>{response.resume();process.exitCode=response.statusCode>=200&&response.statusCode<300?0:1;});
request.on("timeout",()=>request.destroy(new Error("timeout")));
request.on("error",()=>{process.exitCode=1;});
' >/dev/null 2>&1
}

restore_services_snapshot() {
  restore_unit_file "$API_SERVICE"
  restore_unit_file "$WORKER_SERVICE"
  restore_unit_file "$LLM_SERVICE"
  systemctl daemon-reload >/dev/null 2>&1 || return 1
  restore_service_enablement "$API_SERVICE"
  restore_service_enablement "$WORKER_SERVICE"
  restore_service_enablement "$LLM_SERVICE"

  [[ ! -f "$TX_DIR/api.was-active" ]] || systemctl start "$API_SERVICE"
  [[ ! -f "$TX_DIR/worker.was-active" ]] || systemctl start "$WORKER_SERVICE"
  # LLM — необязательная capability. Возвращаем прежний requested state, но его
  # внешняя/модельная ошибка не должна скрыть успешный откат рабочего ядра.
  [[ ! -f "$TX_DIR/llm.was-active" ]] || systemctl start "$LLM_SERVICE" >/dev/null 2>&1 || true

  for _attempt in $(seq 1 30); do
    local ok=true
    [[ ! -f "$TX_DIR/api.was-active" ]] || systemctl is-active --quiet "$API_SERVICE" || ok=false
    [[ ! -f "$TX_DIR/worker.was-active" ]] || systemctl is-active --quiet "$WORKER_SERVICE" || ok=false
    [[ ! -f "$TX_DIR/api.was-active" ]] || health_request || ok=false
    [[ "$ok" == true ]] && return 0
    sleep 1
  done
  return 1
}

recover_transaction() {
  local reason="$1" status=0
  trap - ERR INT TERM
  [[ -d "$TX_DIR" && -f "$TX_DIR/active" ]] || return 0
  log_event "Обнаружена незавершённая транзакция обновления: $reason. Восстанавливаю прежнее рабочее состояние."
  if ! stop_services_verified; then
    write_state phase rollback-failed || true
    log_event "АВАРИЙНО: rollback не продолжен, потому что службы не удалось гарантированно остановить. Данные/current/config не изменялись дальше; journal сохранён в $TX_DIR."
    return 90
  fi
  restore_backup_if_available || status=1
  if [[ ! -f "$TX_DIR/database.existed" && -z "$(backup_path_from_log)" ]]; then
    rm -f "$DATA_DIR/kafedra-planner.sqlite3" "$DATA_DIR/kafedra-planner.sqlite3-wal" "$DATA_DIR/kafedra-planner.sqlite3-shm"
  fi
  restore_config_snapshot || status=1
  restore_current_snapshot || status=1
  restore_unit_file "$API_SERVICE" || status=1
  restore_unit_file "$WORKER_SERVICE" || status=1
  restore_unit_file "$LLM_SERVICE" || status=1
  systemctl daemon-reload >/dev/null 2>&1 || status=1
  if (( status == 0 )); then restore_services_snapshot || status=1; fi

  if (( status != 0 )); then
    write_state phase rollback-failed || true
    log_event "АВАРИЙНО: автоматический откат не прошёл проверку. Новое обновление не запускается. Состояние сохранено в $TX_DIR, журнал: $GLOBAL_LOG"
    return 90
  fi
  write_state phase rolled-back
  rm -rf "$TX_DIR"
  log_event "Автоматический откат проверен: прежний current/config/data/systemd восстановлены, ранее активные API/worker снова запущены."
}

preflight_bundle() {
  local verify_work manifest_paths actual_paths duplicate unsupported
  if [[ -d "$SCRIPT_DIR/application" && -d "$SCRIPT_DIR/runtime" ]]; then
    [[ -f "$BUNDLE_ROOT/manifest.sha256" && -f "$BUNDLE_ROOT/release.json" ]] || { log_event "Комплект неполон: нет manifest.sha256/release.json"; return 3; }
    verify_work="$(mktemp -d /tmp/kafedra-transaction-preflight.XXXXXX)"
    manifest_paths="$verify_work/manifest-paths.txt"
    actual_paths="$verify_work/actual-paths.txt"
    unsupported="$(find "$BUNDLE_ROOT" ! -type f ! -type d -print -quit)"
    if [[ -n "$unsupported" ]]; then
      rm -rf "$verify_work"
      log_event "Комплект содержит symlink или специальный файл: $unsupported. Службы не остановлены."
      return 3
    fi
    if ! while IFS= read -r line; do
      [[ "$line" =~ ^[0-9a-fA-F]{64}[[:space:]][\ \*](\./)?(.+)$ ]] || exit 21
      path="${BASH_REMATCH[2]}"
      [[ "$path" != /* && "$path" != .. && "$path" != ../* && "$path" != */../* && "$path" != */.. && ! "$path" =~ [[:cntrl:]\\] ]] || exit 22
      printf '%s\n' "$path"
    done < "$BUNDLE_ROOT/manifest.sha256" | LC_ALL=C sort > "$manifest_paths"; then
      rm -rf "$verify_work"
      log_event "manifest.sha256 содержит некорректный или небезопасный путь. Службы не остановлены."
      return 3
    fi
    duplicate="$(uniq -d "$manifest_paths" | head -n 1 || true)"
    if [[ -n "$duplicate" ]]; then
      rm -rf "$verify_work"
      log_event "manifest.sha256 содержит повтор пути: $duplicate. Службы не остановлены."
      return 3
    fi
    (cd "$BUNDLE_ROOT"; LC_ALL=C find . -type f ! -path './manifest.sha256' -printf '%P\n' | LC_ALL=C sort) > "$actual_paths"
    if ! cmp -s "$manifest_paths" "$actual_paths"; then
      rm -rf "$verify_work"
      log_event "manifest.sha256 не перечисляет в точности все файлы комплекта. Службы не остановлены."
      return 3
    fi
    if ! (cd "$BUNDLE_ROOT" && sha256sum -c --strict manifest.sha256 >/dev/null); then
      rm -rf "$verify_work"
      log_event "Внутренний manifest автономного комплекта не прошёл SHA-256 проверку. Службы не остановлены."
      return 3
    fi
    rm -rf "$verify_work"
    "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/runtime-contract.mjs" verify-bundle --root "$BUNDLE_ROOT" >/dev/null
    if [[ -f "$BUNDLE_ROOT/deployment.json" ]]; then
      "$RUNTIME_SOURCE/bin/node" "$APP_SOURCE/scripts/offline/deployment-contract.mjs" verify --root "$BUNDLE_ROOT" >/dev/null
    fi
  fi
}

free_kb() {
  df -Pk "$1" | awk 'NR==2 {print $4}'
}

preflight_space() {
  local app_kb data_kb need_opt need_backup free_opt free_backup backup_probe
  app_kb="$(du -sk "$APP_SOURCE" "$RUNTIME_SOURCE" 2>/dev/null | awk '{sum += $1} END {print sum + 0}')"
  data_kb=0
  [[ ! -d "$DATA_DIR" ]] || data_kb="$(du -sk --exclude=models "$DATA_DIR" 2>/dev/null | awk '{print $1 + 0}')"
  need_opt=$(( app_kb * 2 + 131072 ))
  need_backup=$(( data_kb + app_kb + 131072 ))
  free_opt="$(free_kb /opt)"
  backup_probe="$BACKUP_DIR"
  [[ -d "$backup_probe" ]] || backup_probe=/var
  free_backup="$(free_kb "$backup_probe")"
  if (( free_opt < need_opt )); then
    log_event "Недостаточно места в /opt для безопасного staging: свободно ${free_opt} KiB, требуется не менее ${need_opt} KiB."
    return 4
  fi
  if [[ -f "$DATA_DIR/kafedra-planner.sqlite3" ]] && (( free_backup < need_backup )); then
    log_event "Недостаточно места для гарантированной точки отката: свободно ${free_backup} KiB, требуется не менее ${need_backup} KiB."
    return 4
  fi
}

migrate_legacy_current() {
  local kind legacy temp
  kind="$(read_state previous-current-kind)"
  [[ "$kind" == directory ]] || return 0
  install -d -o root -g root -m 0755 "$APP_ROOT/releases"
  legacy="$APP_ROOT/releases/legacy-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
  [[ ! -e "$legacy" ]] || { log_event "Не удалось выбрать уникальный каталог для legacy release: $legacy"; return 5; }
  write_state legacy-path "$legacy"
  temp="$APP_ROOT/.current.legacy.$$"
  ln -s "$legacy" "$temp"
  if ! mv "$APP_ROOT/current" "$legacy"; then rm -f "$temp"; return 5; fi
  mv -Tf "$temp" "$APP_ROOT/current"
  log_event "Старая установка с обычным каталогом current безопасно принята как immutable legacy release: $legacy"
}

record_core_line() {
  local line="$1" path
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$TX_DIR/core.log"
  printf '[core] %s\n' "$line" >> "$GLOBAL_LOG"
  case "$line" in
    "Создана и проверена резервная копия: "*)
      path="${line#Создана и проверена резервная копия: }"
      if [[ "$path" == "$BACKUP_DIR"/* ]]; then write_state backup-path "$path"; write_state phase backup-ready; fi
      ;;
  esac
}

run_core_installer() {
  local status
  : > "$TX_DIR/core.log"
  set +e
  "$CORE_INSTALLER" 2>&1 | while IFS= read -r line || [[ -n "$line" ]]; do record_core_line "$line"; done
  status=${PIPESTATUS[0]}
  set -e
  return "$status"
}

verify_success() {
  local target deployed_version
  [[ -L "$APP_ROOT/current" ]] || { log_event "После обновления current не является атомарным symlink."; return 1; }
  target="$(readlink -f "$APP_ROOT/current")"
  [[ -d "$target" && -f "$target/VERSION" ]] || { log_event "Активный release после обновления недоступен: $target"; return 1; }
  deployed_version="$(tr -d '[:space:]' < "$target/VERSION")"
  [[ "$deployed_version" == "$VERSION" ]] || { log_event "После обновления активна версия $deployed_version вместо $VERSION."; return 1; }
  systemctl is-active --quiet "$API_SERVICE" || { log_event "API не active после обновления."; return 1; }
  systemctl is-active --quiet "$WORKER_SERVICE" || { log_event "Worker не active после обновления."; return 1; }
  for _attempt in $(seq 1 30); do
    health_request && return 0
    sleep 1
  done
  log_event "API active, но /api/system/health не подтвердил работоспособность после обновления."
  return 1
}

abort_transaction() {
  local original_status="$1" reason="$2" rollback_status=0
  trap - ERR INT TERM
  if [[ -d "$TX_DIR" && -f "$TX_DIR/active" ]]; then
    set +e
    recover_transaction "$reason"
    rollback_status=$?
    set -e
    if (( rollback_status != 0 )); then exit "$rollback_status"; fi
  fi
  exit "$original_status"
}

on_unexpected_error() {
  local status=$?
  abort_transaction "$status" "неожиданная ошибка внешнего transaction installer"
}

if [[ -d "$TX_DIR" && -f "$TX_DIR/active" ]]; then
  STALE_PHASE="$(read_state phase)"
  if [[ "$STALE_PHASE" == committed || "$STALE_PHASE" == rolled-back ]]; then
    rm -rf "$TX_DIR"
    log_event "Удалён уже завершённый transaction journal ($STALE_PHASE); восстановление не требуется."
  else
    recover_transaction "предыдущий процесс завершился до commit (phase=${STALE_PHASE:-unknown})" || exit $?
  fi
fi

preflight_bundle
preflight_space
begin_transaction
trap on_unexpected_error ERR
trap 'abort_transaction 130 "получен SIGINT во время обновления"' INT
trap 'abort_transaction 143 "получен SIGTERM во время обновления"' TERM
if ! stop_services_verified; then
  recover_transaction "службы не удалось остановить" || exit $?
  exit 10
fi
write_state phase services-stopped
if ! migrate_legacy_current; then
  recover_transaction "не удалось принять legacy layout" || exit $?
  exit 11
fi
write_state phase core-running

CORE_STATUS=0
run_core_installer || CORE_STATUS=$?
if (( CORE_STATUS != 0 )); then
  recover_transaction "внутренний installer завершился с кодом $CORE_STATUS" || exit $?
  exit "$CORE_STATUS"
fi
write_state phase core-succeeded
if ! verify_success; then
  recover_transaction "post-update verification не пройдена" || exit $?
  exit 12
fi
write_state phase committed
trap - ERR INT TERM
rm -rf "$TX_DIR"
log_event "Транзакционное обновление Kafedra Planner завершено и проверено: версия $VERSION."
