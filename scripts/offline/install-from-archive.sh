#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

absolute_file() {
  local input="$1" directory base
  directory="$(cd "$(dirname "$input")" && pwd -P)"
  base="$(basename "$input")"
  printf '%s/%s\n' "$directory" "$base"
}

read_os_release_value() {
  local file="$1" key="$2" value
  value="$(grep -E "^[[:space:]]*${key}=" "$file" | head -n 1 | cut -d= -f2- || true)"
  if [[ ${#value} -ge 2 && ("$value" == \"*\" || "$value" == \'*\') ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

normalize_os_series() {
  local family="$1" version="$2"
  if [[ "$family" == astra ]]; then
    if [[ "$version" =~ ^1\.7 ]]; then printf '1.7'; return 0; fi
    if [[ "$version" =~ ^1\.8 ]]; then printf '1.8'; return 0; fi
    printf '%s' "${version%%_*}"
  elif [[ "$family" == debian ]]; then
    printf '%s' "${version%%.*}"
  else
    printf '%s' "$version"
  fi
}

target_profile() {
  local file="${KAFEDRA_OS_RELEASE_FILE:-/etc/os-release}" id version name pretty like description family arch
  [[ -f "$file" ]] || { printf 'Не найден профиль целевой ОС: %s\n' "$file" >&2; return 1; }
  id="$(read_os_release_value "$file" ID)"
  version="$(read_os_release_value "$file" VERSION_ID)"
  name="$(read_os_release_value "$file" NAME)"
  pretty="$(read_os_release_value "$file" PRETTY_NAME)"
  like="$(read_os_release_value "$file" ID_LIKE)"
  description="${id,,} ${name,,} ${pretty,,} ${like,,}"
  if [[ "$description" == *astra* ]]; then family=astra
  elif [[ "$id" == debian || " ${like,,} " == *" debian "* ]]; then family=debian
  else family=unsupported; fi
  arch="${KAFEDRA_DPKG_ARCHITECTURE:-$(dpkg --print-architecture 2>/dev/null || true)}"
  [[ "$family" != unsupported && -n "$version" && -n "$arch" ]] || {
    printf 'Неподдерживаемая целевая ОС: id=%s version=%s arch=%s\n' "$id" "$version" "$arch" >&2
    return 1
  }
  printf '%s\t%s\t%s\t%s\n' "$family" "$id" "$version" "$arch"
}

metadata_value() {
  local text="$1" key="$2"
  printf '%s\n' "$text" | sed -n "s/^${key}=//p" | tail -n 1
}

bundle_profile() {
  local archive="$1" entry metadata family id version arch
  mapfile -t entries < <(tar -tzf "$archive" 2>/dev/null | grep -E '(^|/)os-packages/source-os\.env$' || true)
  ((${#entries[@]} == 1)) || return 1
  metadata="$(tar -xOzf "$archive" "${entries[0]}" 2>/dev/null)" || return 1
  family="$(metadata_value "$metadata" OS_FAMILY)"
  id="$(metadata_value "$metadata" OS_ID)"
  version="$(metadata_value "$metadata" OS_VERSION_ID)"
  arch="$(metadata_value "$metadata" DEB_ARCHITECTURE)"
  [[ "$family" == astra || "$family" == debian ]] || return 1
  [[ -n "$id" && -n "$version" && ("$arch" == amd64 || "$arch" == arm64) ]] || return 1
  printf '%s\t%s\t%s\t%s\n' "$family" "$id" "$version" "$arch"
}

select_compatible_archive() {
  local target target_family target_id target_version target_arch target_series
  local candidate profile family id version arch series
  local -a matches=() available=()
  target="$(target_profile)" || return 2
  IFS=$'\t' read -r target_family target_id target_version target_arch <<<"$target"
  target_series="$(normalize_os_series "$target_family" "$target_version")"

  mapfile -d '' candidates < <(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print0 | LC_ALL=C sort -z)
  ((${#candidates[@]})) || {
    printf 'Рядом с установщиком не найден kafedra-planner-*.tar.gz\n' >&2
    return 2
  }
  for candidate in "${candidates[@]}"; do
    if profile="$(bundle_profile "$candidate")"; then
      IFS=$'\t' read -r family id version arch <<<"$profile"
      series="$(normalize_os_series "$family" "$version")"
      available+=("$(basename "$candidate"): ${family}/${id} ${series} ${arch}")
      if [[ "$family" == "$target_family" && "$series" == "$target_series" && "$arch" == "$target_arch" ]]; then
        matches+=("$candidate")
      fi
    else
      available+=("$(basename "$candidate"): профиль bundle не читается")
    fi
  done

  if ((${#matches[@]} == 1)); then
    printf '%s\n' "${matches[0]}"
    return 0
  fi
  if ((${#matches[@]} == 0)); then
    printf 'Нет совместимого offline bundle для %s/%s %s %s.\n' "$target_family" "$target_id" "$target_series" "$target_arch" >&2
  else
    printf 'Найдено несколько совместимых offline bundle для %s/%s %s %s; выбор неоднозначен.\n' "$target_family" "$target_id" "$target_series" "$target_arch" >&2
  fi
  printf 'Доступные архивы:\n' >&2
  printf '  - %s\n' "${available[@]}" >&2
  return 2
}

PRINT_SELECTION=false
if [[ "${1:-}" == --print-selection ]]; then PRINT_SELECTION=true; shift; fi
(($# <= 1)) || { echo 'Использование: install-kafedra-planner.sh [--print-selection] [ARCHIVE]' >&2; exit 2; }

for command in tar sha256sum mktemp find sort sed chmod grep cut tail dpkg; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Не найдена команда: %s\n' "$command" >&2; exit 2; }
done

ARCHIVE="${1:-}"
if [[ -n "$ARCHIVE" ]]; then
  ARCHIVE="$(absolute_file "$ARCHIVE")"
else
  ARCHIVE="$(select_compatible_archive)" || exit $?
fi
[[ -f "$ARCHIVE" ]] || { printf 'Архив не найден: %s\n' "$ARCHIVE" >&2; exit 2; }
if [[ "$PRINT_SELECTION" == true ]]; then printf '%s\n' "$ARCHIVE"; exit 0; fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then exec sudo -- "$0" "$ARCHIVE"; fi
  printf 'Для установки нужны права root. Запустите: sudo %s %s\n' "$0" "$ARCHIVE" >&2
  exit 2
fi

CHECKSUM="$ARCHIVE.sha256"
[[ -f "$CHECKSUM" ]] || { printf 'Не найден внешний SHA-256: %s\n' "$CHECKSUM" >&2; exit 3; }
EXPECTED_LINE="$(cat "$CHECKSUM")"
EXPECTED_NAME="${EXPECTED_LINE##* }"
[[ "$EXPECTED_NAME" == "$(basename "$ARCHIVE")" && "$EXPECTED_LINE" =~ ^[0-9a-fA-F]{64}[[:space:]] ]] || {
  echo 'Файл внешнего SHA-256 имеет неожиданный формат или относится к другому архиву.' >&2
  exit 3
}
(cd "$(dirname "$ARCHIVE")" && sha256sum -c --strict "$(basename "$CHECKSUM")")

WORK="$(mktemp -d /tmp/kafedra-install.XXXXXX)"
chmod 0700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
LIST="$WORK/archive-list.txt"
tar -tzf "$ARCHIVE" > "$LIST"
[[ -s "$LIST" ]] || { echo 'Архив пуст' >&2; exit 3; }
while IFS= read -r entry; do
  clean="${entry#./}"
  [[ "$clean" != /* && "$clean" != .. && "$clean" != ../* && "$clean" != */../* && "$clean" != */.. ]] || {
    echo "Небезопасный путь в архиве: $entry" >&2
    exit 3
  }
  [[ ! "$entry" =~ [[:cntrl:]\\] ]] || { echo "Небезопасное имя в архиве: $entry" >&2; exit 3; }
done < "$LIST"
mapfile -t roots < <(sed 's#^\./##; s#/.*##' "$LIST" | sed '/^$/d' | LC_ALL=C sort -u)
((${#roots[@]} == 1)) || { echo 'Архив должен иметь один корневой каталог' >&2; exit 3; }

umask 022
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$WORK"
ROOT="$WORK/${roots[0]}"
[[ -f "$ROOT/install.sh" ]] || { echo 'В архиве отсутствует install.sh' >&2; exit 3; }
chmod 0755 "$ROOT/install.sh"
printf 'Архив проверен. Установка выполняется из приватного временного каталога root; владелец исходной папки не меняется.\n'
"$ROOT/install.sh"
