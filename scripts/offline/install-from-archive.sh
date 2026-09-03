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

ARCHIVE_INPUT="${1:-$(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print -quit)}"
[[ -n "$ARCHIVE_INPUT" ]] || { echo 'Рядом с установщиком не найден kafedra-planner-*.tar.gz' >&2; exit 2; }
ARCHIVE="$(absolute_file "$ARCHIVE_INPUT")"
[[ -f "$ARCHIVE" ]] || { printf 'Архив не найден: %s\n' "$ARCHIVE" >&2; exit 2; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then exec sudo -- "$0" "$ARCHIVE"; fi
  printf 'Для установки нужны права root. Запустите: sudo %s %s\n' "$0" "$ARCHIVE" >&2
  exit 2
fi

for command in tar sha256sum mktemp find sort sed chmod; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Не найдена команда: %s\n' "$command" >&2; exit 2; }
done

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

# Сам staging root остаётся приватным (0700), но содержимое bundle и локальный
# file: APT repository должны быть читаемы sandbox-пользователем _apt и service
# user. Возвращаем штатный umask до распаковки; исходная пользовательская папка
# при этом не изменяется.
umask 022
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$WORK"
ROOT="$WORK/${roots[0]}"
[[ -f "$ROOT/install.sh" ]] || { echo 'В архиве отсутствует install.sh' >&2; exit 3; }
chmod 0755 "$ROOT/install.sh"
printf 'Архив проверен. Установка выполняется из приватного временного каталога root; владелец исходной папки не меняется.\n'

# Не заменяем launcher через exec: его EXIT-trap обязан удалить private staging
# и после успешной установки, и после ошибки внутреннего installer.
"$ROOT/install.sh"
