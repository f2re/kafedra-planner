#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
OUT_DIR="${1:-$ROOT/release}"
TARGETS_DIR="$OUT_DIR/targets"
MATRIX_FILE="$OUT_DIR/.release-targets.tsv"
SOURCE_SHA="${GITHUB_SHA:-unknown}"

for command in docker find tar sha256sum cp chmod grep sed tail sort; do
  command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда release builder: $command" >&2; exit 2; }
done
mkdir -p "$OUT_DIR" "$TARGETS_DIR"
: > "$MATRIX_FILE"

normalize_series() {
  local family="$1" version="$2"
  if [[ "$family" == astra ]]; then
    [[ "$version" =~ ^1\.7 ]] && { printf '1.7'; return; }
    [[ "$version" =~ ^1\.8 ]] && { printf '1.8'; return; }
    printf '%s' "${version%%_*}"
  elif [[ "$family" == debian ]]; then
    printf '%s' "${version%%.*}"
  else
    printf '%s' "$version"
  fi
}

metadata_value() {
  local text="$1" key="$2"
  printf '%s\n' "$text" | sed -n "s/^${key}=//p" | tail -n 1
}

release_targets() {
  cat <<'TARGETS'
debian-12-amd64	debian	12	amd64	debian:12
astra-1.7-amd64	astra	1.7	amd64	registry.astralinux.ru/library/astra/ubi17:latest
astra-1.8-amd64	astra	1.8	amd64	registry.astralinux.ru/library/astra/ubi18:latest
TARGETS
}

while IFS=$'\t' read -r target expected_family expected_series expected_arch image; do
  [[ -n "$target" && -n "$image" ]] || continue
  target_out="$TARGETS_DIR/$target"
  rm -rf "$target_out"
  mkdir -p "$target_out"
  echo "=== Сборка $target из $image ==="
  docker pull "$image" >/dev/null
  docker run --rm \
    -e GITHUB_SHA="$SOURCE_SHA" \
    -v "$ROOT:/src:ro" \
    -v "$target_out:/out" \
    "$image" bash /src/scripts/offline/reference-build.sh /src /out

  mapfile -t archives < <(find "$target_out" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print | LC_ALL=C sort)
  ((${#archives[@]} == 1)) || { echo "$target: ожидался один archive, найдено ${#archives[@]}" >&2; exit 3; }
  archive="${archives[0]}"
  [[ -f "$archive.sha256" && -x "$target_out/install-kafedra-planner.sh" && -f "$target_out/README-INSTALL.txt" ]] || {
    echo "$target: full bundle комплект неполон" >&2; exit 3;
  }
  REQUIRE_ARCHIVE_SHA256=true SKIP_SYSTEM_PREFLIGHT=true bash "$ROOT/scripts/offline/verify-bundle.sh" "$archive"

  mapfile -t metadata_entries < <(tar -tzf "$archive" | grep -E '(^|/)os-packages/source-os\.env$' || true)
  ((${#metadata_entries[@]} == 1)) || { echo "$target: source-os.env отсутствует или неоднозначен" >&2; exit 3; }
  metadata="$(tar -xOzf "$archive" "${metadata_entries[0]}")"
  family="$(metadata_value "$metadata" OS_FAMILY)"
  version="$(metadata_value "$metadata" OS_VERSION_ID)"
  arch="$(metadata_value "$metadata" DEB_ARCHITECTURE)"
  closure="$(metadata_value "$metadata" DEPENDENCY_CLOSURE)"
  policy="$(metadata_value "$metadata" TARGET_INSTALL_POLICY)"
  series="$(normalize_series "$family" "$version")"
  [[ "$family" == "$expected_family" && "$series" == "$expected_series" && "$arch" == "$expected_arch" ]] || {
    echo "$target: reference profile mismatch: ${family}/${series}/${arch}" >&2; exit 3;
  }
  [[ "$closure" == full-airgap-v2 && "$policy" == additive-only-v2 ]] || {
    echo "$target: unsafe package contract: closure=$closure policy=$policy" >&2; exit 3;
  }

  archive_name="$(basename "$archive")"
  cp -f "$archive" "$OUT_DIR/$archive_name"
  cp -f "$archive.sha256" "$OUT_DIR/$archive_name.sha256"
  printf '%s\t%s\t%s\n' "$target" "$image" "$archive_name" >> "$MATRIX_FILE"
done < <(release_targets)

mapfile -t built_targets < "$MATRIX_FILE"
((${#built_targets[@]} == 3)) || { echo "Ожидались три release target, получено ${#built_targets[@]}" >&2; exit 3; }

cp "$ROOT/scripts/offline/install-from-archive.sh" "$OUT_DIR/install-kafedra-planner.sh"
chmod 0755 "$OUT_DIR/install-kafedra-planner.sh"
cat > "$OUT_DIR/README-INSTALL.txt" <<'README'
Kafedra Planner — полная автономная установка

В выпуске есть отдельные full bundle для Debian 12, Astra Linux 1.7 и Astra Linux 1.8.
Скачайте install-kafedra-planner.sh, архив для своей ОС и его .sha256 в один каталог.
Если рядом лежат несколько архивов, wrapper сам выбирает единственный совместимый по встроенному source-os.env.

Установка/обновление:
  sudo KAFEDRA_APT_MODE=bundle ./install-kafedra-planner.sh

Проверка выбора без изменений системы:
  ./install-kafedra-planner.sh --print-selection

Установщик сверяет SHA-256 и профиль ОС, ставит только отсутствующие пакеты из matching bundle,
проверяет Tesseract rus+eng, Poppler и LibreOffice до активации и сохраняет проверенный package cache для автономного repair.
README

printf 'Готовы release targets:\n'
awk -F '\t' '{printf "  %s -> %s (%s)\n", $1, $3, $2}' "$MATRIX_FILE"
