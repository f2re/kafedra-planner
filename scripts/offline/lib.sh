#!/usr/bin/env bash
set -Eeuo pipefail

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
info() { log "ИНФО  $*"; }
warn() { log "ВНИМ  $*"; }
die() { log "ОШИБКА $*"; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "Не найдена обязательная команда: $1"; }
absolute_path() {
  local target="$1"
  if [[ -d "$target" ]]; then (cd "$target" && pwd -P); else
    printf '%s/%s\n' "$(cd "$(dirname "$target")" && pwd -P)" "$(basename "$target")"
  fi
}
sha256_of() { sha256sum "$1" | awk '{print $1}'; }
read_env_value() {
  local file="$1" key="$2"
  grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}
read_os_release_value() {
  local file="${1:-/etc/os-release}" key="$2" value
  value="$(grep -E "^[[:space:]]*${key}=" "$file" | head -n 1 | cut -d= -f2- || true)"
  if [[ ${#value} -ge 2 && ("$value" == \"*\" || "$value" == \'*\') ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}
detect_os_profile() {
  local file="${1:-/etc/os-release}" id version name pretty like description family arch
  [[ -f "$file" ]] || die "Не найден $file"
  id="$(read_os_release_value "$file" ID)"
  version="$(read_os_release_value "$file" VERSION_ID)"
  name="$(read_os_release_value "$file" NAME)"
  pretty="$(read_os_release_value "$file" PRETTY_NAME)"
  like="$(read_os_release_value "$file" ID_LIKE)"
  description="${id,,} ${name,,} ${pretty,,} ${like,,}"
  if [[ "$description" == *astra* ]]; then family=astra
  elif [[ "$id" == debian || " ${like,,} " == *" debian "* ]]; then family=debian
  else family=unsupported; fi
  arch="$(dpkg --print-architecture 2>/dev/null || true)"
  printf '%s\n%s\n%s\n%s\n' "$family" "$id" "$version" "$arch"
}

# Target APT is allowed to add absent packages only. A simulation that removes
# anything or proposes another version for an already installed package is
# rejected before the first dpkg mutation.
assert_additive_apt_plan() {
  local plan_file="$1" mutation
  [[ -f "$plan_file" ]] || die "Не найден APT plan: $plan_file"
  mutation="$(grep -E '^(Remv |Inst [^ ]+ \[[^]]+\])' "$plan_file" | head -n 1 || true)"
  if [[ -n "$mutation" ]]; then
    warn "APT-план пытается изменить уже установленный пакет ОС, что запрещено: $mutation"
    return 1
  fi
  return 0
}

verify_os_package_set() (
  set -Eeuo pipefail
  local root="$1" strict_profile="${2:-0}" validation line sha package version arch filename extra
  local expected_family expected_id expected_version expected_arch requested_sha requested package_count
  for command in sha256sum find sort cmp dpkg-deb sed cut uniq; do require_command "$command"; done
  [[ -d "$root" ]] || die "Не найден каталог пакетов ОС: $root"
  for file in manifest.sha256 packages.tsv requested-packages.txt source-os.env; do
    [[ -f "$root/$file" && ! -L "$root/$file" ]] || die "Нет $file в пакете ОС"
  done
  expected_family="$(read_env_value "$root/source-os.env" OS_FAMILY)"
  expected_id="$(read_env_value "$root/source-os.env" OS_ID)"
  expected_version="$(read_env_value "$root/source-os.env" OS_VERSION_ID)"
  expected_arch="$(read_env_value "$root/source-os.env" DEB_ARCHITECTURE)"
  requested_sha="$(read_env_value "$root/source-os.env" REQUESTED_PACKAGES_SHA256)"
  [[ "$expected_family" == debian || "$expected_family" == astra ]] || die "Некорректный OS_FAMILY"
  [[ "$expected_id" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "Некорректный OS_ID"
  [[ -n "$expected_version" ]] || die "Пустой OS_VERSION_ID"
  [[ "$expected_arch" == amd64 || "$expected_arch" == arm64 ]] || die "Неподдерживаемый DEB_ARCHITECTURE: $expected_arch"
  [[ "$(read_env_value "$root/source-os.env" DEPENDENCY_CLOSURE)" == full-airgap-v2 ]] || die "Набор пакетов ОС использует устаревший dependency-closure contract; пересоберите bundle"
  [[ "$(read_env_value "$root/source-os.env" TARGET_INSTALL_POLICY)" == additive-only-v2 ]] || die "Набор пакетов ОС не подтверждает additive-only target policy"
  [[ "$(read_env_value "$root/source-os.env" REFERENCE_APT_CHECK)" == passed ]] || die "Набор пакетов ОС собран без подтверждённого apt-get check reference-системы"
  [[ "$(read_env_value "$root/source-os.env" APT_INSTALL_RECOMMENDS)" == false ]] || die "Набор должен быть собран без recommends"
  [[ "$requested_sha" =~ ^[a-f0-9]{64}$ && "$(sha256_of "$root/requested-packages.txt")" == "$requested_sha" ]] || die "Checksum requested-packages.txt не совпадает"
  if find "$root" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then die "Набор .deb содержит запрещённый объект"; fi
  if find "$root" -mindepth 2 ! -type d -print -quit | grep -q .; then die "Файлы набора должны лежать в корне"; fi
  (cd "$root" && sha256sum -c --strict --quiet manifest.sha256)
  validation="$(mktemp -d)"; trap 'rm -rf "$validation"' EXIT
  find "$root" -maxdepth 1 -type f -name '*.deb' -printf '%f\n' | LC_ALL=C sort > "$validation/actual"
  [[ -s "$validation/actual" ]] || die "В наборе пакетов ОС нет .deb"
  find "$root" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort > "$validation/all-actual"
  { printf '%s\n' manifest.sha256 packages.tsv requested-packages.txt source-os.env; cat "$validation/actual"; } | LC_ALL=C sort > "$validation/all-expected"
  cmp -s "$validation/all-actual" "$validation/all-expected" || die "Набор пакетов ОС содержит лишние файлы"
  sed -E 's/^[a-f0-9]{64}  //' "$root/manifest.sha256" | sed 's#^\./##' | LC_ALL=C sort > "$validation/manifest"
  cmp -s "$validation/actual" "$validation/manifest" || die "manifest.sha256 не совпадает с точным набором .deb"
  IFS= read -r line < "$root/packages.tsv" || true
  [[ "$line" == $'sha256\tpackage\tversion\tarchitecture\tfilename' ]] || die "Некорректный packages.tsv"
  : > "$validation/inventory"; : > "$validation/package-names"
  while IFS=$'\t' read -r sha package version arch filename extra; do
    [[ -n "$sha$package$version$arch$filename$extra" ]] || continue
    [[ -z "$extra" && "$sha" =~ ^[a-f0-9]{64}$ && "$filename" =~ ^[A-Za-z0-9][A-Za-z0-9.+:%~_-]*\.deb$ ]] || die "Некорректная строка packages.tsv"
    [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ && -n "$version" ]] || die "Некорректные metadata пакета $filename"
    [[ "$arch" == all || "$arch" == "$expected_arch" ]] || die "Чужая архитектура $filename: $arch"
    [[ -f "$root/$filename" && ! -L "$root/$filename" ]] || die "Не найден $filename"
    [[ "$(sha256_of "$root/$filename")" == "$sha" ]] || die "SHA-256 не совпадает: $filename"
    [[ "$(dpkg-deb -f "$root/$filename" Package)" == "$package" ]] || die "Package не совпадает: $filename"
    [[ "$(dpkg-deb -f "$root/$filename" Version)" == "$version" ]] || die "Version не совпадает: $filename"
    [[ "$(dpkg-deb -f "$root/$filename" Architecture)" == "$arch" ]] || die "Architecture не совпадает: $filename"
    printf '%s\n' "$filename" >> "$validation/inventory"
    printf '%s\n' "$package" >> "$validation/package-names"
  done < <(tail -n +2 "$root/packages.tsv")
  LC_ALL=C sort -o "$validation/inventory" "$validation/inventory"
  cmp -s "$validation/actual" "$validation/inventory" || die "packages.tsv не совпадает с набором .deb"
  [[ -z "$(LC_ALL=C sort "$validation/package-names" | uniq -d | head -n1)" ]] || die "Набор содержит несколько версий одного package"
  package_count="$(wc -l < "$validation/package-names")"
  ((package_count > 0)) || die "Inventory пакетов пуст"
  LC_ALL=C sort -u "$root/requested-packages.txt" > "$validation/requested"
  cmp -s "$root/requested-packages.txt" "$validation/requested" || die "requested-packages.txt должен быть отсортирован без дублей"
  while IFS= read -r requested; do
    [[ "$requested" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || die "Некорректный requested package: $requested"
    grep -Fxq "$requested" "$validation/package-names" || die "Запрошенный package отсутствует в closure: $requested"
  done < "$validation/requested"
  if ((strict_profile == 1)); then
    mapfile -t current < <(detect_os_profile /etc/os-release)
    [[ "${current[0]}" == "$expected_family" && "${current[1]}" == "$expected_id" && "${current[2]}" == "$expected_version" && "${current[3]}" == "$expected_arch" ]] || \
      die "Пакет собран для ${expected_family}/${expected_id} ${expected_version} ${expected_arch}, текущая система: ${current[*]}"
  fi
)
