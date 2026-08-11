#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/lib.sh"
PACKAGE_LIST="${KAFEDRA_OS_PACKAGE_LIST:-$ROOT/config/offline/os-packages.txt}"
OUTPUT="${KAFEDRA_OS_PACKAGES_DIR:-$ROOT/.offline-cache/os-packages}"
RUN_UPDATE=0
while (($#)); do
  case "$1" in
    --package-list) PACKAGE_LIST="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --apt-update) RUN_UPDATE=1; shift ;;
    -h|--help) echo "Использование: collect-os-packages.sh [--package-list FILE] [--output DIR] [--apt-update]"; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
for c in apt-get awk dpkg dpkg-deb find sha256sum sort sed; do require_command "$c"; done
[[ -f "$PACKAGE_LIST" ]] || die "Не найден список пакетов: $PACKAGE_LIST"
mapfile -t profile < <(detect_os_profile /etc/os-release)
[[ "${profile[0]}" == astra || "${profile[1]}" == debian ]] || die "Полный bundle собирается на reference Debian/Astra той же версии, что target"
mapfile -t packages < <(sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" | awk 'NF { $1=$1; print }' | LC_ALL=C sort -u)
((${#packages[@]})) || die "Список пакетов пуст"
for p in "${packages[@]}"; do [[ "$p" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || die "Некорректный пакет: $p"; done
mkdir -p "$OUTPUT"; OUTPUT="$(absolute_path "$OUTPUT")"
rm -f "$OUTPUT"/*.deb "$OUTPUT"/manifest.sha256 "$OUTPUT"/packages.tsv "$OUTPUT"/requested-packages.txt "$OUTPUT"/source-os.env "$OUTPUT"/lock
rm -rf "$OUTPUT/partial"; mkdir -p "$OUTPUT/partial"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK" "$OUTPUT/partial"; rm -f "$OUTPUT/lock"' EXIT
: > "$WORK/status"
((RUN_UPDATE == 0)) || apt-get update
info "Скачиваем полное замыкание .deb: ${packages[*]}"
apt-get -o "Dir::Cache::archives=$OUTPUT" -o "Dir::State::status=$WORK/status" -o APT::Keep-Downloaded-Packages=true -o Debug::NoLocking=1 \
  --download-only --no-install-recommends --yes install -- "${packages[@]}"
mapfile -d '' debs < <(find "$OUTPUT" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z)
((${#debs[@]})) || die "APT не скачал .deb"
printf '%s\n' "${packages[@]}" > "$OUTPUT/requested-packages.txt"
(cd "$OUTPUT" && find . -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > manifest.sha256)
cat > "$OUTPUT/source-os.env" <<EOF
OS_FAMILY=${profile[0]}
OS_ID=${profile[1]}
OS_VERSION_ID=${profile[2]}
DEB_ARCHITECTURE=${profile[3]}
DEPENDENCY_CLOSURE=full
APT_INSTALL_RECOMMENDS=false
REQUESTED_PACKAGES_SHA256=$(sha256_of "$OUTPUT/requested-packages.txt")
EOF
ROWS="$WORK/rows"; : > "$ROWS"
for deb in "${debs[@]}"; do
  filename="$(basename "$deb")"; package="$(dpkg-deb -f "$deb" Package)"; version="$(dpkg-deb -f "$deb" Version)"; arch="$(dpkg-deb -f "$deb" Architecture)"
  [[ "$arch" == all || "$arch" == "${profile[3]}" ]] || die "Чужая архитектура $filename: $arch"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(sha256_of "$deb")" "$package" "$version" "$arch" "$filename" >> "$ROWS"
done
{ printf 'sha256\tpackage\tversion\tarchitecture\tfilename\n'; LC_ALL=C sort -t $'\t' -k5,5 "$ROWS"; } > "$OUTPUT/packages.tsv"
verify_os_package_set "$OUTPUT" 1
info "Собрано ${#debs[@]} пакетов для ${profile[*]}"
printf '%s\n' "$OUTPUT"
