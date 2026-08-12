#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

PACKAGE_ROOT="${1:-}"
[[ -n "$PACKAGE_ROOT" ]] || die "Использование: install-os-packages.sh DIR [--check-only] [--mode auto|system|bundle]"
shift || true

CHECK_ONLY=false
MODE="${KAFEDRA_APT_MODE:-auto}"
while (($#)); do
  case "$1" in
    --check-only) CHECK_ONLY=true; shift ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --system-only) MODE=system; shift ;;
    --offline-only|--bundle-only) MODE=bundle; shift ;;
    -h|--help)
      cat <<'HELP'
Использование: install-os-packages.sh DIR [--check-only] [--mode auto|system|bundle]

Режимы:
  auto    сначала штатный APT целевой ОС по именам пакетов, затем bundle fallback;
  system  только штатные APT sources целевой ОС;
  bundle  только локальный file: repository из full bundle (air-gap).

Версии из packages.tsv используются только для проверки целостности bundle и
никогда не передаются APT как package=version. Скрипт не вызывает --fix-broken.
HELP
      exit 0
      ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
[[ "$MODE" == auto || "$MODE" == system || "$MODE" == bundle ]] || die "Некорректный APT mode: $MODE"
[[ -d "$PACKAGE_ROOT" ]] || die "Не найден каталог пакетов ОС: $PACKAGE_ROOT"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Установка пакетов ОС требует root"
for command in apt-get awk dpkg dpkg-deb comm cut find sed sort sha256sum gzip stat tail; do require_command "$command"; done
PACKAGE_ROOT="$(absolute_path "$PACKAGE_ROOT")"
verify_os_package_set "$PACKAGE_ROOT" 1

DPKG_AUDIT="$(dpkg --audit || true)"
[[ -z "$DPKG_AUDIT" ]] || die "Пакетная база ОС уже повреждена до запуска Kafedra Planner. Установщик не запускает apt --fix-broken автоматически: восстановите APT/dpkg штатными средствами и повторите установку. Детали: $DPKG_AUDIT"

