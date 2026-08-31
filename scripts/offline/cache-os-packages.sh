#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SOURCE="${1:-}"
[[ -n "$SOURCE" && $# -eq 1 ]] || die "Использование: cache-os-packages.sh DIR"

KAFEDRA_OS_PACKAGE_CACHE_ROOT="${KAFEDRA_OS_PACKAGE_CACHE_ROOT:-/var/cache/kafedra-planner/os-packages}"
for command in awk basename chmod cmp find grep install mktemp mv rm sed sha256sum sort; do
  require_command "$command"
done

[[ -d "$SOURCE" && ! -L "$SOURCE" ]] || die "Не найден проверяемый каталог пакетов ОС: $SOURCE"
SOURCE="$(absolute_path "$SOURCE")"

# The source is untrusted removable-media input until the complete package
# contract, every digest, every .deb metadata record and the target profile pass.
verify_os_package_set "$SOURCE" 1

profile_key_for() {
  local root="$1" family id version arch series key
  family="$(read_env_value "$root/source-os.env" OS_FAMILY)"
  id="$(read_env_value "$root/source-os.env" OS_ID)"
  version="$(read_env_value "$root/source-os.env" OS_VERSION_ID)"
  arch="$(read_env_value "$root/source-os.env" DEB_ARCHITECTURE)"
  series="$(normalize_os_series "$family" "$version")"
  key="$(printf '%s-%s-%s-%s' "$family" "$id" "$series" "$arch" | sed -E 's/[^A-Za-z0-9._-]+/_/g')"
  [[ "$key" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$ ]] || die "Некорректная identity профиля пакетов ОС"
  printf '%s' "$key"
}

PROFILE_KEY="$(profile_key_for "$SOURCE")"
MANIFEST_DIGEST="$(sha256_of "$SOURCE/manifest.sha256")"
[[ "$MANIFEST_DIGEST" =~ ^[a-f0-9]{64}$ ]] || die "Не удалось вычислить identity package manifest"

if [[ -e "$KAFEDRA_OS_PACKAGE_CACHE_ROOT" && -L "$KAFEDRA_OS_PACKAGE_CACHE_ROOT" ]]; then
  die "Корень кэша пакетов ОС не может быть симлинком"
fi
install -d -m 0755 "$KAFEDRA_OS_PACKAGE_CACHE_ROOT"
CACHE_ROOT="$(absolute_path "$KAFEDRA_OS_PACKAGE_CACHE_ROOT")"
PROFILE_ROOT="$CACHE_ROOT/$PROFILE_KEY"

if [[ -e "$PROFILE_ROOT" && ( ! -d "$PROFILE_ROOT" || -L "$PROFILE_ROOT" ) ]]; then
  die "Каталог профиля кэша повреждён: $PROFILE_ROOT"
fi
install -d -m 0755 "$PROFILE_ROOT"
DESTINATION="$PROFILE_ROOT/$MANIFEST_DIGEST"

payload_matches_source() {
  local candidate="$1"
  [[ -d "$candidate" && ! -L "$candidate" ]] || return 1
  verify_os_package_set "$candidate" 1 >/dev/null 2>&1 || return 1
  [[ "$(profile_key_for "$candidate")" == "$PROFILE_KEY" ]] || return 1
  cmp -s "$SOURCE/manifest.sha256" "$candidate/manifest.sha256" || return 1
  cmp -s "$SOURCE/packages.tsv" "$candidate/packages.tsv" || return 1
  cmp -s "$SOURCE/requested-packages.txt" "$candidate/requested-packages.txt" || return 1
  if find "$candidate" -maxdepth 0 -perm /222 -print -quit | grep -q .; then return 1; fi
  if find "$candidate" -maxdepth 1 -type f -perm /222 -print -quit | grep -q .; then return 1; fi
  return 0
}

if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  payload_matches_source "$DESTINATION" || die "Существующий immutable package cache повреждён или не совпадает: $DESTINATION"
  info "Проверенный payload пакетов ОС уже сохранён: $DESTINATION"
  printf '%s\n' "$DESTINATION"
  exit 0
fi

TEMP=""
cleanup() {
  if [[ -n "$TEMP" && -e "$TEMP" ]]; then
    chmod -R u+w "$TEMP" 2>/dev/null || true
    rm -rf -- "$TEMP"
  fi
}
trap cleanup EXIT

TEMP="$(mktemp -d "$PROFILE_ROOT/.${MANIFEST_DIGEST}.tmp.XXXXXX")"
chmod 0700 "$TEMP"
while IFS= read -r -d '' source_file; do
  install -m 0444 -- "$source_file" "$TEMP/$(basename "$source_file")"
done < <(find "$SOURCE" -maxdepth 1 -type f -print0 | LC_ALL=C sort -z)

verify_os_package_set "$TEMP" 1
[[ "$(profile_key_for "$TEMP")" == "$PROFILE_KEY" ]] || die "Профиль изменился при копировании package payload"
cmp -s "$SOURCE/manifest.sha256" "$TEMP/manifest.sha256" || die "Package manifest изменился при копировании"
cmp -s "$SOURCE/packages.tsv" "$TEMP/packages.tsv" || die "Package inventory изменился при копировании"
cmp -s "$SOURCE/requested-packages.txt" "$TEMP/requested-packages.txt" || die "Package request set изменился при копировании"

# Files and the leaf directory become read-only before the atomic publish.
# Concurrent identical writers either publish once or validate the winner.
chmod 0555 "$TEMP"
mv -T -n -- "$TEMP" "$DESTINATION"
if [[ ! -e "$TEMP" ]]; then
  TEMP=""
fi

payload_matches_source "$DESTINATION" || die "Не удалось подтвердить опубликованный immutable package cache"
info "Сохранён проверенный payload пакетов ОС: $DESTINATION"
printf '%s\n' "$DESTINATION"
