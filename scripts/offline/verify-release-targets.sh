#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
OUT_DIR="${1:-$ROOT/release}"
MATRIX_FILE="$OUT_DIR/.release-targets.tsv"
[[ -f "$MATRIX_FILE" ]] || { echo "Нет release target manifest: $MATRIX_FILE" >&2; exit 2; }
for command in cmp sha256sum; do command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда: $command" >&2; exit 2; }; done

count=0
while IFS=$'\t' read -r target image archive_name; do
  [[ -n "$target" && -n "$image" && -n "$archive_name" ]] || continue
  target_dir="$OUT_DIR/targets/$target"
  [[ -f "$target_dir/$archive_name" && -f "$OUT_DIR/$archive_name" ]] || { echo "$target: archive не найден" >&2; exit 3; }
  cmp -s "$target_dir/$archive_name" "$OUT_DIR/$archive_name" || { echo "$target: root archive отличается от проверяемого artifact" >&2; exit 3; }
  (cd "$OUT_DIR" && sha256sum -c --strict "$archive_name.sha256" >/dev/null)
  echo "=== Systemd acceptance $target ($image) ==="
  KAFEDRA_SELFTEST_BASE_IMAGE="$image" bash "$ROOT/scripts/offline/systemd-deploy-selftest.sh" "$target_dir"
  count=$((count + 1))
done < "$MATRIX_FILE"
[[ "$count" -eq 3 ]] || { echo "Проверены не все release targets: $count/3" >&2; exit 3; }
echo "Все release targets прошли matching systemd acceptance."
