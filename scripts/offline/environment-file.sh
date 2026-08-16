#!/usr/bin/env bash
# Парсер /etc/kafedra-planner/kafedra-planner.env для установщика.
# Конфигурация трактуется как данные: никаких source/eval и shell expansion.

kafedra_trim_environment_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

kafedra_decode_double_quoted_value() {
  local input="$1" output="" char next
  local i=0 length=${#input}
  while ((i < length)); do
    char="${input:i:1}"
    if [[ "$char" == '\\' && $((i + 1)) -lt $length ]]; then
      next="${input:i+1:1}"
      case "$next" in
        '"'|'\\'|'$'|'`') output+="$next"; ((i += 2)); continue ;;
        *) output+="\\$next"; ((i += 2)); continue ;;
      esac
    fi
    output+="$char"
    ((i += 1))
  done
  printf '%s' "$output"
}

kafedra_parse_environment_value() {
  local value
  value="$(kafedra_trim_environment_value "$1")"
  if [[ "$value" == "'"* ]]; then
    [[ ${#value} -ge 2 && "${value: -1}" == "'" ]] || { printf 'Незакрытая одинарная кавычка в EnvironmentFile\n' >&2; return 2; }
    printf '%s' "${value:1:${#value}-2}"
    return 0
  fi
  if [[ "$value" == '"'* ]]; then
    [[ ${#value} -ge 2 && "${value: -1}" == '"' ]] || { printf 'Незакрытая двойная кавычка в EnvironmentFile\n' >&2; return 2; }
    kafedra_decode_double_quoted_value "${value:1:${#value}-2}"
    return 0
  fi
  # В штатном файле используется простой KEY=value. Символы $, `, ;, # и ()
  # внутри значения сохраняются буквально и никогда не интерпретируются shell.
  printf '%s' "$value"
}

kafedra_read_environment_file() {
  local file="$1" line normalized name raw value line_number=0
  [[ -f "$file" ]] || { printf 'Файл конфигурации не найден: %s\n' "$file" >&2; return 2; }
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    ((line_number += 1))
    line="${line%$'\r'}"
    normalized="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$normalized" || "$normalized" == \#* || "$normalized" == \;* ]] && continue
    if [[ ! "$normalized" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      printf 'Некорректная строка %s в %s: ожидается KAFEDRA_*=value\n' "$line_number" "$file" >&2
      return 2
    fi
    name="${BASH_REMATCH[1]}"; raw="${BASH_REMATCH[2]}"
    [[ "$name" == KAFEDRA_* ]] || { printf 'Неподдерживаемая переменная %s в %s:%s; разрешены только KAFEDRA_*\n' "$name" "$file" "$line_number" >&2; return 2; }
    [[ -z "${seen[$name]+x}" ]] || { printf 'Переменная %s повторяется в %s\n' "$name" "$file" >&2; return 2; }
    seen[$name]=1
    value="$(kafedra_parse_environment_value "$raw")" || return
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { printf 'Многострочные значения не поддерживаются: %s\n' "$name" >&2; return 2; }
    printf -v "$name" '%s' "$value"
    export "$name"
  done < "$file"
}
