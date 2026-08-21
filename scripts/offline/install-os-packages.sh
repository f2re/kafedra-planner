#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SAFE_DEGRADED_EXIT=20
FATAL_TRANSACTION_EXIT=70
FATAL_POSTCHECK_EXIT=71
PACKAGE_ROOT="${1:-}"
[[ -n "$PACKAGE_ROOT" ]] || die "Использование: install-os-packages.sh DIR [--check-only] [--mode auto|system|bundle] [--scope all|extract|ocr|office]"
shift || true

CHECK_ONLY=false
MODE="${KAFEDRA_APT_MODE:-auto}"
SCOPE=all
while (($#)); do
  case "$1" in
    --check-only) CHECK_ONLY=true; shift ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --system-only) MODE=system; shift ;;
    --offline-only|--bundle-only) MODE=bundle; shift ;;
    -h|--help)
      cat <<'HELP'
Использование: install-os-packages.sh DIR [--check-only] [--mode auto|system|bundle] [--scope all|extract|ocr|office]

Режимы:
  auto    сначала штатный APT целевой ОС по именам недостающих пакетов, затем bundle fallback;
  system  только штатные APT sources целевой ОС;
  bundle  только локальный file: repository из full bundle (air-gap).

Области:
  all      все фактически недостающие возможности обработки документов;
  extract  unzip и Poppler для чтения офисных файлов/PDF;
  ocr      pdftoppm, Tesseract и запрошенные rus/eng языки;
  office   LibreOffice и шрифты для офисного preview.

Target policy строго additive-only: APT не получает package=version, --fix-broken
не используется, а любой plan с удалением, upgrade или downgrade уже
установленного пакета отклоняется до изменения dpkg.
HELP
      exit 0
      ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
[[ "$MODE" == auto || "$MODE" == system || "$MODE" == bundle ]] || die "Некорректный APT mode: $MODE"
[[ "$SCOPE" == all || "$SCOPE" == extract || "$SCOPE" == ocr || "$SCOPE" == office ]] || die "Некорректный scope: $SCOPE"
[[ -d "$PACKAGE_ROOT" ]] || die "Не найден каталог пакетов ОС: $PACKAGE_ROOT"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Установка пакетов ОС требует root"
for command in apt-get awk comm cp cut dpkg dpkg-deb find grep gzip sed sort sha256sum stat tail; do require_command "$command"; done
PACKAGE_ROOT="$(absolute_path "$PACKAGE_ROOT")"
verify_os_package_set "$PACKAGE_ROOT" 1

