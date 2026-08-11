#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
PACKAGE_ROOT="${1:-}"
CHECK_ONLY=false
[[ "${2:-}" != "--check-only" ]] || CHECK_ONLY=true
[[ -n "$PACKAGE_ROOT" && -d "$PACKAGE_ROOT" ]] || die "Использование: install-os-packages.sh DIR [--check-only]"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Установка пакетов ОС требует root"
for command in apt-get dpkg dpkg-deb comm cut find sed sort sha256sum gzip stat; do require_command "$command"; done
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

# Создаём плоский локальный APT repository без внешних source. Это надёжнее,
# чем передавать сотни ./package.deb: APT разрешает Depends/Pre-Depends по
# нормальному package index, но физически может читать пакеты только из $WORK.
PACKAGES_INDEX="$WORK/Packages"
: > "$PACKAGES_INDEX"
for deb in "${debs[@]}"; do
  filename="$(basename "$deb")"
  dpkg-deb -f "$deb" >> "$PACKAGES_INDEX"
  printf 'Filename: ./%s\nSize: %s\nSHA256: %s\n\n' \
    "$filename" "$(stat -c %s "$deb")" "$(sha256_of "$deb")" >> "$PACKAGES_INDEX"
done
gzip -n -9 -c "$PACKAGES_INDEX" > "$WORK/Packages.gz"
printf 'deb [trusted=yes] file:%s ./\n' "$WORK" > "$WORK/sources.list"
mkdir -p "$WORK/lists/partial" "$WORK/archives/partial"
APT_OPTIONS=(
  -o "Dir::Etc::sourcelist=$WORK/sources.list"
  -o "Dir::Etc::sourceparts=-"
  -o "Dir::State::lists=$WORK/lists"
  -o "Dir::Cache::archives=$WORK/archives"
  -o "APT::Get::List-Cleanup=0"
  -o "Acquire::Languages=none"
  -o "Acquire::Retries=0"
)
info "Индексируем локальный APT repository; внешние sources отключены"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTIONS[@]}" update >/dev/null

mapfile -t requested < <(sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_ROOT/requested-packages.txt" | awk 'NF {print $1}' | LC_ALL=C sort -u)
((${#requested[@]})) || die "requested-packages.txt пуст"
cut -f2 "$PACKAGE_ROOT/packages.tsv" | tail -n +2 | LC_ALL=C sort -u > "$WORK/included.txt"
info "Проверяем автономный APT-план (${#debs[@]} .deb, ${#requested[@]} верхнеуровневых пакетов)"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTIONS[@]}" \
  --simulate --no-remove --no-install-recommends install -- "${requested[@]}" > "$WORK/package-plan.txt"
sed -n -E 's/^Inst ([^ ]+).*/\1/p' "$WORK/package-plan.txt" | sed -E 's/:[a-z0-9-]+$//' | LC_ALL=C sort -u > "$WORK/planned.txt"
comm -23 "$WORK/planned.txt" "$WORK/included.txt" > "$WORK/missing.txt"
if [[ -s "$WORK/missing.txt" ]]; then
  cat "$WORK/missing.txt" >&2
  die "APT-план требует пакеты, отсутствующие в bundle"
fi
if [[ "$CHECK_ONLY" == true ]]; then
  info "Локальный APT-план замкнут и совместим с текущей системой; установка не выполнялась"
  exit 0
fi
info "Устанавливаем системные зависимости только из file: repository bundle"
LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTIONS[@]}" \
  --no-remove --no-install-recommends --yes install -- "${requested[@]}"
DPKG_AUDIT="$(dpkg --audit || true)"
[[ -z "$DPKG_AUDIT" ]] || die "После установки пакетная база нецелостна: $DPKG_AUDIT"
info "Системные зависимости full bundle установлены"
