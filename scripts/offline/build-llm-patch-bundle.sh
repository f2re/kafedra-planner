#!/usr/bin/env bash
# Portable prompts and diagnostics only. The historical npm command remains valid.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/release}"

usage() {
  echo "Использование: $0 [--output-dir DIR]"
  echo "Каталог промптов и диагностика LLM; по умолчанию OUT_DIR или $ROOT/release."
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

WORK_DIR="$(mktemp -d)"
OUTPUT_STAGE=""
cleanup() {
  rm -rf -- "$WORK_DIR"
  [[ -z "$OUTPUT_STAGE" ]] || rm -rf -- "$OUTPUT_STAGE"
}
trap cleanup EXIT

VERSION="$(node -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1])).version; if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid application version"); process.stdout.write(version);' "$ROOT/package.json")"
PACKAGE_NAME="kafedra-llm-catalogue-$VERSION"
ARCHIVE_NAME="$PACKAGE_NAME.tar.gz"
PACKAGE_DIR="$WORK_DIR/$PACKAGE_NAME"

node "$ROOT/scripts/export-agent-prompts.mjs" --output-dir "$PACKAGE_DIR"
node --input-type=module - "$ROOT" "$PACKAGE_DIR" <<'NODE'
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, destination] = process.argv.slice(2);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const migrations = readdirSync(join(root, 'migrations'))
  .map((name) => /^(\d+)_.*\.sql$/u.exec(name)).filter(Boolean).map((match) => Number(match[1]));
if (!migrations.length) throw new Error('Cannot determine the database schema version');
const catalogue = JSON.parse(readFileSync(join(destination, 'department-agents.json'), 'utf8'));
let sourceCommit = null, sourceDirty = null, commitTime = 0;
try {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (git('rev-parse', '--show-toplevel') !== root) throw new Error('Source export is not the Git root');
  sourceCommit = git('rev-parse', 'HEAD');
  sourceDirty = Boolean(git('status', '--porcelain', '--untracked-files=normal'));
  commitTime = Number(git('log', '-1', '--format=%ct'));
} catch {
  sourceCommit = null; sourceDirty = null;
}
const epoch = process.env.SOURCE_DATE_EPOCH ?? String(commitTime);
if (!/^\d+$/u.test(epoch) || !Number.isSafeInteger(Number(epoch))) throw new Error('Invalid SOURCE_DATE_EPOCH');
const metadata = {
  format: 'kafedra-agent-catalogue-v1', applicationVersion: version,
  schemaVersion: Math.max(...migrations), sourceCommit, sourceDirty,
  sourceDateEpoch: Number(epoch), taskCount: catalogue.agents.length,
  catalogueSha256: catalogue.catalogueSha256
};
writeFileSync(join(destination, 'bundle.json'), `${JSON.stringify(metadata, null, 2)}\n`);
NODE

cat > "$PACKAGE_DIR/README.md" <<EOF
# Каталог промптов Kafedra Planner $VERSION

Этот архив содержит каталог задач LLM, примеры запросов, схемы ответов и автономную диагностику.
Он нужен для проверки подключения модели и передачи актуального контракта администратору.
Приложение передаёт промпты в каждом запросе; установка каталога на сервер не требуется.

## Проверка и использование

Перед распаковкой проверьте архив по соседнему файлу $ARCHIVE_NAME.sha256.
После распаковки, находясь в каталоге комплекта:

~~~bash
sha256sum -c manifest.sha256
./test-remote-agents.sh --list
LLM_ENDPOINT=http://127.0.0.1:8081 LLM_MODEL=department-assistant ./test-remote-agents.sh plan-extract-v1
./test-remote-agents.sh plan-department-selection-v1
~~~

Для диагностики нужны bash и Python 3 со стандартной библиотекой. Пакеты npm/pip не нужны.
Команда --list работает без сети. Остальные проверки обращаются к указанному LLM_ENDPOINT
и используют искусственные примеры; успешная диагностика не подтверждает качество разбора реальных документов.
Параметры подключения, список задач и ограничения описаны в AGENTS_GUIDE.md.

## Состав и происхождение

- department-agents.json — системные промпты, запросы и схемы из исполняемых модулей приложения;
- test-remote-agents.sh — диагностический клиент;
- AGENTS_GUIDE.md — справочник задач и параметров;
- bundle.json — версия приложения и схемы БД, исходный Git commit, признак локальных изменений;
- manifest.sha256 — контрольные суммы всех файлов комплекта.

Модели, llama.cpp, установщики и настройки служб в архив не входят. Архив не обновляет
установленное приложение, базу данных или конфигурацию ОС и не требует sudo.
Для установки приложения используется отдельный полный автономный комплект Kafedra Planner.

sourceCommit в bundle.json обозначает базовый Git commit. При sourceDirty=true содержимое
собрано с локальными изменениями; при отсутствии Git сведения о commit равны null.
Контрольные суммы проверяют целостность, а подлинность источника подтверждается отдельно.
EOF

chmod 755 "$PACKAGE_DIR" "$PACKAGE_DIR/test-remote-agents.sh"
chmod 644 "$PACKAGE_DIR/department-agents.json" "$PACKAGE_DIR/AGENTS_GUIDE.md" "$PACKAGE_DIR/README.md" "$PACKAGE_DIR/bundle.json"
(
  cd "$PACKAGE_DIR"
  sha256sum AGENTS_GUIDE.md README.md bundle.json department-agents.json test-remote-agents.sh > manifest.sha256
)
chmod 644 "$PACKAGE_DIR/manifest.sha256"
EPOCH="$(node -e 'const fs = require("node:fs"); process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1])).sourceDateEpoch));' "$PACKAGE_DIR/bundle.json")"

mkdir -p -- "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
OUTPUT_STAGE="$(mktemp -d "$OUT_DIR/.kafedra-agent-catalogue.XXXXXX")"
tar --owner=0 --group=0 --numeric-owner --sort=name --mtime="@$EPOCH" --format=gnu \
  -C "$WORK_DIR" -cf - "$PACKAGE_NAME" | gzip -n > "$OUTPUT_STAGE/$ARCHIVE_NAME"
(
  cd "$OUTPUT_STAGE"
  sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
)
node "$ROOT/scripts/offline/verify-agent-catalogue.mjs" "$OUTPUT_STAGE/$ARCHIVE_NAME"

# Verify the complete staged result before replacing any previous output. A crash
# between the two renames fails closed at the external checksum on the next read.
mv -f -- "$OUTPUT_STAGE/$ARCHIVE_NAME" "$OUT_DIR/$ARCHIVE_NAME"
mv -f -- "$OUTPUT_STAGE/$ARCHIVE_NAME.sha256" "$OUT_DIR/$ARCHIVE_NAME.sha256"
echo "Каталог и диагностика: $OUT_DIR/$ARCHIVE_NAME"
cat "$OUT_DIR/$ARCHIVE_NAME.sha256"
