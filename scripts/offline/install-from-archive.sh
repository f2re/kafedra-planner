#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  shopt -s nullglob
  candidates=("$SCRIPT_DIR"/kafedra-planner-*.tar.gz)
  shopt -u nullglob
  ((${#candidates[@]} == 1)) || { printf 'Рядом с установщиком должен находиться ровно один kafedra-planner-*.tar.gz\n' >&2; exit 2; }
  ARCHIVE="${candidates[0]}"
fi
[[ -f "$ARCHIVE" ]] || { printf 'Архив не найден: %s\n' "$ARCHIVE" >&2; exit 2; }
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then exec sudo -- "$0" "$ARCHIVE"; fi
  printf 'Для установки нужны права root. Запустите: sudo %s\n' "$0" >&2
  exit 2
fi
for command in tar sha256sum mktemp chown chmod; do command -v "$command" >/dev/null 2>&1 || { printf 'Не найдена команда: %s\n' "$command" >&2; exit 2; }; done
CHECKSUM="$ARCHIVE.sha256"
[[ -f "$CHECKSUM" ]] || { printf 'Не найден внешний SHA-256: %s\n' "$CHECKSUM" >&2; exit 3; }
(cd "$(dirname "$ARCHIVE")" && sha256sum -c --strict "$(basename "$CHECKSUM")")
WORK="$(mktemp -d /tmp/kafedra-install.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
LIST="$WORK/list.txt"
tar -tzf "$ARCHIVE" > "$LIST"
[[ -s "$LIST" ]] || { echo 'Архив пуст' >&2; exit 3; }
while IFS= read -r entry; do
  clean="${entry#./}"
  [[ "$clean" != /* && "$clean" != .. && "$clean" != ../* && "$clean" != */../* && "$clean" != */.. ]] || { echo "Небезопасный путь: $entry" >&2; exit 3; }
  [[ ! "$entry" =~ [[:cntrl:]\\] ]] || { echo "Небезопасное имя: $entry" >&2; exit 3; }
done < "$LIST"
mapfile -t roots < <(sed 's#^\./##; s#/.*##' "$LIST" | sed '/^$/d' | LC_ALL=C sort -u)
((${#roots[@]} == 1)) || { echo 'Архив должен иметь один корневой каталог' >&2; exit 3; }
tar -xzf "$ARCHIVE" -C "$WORK"
ROOT="$WORK/${roots[0]}"
[[ -x "$ROOT/install.sh" ]] || { echo 'В архиве отсутствует install.sh' >&2; exit 3; }
chown -R root:root "$ROOT"
chmod -R go-w "$ROOT"
exec "$ROOT/install.sh"