mapfile -t requested < <(sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_ROOT/requested-packages.txt" | awk 'NF {print $1}' | LC_ALL=C sort -u)
((${#requested[@]})) || die "requested-packages.txt пуст"
for package in "${requested[@]}"; do
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || die "Некорректный package name: $package"
done

WORK="$(mktemp -d /tmp/kafedra-apt.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
# apt drops privileges to _apt for downloads; allow traversal of the temporary cache.
chmod 0755 "$WORK"
mkdir -p "$WORK/system-archives/partial"
chmod 0755 "$WORK/system-archives" "$WORK/system-archives/partial"
SYSTEM_APT_OPTIONS=(
  -o "Dir::Cache::archives=$WORK/system-archives"
  -o "Acquire::Retries=1"
)

show_apt_failure() {
  local file="$1"
  [[ ! -s "$file" ]] || { warn "Последние сообщения APT:"; tail -n 8 "$file" >&2; }
}

try_system_apt() {
  local plan_log="$WORK/system-plan.log" download_log="$WORK/system-download.log" install_log="$WORK/system-install.log"
  info "Проверяем штатный APT целевой ОС без фиксации версий: ${requested[*]}"
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      --simulate --no-remove --no-install-recommends install -- "${requested[@]}" >"$plan_log" 2>&1; then
    show_apt_failure "$plan_log"
    return 10
  fi
  if [[ "$CHECK_ONLY" == true ]]; then
    info "Штатный APT разрешает зависимости по именам пакетов; установка не выполнялась"
    return 0
  fi

  # Сначала загружаем весь план, не меняя dpkg. Если target repositories недоступны,
  # auto-mode безопасно перейдёт к bundled repository до любой системной модификации.
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      --download-only --no-remove --no-install-recommends --yes install -- "${requested[@]}" >"$download_log" 2>&1; then
    show_apt_failure "$download_log"
    return 11
  fi

  info "Устанавливаем зависимости штатным APT целевой ОС по именам пакетов"
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      --no-remove --no-install-recommends --yes install -- "${requested[@]}" >"$install_log" 2>&1; then
    cat "$install_log" >&2
    die "Штатный APT начал установку, но завершился ошибкой. Автоматический fallback и apt --fix-broken после изменения dpkg намеренно не запускаются"
  fi
  DPKG_AUDIT="$(dpkg --audit || true)"
  [[ -z "$DPKG_AUDIT" ]] || die "После штатной APT-установки пакетная база нецелостна: $DPKG_AUDIT"
  info "Системные зависимости установлены штатным APT без version pinning"
  return 0
}

if [[ "$MODE" != bundle ]]; then
  if try_system_apt; then
    exit 0
  else
    status=$?
  fi
  if [[ "$MODE" == system ]]; then
    die "Штатный APT не смог подготовить установку (код $status); bundle fallback отключён режимом system"
  fi
  warn "Штатный APT не смог безопасно подготовить пакеты; переключаемся на автономный repository bundle"
fi

# Air-gap fallback: bundled .deb остаются самодостаточным резервным источником.
# APT получает только имена верхнеуровневых пакетов и учитывает уже установленные
# версии target-системы; никакие package=version здесь не используются.
mkdir -p "$WORK/bundle-repo"
mapfile -d '' source_debs < <(find "$PACKAGE_ROOT" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z)
((${#source_debs[@]})) || die "В full bundle нет .deb"
for source in "${source_debs[@]}"; do cp "$source" "$WORK/bundle-repo/"; done
REPO="$WORK/bundle-repo"
mapfile -d '' debs < <(find "$REPO" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z)
PACKAGES_INDEX="$REPO/Packages"
: > "$PACKAGES_INDEX"
for deb in "${debs[@]}"; do
  filename="$(basename "$deb")"
  dpkg-deb -f "$deb" >> "$PACKAGES_INDEX"
  printf 'Filename: ./%s\nSize: %s\nSHA256: %s\n\n' \
    "$filename" "$(stat -c %s "$deb")" "$(sha256_of "$deb")" >> "$PACKAGES_INDEX"
done
gzip -n -9 -c "$PACKAGES_INDEX" > "$REPO/Packages.gz"
printf 'deb [trusted=yes] file:%s ./\n' "$REPO" > "$WORK/bundle-sources.list"
mkdir -p "$WORK/bundle-lists/partial" "$WORK/bundle-archives/partial"
chmod 0755 "$REPO" "$WORK/bundle-lists" "$WORK/bundle-lists/partial" "$WORK/bundle-archives" "$WORK/bundle-archives/partial"
BUNDLE_APT_OPTIONS=(
  -o "Dir::Etc::sourcelist=$WORK/bundle-sources.list"
  -o "Dir::Etc::sourceparts=-"
  -o "Dir::State::lists=$WORK/bundle-lists"
  -o "Dir::Cache::archives=$WORK/bundle-archives"
  -o "APT::Get::List-Cleanup=0"
  -o "Acquire::Languages=none"
  -o "Acquire::Retries=0"
)
info "Индексируем автономный file: repository; внешние APT sources отключены"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${BUNDLE_APT_OPTIONS[@]}" update >/dev/null
cut -f2 "$PACKAGE_ROOT/packages.tsv" | tail -n +2 | LC_ALL=C sort -u > "$WORK/included.txt"
info "Проверяем автономный APT-план (${#debs[@]} .deb, ${#requested[@]} верхнеуровневых пакетов)"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${BUNDLE_APT_OPTIONS[@]}" \
  --simulate --no-remove --no-install-recommends install -- "${requested[@]}" > "$WORK/bundle-plan.txt"
sed -n -E 's/^Inst ([^ ]+).*/\1/p' "$WORK/bundle-plan.txt" | sed -E 's/:[a-z0-9-]+$//' | LC_ALL=C sort -u > "$WORK/planned.txt"
comm -23 "$WORK/planned.txt" "$WORK/included.txt" > "$WORK/missing.txt"
if [[ -s "$WORK/missing.txt" ]]; then
  cat "$WORK/missing.txt" >&2
  die "Автономный APT-план требует пакеты, отсутствующие в bundle"
fi
if [[ "$CHECK_ONLY" == true ]]; then
  info "Автономный APT-план замкнут и совместим с текущей системой; установка не выполнялась"
  exit 0
fi
info "Устанавливаем зависимости из автономного file: repository по именам пакетов"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${BUNDLE_APT_OPTIONS[@]}" \
  --no-remove --no-install-recommends --yes install -- "${requested[@]}"
DPKG_AUDIT="$(dpkg --audit || true)"
[[ -z "$DPKG_AUDIT" ]] || die "После автономной установки пакетная база нецелостна: $DPKG_AUDIT"
info "Системные зависимости full bundle установлены"
