#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
PACKAGE_ROOT="${1:-}"
CHECK_ONLY=false
[[ "${2:-}" != "--check-only" ]] || CHECK_ONLY=true
[[ -n "$PACKAGE_ROOT" && -d "$PACKAGE_ROOT" ]] || die "Использование: install-os-packages.sh DIR [--check-only]"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Установка пакетов ОС требует root"
for command in apt-get dpkg dpkg-deb comm cut find sed sort sha256sum; do require_command "$command"; done
PACKAGE_ROOT="$(absolute_path "$PACKAGE_ROOT")"
verify_os_package_set "$PACKAGE_ROOT" 1
DPKG_AUDIT="$(dpkg --audit || true)"
[[ -z "$DPKG_AUDIT" ]] || die "Пакетная база ОС требует исправления до автономной установки: $DPKG_AUDIT"
WORK="$(mktemp -d /tmp/kafedra-apt.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mapfile -d '' source_debs < <(find "$PACKAGE_ROOT" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z)
((${#source_debs[@]})) || die "В full bundle нет .deb"
for source in "${source_debs[@]}"; do cp "$source" "$WORK/"; done
mapfile -d '' debs < <(find "$WORK" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z)
args=()
for deb in "${debs[@]}"; do args+=("./$(basename "$deb")"); done
cut -f2 "$PACKAGE_ROOT/packages.tsv" | tail -n +2 | LC_ALL=C sort -u > "$WORK/included.txt"
info "Проверяем автономный APT-план (${#debs[@]} .deb), без удаления и recommends"
(
  cd "$WORK"
  # --simulate ничего не скачивает. Политика --no-install-recommends обязана
  # совпадать с collect-os-packages.sh, иначе APT добавит пакеты, которые
  # намеренно не входят в минимальное dependency closure.
  LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get --simulate --no-remove --no-install-recommends install -- "${args[@]}" > package-plan.txt
  sed -n -E 's/^Inst ([^ ]+).*/\1/p' package-plan.txt | sed -E 's/:[a-z0-9-]+$//' | LC_ALL=C sort -u > planned.txt
  comm -23 planned.txt included.txt > missing.txt
  if [[ -s missing.txt ]]; then
    cat missing.txt >&2
    die "APT-план требует пакеты, отсутствующие в bundle"
  fi
)
if [[ "$CHECK_ONLY" == true ]]; then
  info "APT-план замкнут и совместим с текущей системой; установка не выполнялась"
  exit 0
fi
info "Устанавливаем системные зависимости из bundle; сетевые загрузки запрещены"
(
  cd "$WORK"
  LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get --no-download --no-remove --no-install-recommends --yes install -- "${args[@]}"
)
DPKG_AUDIT="$(dpkg --audit || true)"
[[ -z "$DPKG_AUDIT" ]] || die "После установки пакетная база нецелостна: $DPKG_AUDIT"
info "Системные зависимости full bundle установлены"
