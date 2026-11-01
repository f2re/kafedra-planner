#!/usr/bin/env bash
# ==============================================================================
# Сборщик патч-бандла для удалённого LLM-сервера (local-llm-offline)
# Упаковывает актуальные агенты, системные оптимизации и скрипты применения
# ==============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTEGRATION_DIR="/home/YaremenkoIA/Загрузки/local-llm-offline/integration"
LLM_DIST_DIR="/home/YaremenkoIA/Загрузки/local-llm-offline/dist"
KAFEDRA_RELEASE_DIR="$ROOT/release"

DATE_TAG="$(date +%Y%m%d)"
ARCHIVE_NAME="local-llm-patch-kafedra-agents-$DATE_TAG.tar.gz"
WORK_DIR="$(mktemp -d)"
PACKAGE_DIR="$WORK_DIR/local-llm-patch-kafedra-agents"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "▶ 1. Актуализация манифеста агентов из кода Кафедры..."
node "$ROOT/scripts/export-agent-prompts.mjs"

echo "▶ 2. Подготовка каталога патч-бандла..."
mkdir -p "$PACKAGE_DIR/profiles"

# Копирование обязательных файлов интеграции
cp -a "$INTEGRATION_DIR/apply-patch.sh" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/optimize-system.sh" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/test-remote-agents.sh" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/department-agents.json" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/project-contracts.json" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/kafedra-planner.env" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/AGENTS_GUIDE.md" "$PACKAGE_DIR/"
cp -a "$INTEGRATION_DIR/profiles/." "$PACKAGE_DIR/profiles/"
[[ -f "$INTEGRATION_DIR/install-models.sh" ]] && cp -a "$INTEGRATION_DIR/install-models.sh" "$PACKAGE_DIR/"
[[ -f "$INTEGRATION_DIR/run-embeddings.sh" ]] && cp -a "$INTEGRATION_DIR/run-embeddings.sh" "$PACKAGE_DIR/"
[[ -f "$INTEGRATION_DIR/local-llm-embeddings.service.example" ]] && cp -a "$INTEGRATION_DIR/local-llm-embeddings.service.example" "$PACKAGE_DIR/"

# Включение моделей в состав бандла
MODELS_DIR="/home/YaremenkoIA/Загрузки/local-llm-offline/models"
if [[ -d "$MODELS_DIR" ]]; then
  echo "▶ 2.1. Включение моделей в состав бандла ($MODELS_DIR)..."
  mkdir -p "$PACKAGE_DIR/models"
  cp -a "$MODELS_DIR"/* "$PACKAGE_DIR/models/"
  echo "Включенные модели:"
  find "$PACKAGE_DIR/models" -name "*.gguf" -exec ls -lh {} +
fi

# Создание краткой памятки README.txt
cat > "$PACKAGE_DIR/README.txt" << 'EOF'
==============================================================================
КОМПЛЕКСНЫЙ ПАТЧ-БАНДЛ ИИ-АГЕНТОВ И МОДЕЛЕЙ ДЛЯ LOCAL-LLM СЕРВЕРА
==============================================================================
Комплект для обновления сервера llama.cpp, установки моделей BGE-M3 и Qwen
и полной интеграции с Кафедра-планером.

В состав бандла включены:
 • Модель BGE-M3 (418 МБ) для нечеткого/векторного RAG-поиска
 • Модель Qwen 2.5 0.5B (469 МБ) для высокоскоростной генерации
 • Манифест всех 11 специализированных агентов кафедры
 • Служба векторизации local-llm-embeddings.service (порт 8082)
 • Оптимизации CPU, памяти и сетевого доступа для llama-server (порт 8081)

Установка в 1 команду:
  sudo ./apply-patch.sh

Скрипт автоматически:
 1. Установит скачанные модели в /opt/local-llm/current/models/;
 2. Доставит манифест 11 агентов кафедры в /etc/local-llm/agents/;
 3. Разместит профили мини-моделей в /etc/local-llm/profiles/;
 4. Настроит и запустит службу векторных эмбеддингов на порту 8082;
 5. Оптимизирует потоки CPU (/etc/local-llm/server.json) под число ядер;
 6. Разрешит доступ по локальной сети для узлов кафедры (host 0.0.0.0);
 7. Применит настройки ядра Linux (CPU governor 'performance', THP, limits);
 8. Перезапустит службы и выполнит комплексный самотест.

Опционально:
  sudo ./apply-patch.sh --profile cpu-0.5b-fast      # принудительно переключить LLM на 0.5B
  sudo ./apply-patch.sh --profile cpu-1.5b-fast      # переключить LLM на 1.5B

Тестирование служб:
  test-kafedra-agents --list
  test-kafedra-agents protocol-analysis
  test-kafedra-agents --embeddings
  test-kafedra-agents --all

Подробности: AGENTS_GUIDE.md
==============================================================================
EOF

chmod +x "$PACKAGE_DIR/apply-patch.sh" "$PACKAGE_DIR/optimize-system.sh" "$PACKAGE_DIR/test-remote-agents.sh"
[[ -f "$PACKAGE_DIR/install-models.sh" ]] && chmod +x "$PACKAGE_DIR/install-models.sh"
[[ -f "$PACKAGE_DIR/run-embeddings.sh" ]] && chmod +x "$PACKAGE_DIR/run-embeddings.sh"

echo "▶ 3. Создание tar.gz архива патча..."
mkdir -p "$KAFEDRA_RELEASE_DIR"

TAR_OPTS=(--owner=0 --group=0 --numeric-owner --sort=name)
tar "${TAR_OPTS[@]}" -C "$WORK_DIR" -czf "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME" "local-llm-patch-kafedra-agents"

# Генерация SHA-256
(cd "$KAFEDRA_RELEASE_DIR" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256")

# Размещение в integration каталоге local-llm-offline
cp -a "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME" "$INTEGRATION_DIR/"
cp -a "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME.sha256" "$INTEGRATION_DIR/"

# Размещение в dist каталоге local-llm-offline (если доступен на запись)
if [[ -w "$LLM_DIST_DIR" ]]; then
  cp -a "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME" "$LLM_DIST_DIR/"
  cp -a "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME.sha256" "$LLM_DIST_DIR/"
fi

ARCHIVE_SIZE=$(du -h "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME" | awk '{print $1}')
SHA256_HASH=$(awk '{print $1}' "$KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME.sha256")

echo "=============================================================================="
echo "✓ Патч-бандл успешно собран!"
echo "Файл:         $ARCHIVE_NAME"
echo "Размер:       $ARCHIVE_SIZE"
echo "SHA-256:      $SHA256_HASH"
echo "Размещение 1: $KAFEDRA_RELEASE_DIR/$ARCHIVE_NAME"
echo "Размещение 2: $INTEGRATION_DIR/$ARCHIVE_NAME"
if [[ -w "$LLM_DIST_DIR" ]]; then
  echo "Размещение 3: $LLM_DIST_DIR/$ARCHIVE_NAME"
fi
echo "=============================================================================="