mapfile -t requested < <(sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_ROOT/requested-packages.txt" | awk 'NF {print $1}' | LC_ALL=C sort -u)
((${#requested[@]})) || die "requested-packages.txt пуст"
for package in "${requested[@]}"; do
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || die "Некорректный package name: $package"
done

needed=()
add_needed() {
  local package="$1" current
  for current in "${needed[@]:-}"; do [[ "$current" == "$package" ]] && return 0; done
  needed+=("$package")
}
has_command() { command -v "$1" >/dev/null 2>&1; }

if [[ "$SCOPE" == all || "$SCOPE" == extract ]]; then
  has_command unzip || add_needed unzip
  has_command pdftotext || add_needed poppler-utils
fi

if [[ "$SCOPE" == all || "$SCOPE" == ocr ]]; then
  has_command pdftoppm || add_needed poppler-utils
  if ! has_command tesseract; then add_needed tesseract-ocr; fi
  OCR_LANGUAGES="${KAFEDRA_OCR_LANGUAGES:-rus+eng}"
  AVAILABLE_LANGUAGES=""
  if has_command tesseract; then AVAILABLE_LANGUAGES="$(tesseract --list-langs 2>/dev/null || true)"; fi
  IFS='+' read -r -a language_list <<< "$OCR_LANGUAGES"
  for language in "${language_list[@]}"; do
    [[ -n "$language" ]] || continue
    if [[ -n "$AVAILABLE_LANGUAGES" ]] && grep -Fxq "$language" <<< "$AVAILABLE_LANGUAGES"; then continue; fi
    case "$language" in
      rus) add_needed tesseract-ocr-rus ;;
      eng) add_needed tesseract-ocr-eng ;;
      *) warn "Для OCR-языка '$language' нет package mapping в автономном bundle; его можно добавить в системный Tesseract отдельно" ;;
    esac
  done
fi

if [[ "$SCOPE" == all || "$SCOPE" == office ]]; then
  if ! has_command soffice && ! has_command libreoffice; then
    add_needed libreoffice-core
    add_needed libreoffice-writer
    add_needed libreoffice-calc
    add_needed fontconfig
    add_needed fonts-dejavu-core
  fi
fi

if ((${#needed[@]} == 0)); then
  info "Запрошенные возможности уже доступны; APT не требуется (scope=$SCOPE)"
  exit 0
fi
mapfile -t needed < <(printf '%s\n' "${needed[@]}" | LC_ALL=C sort -u)
for package in "${needed[@]}"; do
  printf '%s\n' "${requested[@]}" | grep -Fxq "$package" || die "Недостающий пакет '$package' отсутствует в package profile bundle"
done
info "Недостающие пакеты для scope=$SCOPE: ${needed[*]}"

WORK="$(mktemp -d /tmp/kafedra-apt.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
chmod 0755 "$WORK"

check_package_database() {
  local stage="$1"
  local audit log_file
  log_file="$WORK/apt-check-$stage.log"
  audit="$(dpkg --audit || true)"
  if [[ -n "$audit" && "${EUID:-$(id -u)}" -eq 0 ]]; then
    info "Обнаружены незавершённые операции dpkg ($stage); выполняю безопасное завершение 'dpkg --configure -a'..."
    if LC_ALL=C DEBIAN_FRONTEND=noninteractive dpkg --configure -a >/dev/null 2>&1; then
      audit="$(dpkg --audit || true)"
      if [[ -z "$audit" ]]; then
        info "Незавершённые операции dpkg успешно устранены автоматической настройкой"
      fi
    fi
  fi
  if [[ -n "$audit" ]]; then
    warn "Пакетная база ОС имеет незавершённые dpkg-операции ($stage). Kafedra Planner ничего не исправляет автоматически: $audit"
    warn "Подсказка: Для завершения незавершённых настроек пакетов выполните 'sudo dpkg --configure -a'"
    return 1
  fi
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get check >"$log_file" 2>&1; then
    warn "APT целевой ОС уже имеет неудовлетворённые зависимости ($stage). Kafedra Planner не менял пакеты."
    tail -n 12 "$log_file" >&2 || true
    warn "Автоматический apt --fix-broken намеренно запрещён"
    warn "Подсказка: Проверьте состояние зависимостей через 'sudo apt-get check' и восстановите репозитории ОС"
    return 1
  fi
  return 0
}
if ! check_package_database before; then
  exit "$SAFE_DEGRADED_EXIT"
fi

mkdir -p "$WORK/system-archives/partial"
chmod 0755 "$WORK/system-archives" "$WORK/system-archives/partial"
SYSTEM_APT_OPTIONS=(
  -o "Dir::Cache::archives=$WORK/system-archives"
  -o "Acquire::Retries=1"
)
TARGET_INSTALL_OPTIONS=(--no-remove --no-upgrade --no-install-recommends)

show_apt_failure() {
  local file="$1"
  [[ ! -s "$file" ]] || { warn "Последние сообщения APT:"; tail -n 12 "$file" >&2; }
}

try_system_apt() {
  local plan_log="$WORK/system-plan.log" download_log="$WORK/system-download.log" install_log="$WORK/system-install.log"
  info "Проверяем additive-only план штатного APT: ${needed[*]}"
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      --simulate "${TARGET_INSTALL_OPTIONS[@]}" install -- "${needed[@]}" >"$plan_log" 2>&1; then
    show_apt_failure "$plan_log"
    return 10
  fi
  if ! assert_additive_apt_plan "$plan_log"; then return 12; fi
  if [[ "$CHECK_ONLY" == true ]]; then
    info "Штатный APT разрешает additive-only plan; установка не выполнялась"
    return 0
  fi

  # Download the complete resolved plan before the first dpkg mutation. A
  # network/repository failure can therefore safely fall back to the local repo.
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      --download-only "${TARGET_INSTALL_OPTIONS[@]}" --yes install -- "${needed[@]}" >"$download_log" 2>&1; then
    show_apt_failure "$download_log"
    return 11
  fi

  info "Добавляем недостающие пакеты штатным APT без изменения установленных версий"
  if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${SYSTEM_APT_OPTIONS[@]}" \
      "${TARGET_INSTALL_OPTIONS[@]}" --yes install -- "${needed[@]}" >"$install_log" 2>&1; then
    cat "$install_log" >&2
    warn "Штатный APT начал изменяющую транзакцию и завершился ошибкой. Второй package transaction и --fix-broken намеренно не запускаются"
    exit "$FATAL_TRANSACTION_EXIT"
  fi
  check_package_database after-system-install || exit "$FATAL_POSTCHECK_EXIT"
  info "Недостающие системные возможности добавлены штатным APT"
  return 0
}

if [[ "$MODE" != bundle ]]; then
  if try_system_apt; then
    exit 0
  else
    status=$?
  fi
  if [[ "$MODE" == system ]]; then
    warn "Штатный APT не смог подготовить безопасную установку (код $status); bundle fallback отключён режимом system"
    exit "$SAFE_DEGRADED_EXIT"
  fi
  warn "Штатный APT не смог безопасно подготовить пакеты; пробуем автономный repository до изменения dpkg"
fi

# Air-gap fallback contains a complete closure, but target APT is still allowed
# only to add absent packages. Bundled versions never override installed ones.
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
info "Проверяем additive-only air-gap plan (${#debs[@]} .deb; запрошено ${#needed[@]} недостающих пакетов)"
if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${BUNDLE_APT_OPTIONS[@]}" \
    --simulate "${TARGET_INSTALL_OPTIONS[@]}" install -- "${needed[@]}" >"$WORK/bundle-plan.txt" 2>"$WORK/bundle-plan.err"; then
  cat "$WORK/bundle-plan.err" >&2 || true
  warn "Автономный repository несовместим с уже установленными пакетами target; система не изменена"
  exit "$SAFE_DEGRADED_EXIT"
fi
if ! assert_additive_apt_plan "$WORK/bundle-plan.txt"; then exit "$SAFE_DEGRADED_EXIT"; fi
sed -n -E 's/^Inst ([^ ]+).*/\1/p' "$WORK/bundle-plan.txt" | sed -E 's/:[a-z0-9-]+$//' | LC_ALL=C sort -u > "$WORK/planned.txt"
comm -23 "$WORK/planned.txt" "$WORK/included.txt" > "$WORK/missing.txt"
if [[ -s "$WORK/missing.txt" ]]; then
  cat "$WORK/missing.txt" >&2
  die "Автономный APT-план требует пакеты, отсутствующие в bundle"
fi
if [[ "$CHECK_ONLY" == true ]]; then
  info "Автономный additive-only plan совместим с текущей системой; установка не выполнялась"
  exit 0
fi
info "Добавляем недостающие пакеты из автономного repository без изменения установленных версий"
if ! LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${BUNDLE_APT_OPTIONS[@]}" \
    "${TARGET_INSTALL_OPTIONS[@]}" --yes install -- "${needed[@]}"; then
  warn "Автономный APT начал изменяющую транзакцию и завершился ошибкой; автоматическое исправление запрещено"
  exit "$FATAL_TRANSACTION_EXIT"
fi
check_package_database after-bundle-install || exit "$FATAL_POSTCHECK_EXIT"
info "Недостающие системные возможности добавлены из full bundle"
