#!/usr/bin/env node
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ASSISTANT_TASKS } from '../packages/ai/src/assistant-tasks.mjs';

const AGENT_METADATA = {
  'table-extract': {
    name: 'Аналитик табличных данных',
    description: 'Извлечение поручений, публикаций, персон и учебной нагрузки в структурированную таблицу.',
    sampleQuery: 'Поручить доценту Сидорову подготовить методические указания к 25 ноября.'
  },
  'protocol-analysis': {
    name: 'Аналитик протоколов кафедры',
    description: 'Детальный разбор протокола («Слушали / Постановили»), выделение повестки, решений, исполнителей и сроков.',
    sampleQuery: 'ПРОТОКОЛ № 3 заседания кафедры от 15.10.2026. СЛУШАЛИ: о готовности к сессии. ПОСТАНОВИЛИ: провести контрольные срезы до 15.11.2026, отв. доц. Петров.'
  },
  'report-synthesis': {
    name: 'Методист синтеза кафедральных отчётов',
    description: 'Составление официальных разделов отчёта (НИР, УМР, кадры, сессия) с обязательной привязкой к протоколам.',
    sampleQuery: 'Подготовить раздел отчёта по научно-исследовательской работе за осенний семестр 2026 года.'
  },
  'archive-query': {
    name: 'Архивариус протоколов кафедры',
    description: 'Семантический поиск по архиву заседаний и протоколов с точной верификацией цитат.',
    sampleQuery: 'На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?'
  },
  'search-refine': {
    name: 'Агент поисковой декомпозиции и синонимов',
    description: 'Преобразование естественного вопроса в интент, ключевые леммы, синонимы и очищенный FTS5-запрос.',
    sampleQuery: 'На каком заседании обсуждалась статья о влажности?'
  },
  'gap-repair': {
    name: 'Аналитик пропусков и ошибок документов',
    description: 'Выявление пропущенных обязательных реквизитов и формирование связного исправленного текста.',
    sampleQuery: 'Заседание кафедры. Повестка: 1. О подготовке к сессии. Постановили: закончить приём задолженностей.'
  },
  'compliance-check': {
    name: 'Доброжелательный советник по оформлению',
    description: 'Ненавязчивые подсказки по кворуму, срокам и формулировкам с возможностью одобрения в один клик.',
    sampleQuery: 'Протокол кафедры. Постановили: активизировать научную деятельность и сдать отчёты как можно скорее.'
  },
  'field-extract': {
    name: 'Быстрый экстрактор реквизитов',
    description: 'Точечное извлечение даты заседания, номера протокола, председателя или повестки.',
    sampleQuery: 'Протокол заседания кафедры от 15 октября 2026 года № 4.'
  },
  'formula-calc': {
    name: 'Эксперт по формулам Calc / Excel',
    description: 'Составление формул ВПР, СУММЕСЛИМН, СЧЁТЕСЛИМН для учебных планов и ведомостей кафедры.',
    sampleQuery: 'Как написать формулу ВПР для подтягивания должности по ФИО?'
  }
};

const agentsManifest = {
  schema: 'kafedra-agents-v1',
  generatedAt: new Date().toISOString(),
  targetServer: 'http://llm.52kaf.vka:8081',
  defaultModelAlias: 'department-assistant',
  description: 'Манифест специализированных агентов кафедры для OpenAI-совместимого llama-server (local-llm-offline)',
  agents: Object.entries(ASSISTANT_TASKS).map(([id, task]) => {
    const meta = AGENT_METADATA[id] || { name: id, description: id, sampleQuery: '' };
    return {
      id,
      name: meta.name,
      description: meta.description,
      maxTokens: task.maxTokens,
      systemPrompt: task.system,
      sampleInput: {
        task: id,
        text: meta.sampleQuery,
        query: meta.sampleQuery
      },
      curlExample: `curl -s -X POST "http://llm.52kaf.vka:8081/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"department-assistant","temperature":0.1,"max_tokens":${task.maxTokens},"messages":[{"role":"system","content":${JSON.stringify(task.system)}},{"role":"user","content":${JSON.stringify(JSON.stringify({ task: id, text: meta.sampleQuery, query: meta.sampleQuery }))}}]}'`
    };
  })
};

const jsonStr = JSON.stringify(agentsManifest, null, 2) + '\n';

// 1. Write in kafedra-planner
const localPath = resolve('packages/ai/department-agents.json');
writeFileSync(localPath, jsonStr, 'utf8');
console.log(`✓ Записан локальный манифест агентов: ${localPath}`);

// 2. Write in local-llm-offline if present
const remoteLLMOfflineDir = '/home/YaremenkoIA/Загрузки/local-llm-offline';
if (existsSync(remoteLLMOfflineDir)) {
  const destDir = join(remoteLLMOfflineDir, 'integration');
  const destFile = join(destDir, 'department-agents.json');
  writeFileSync(destFile, jsonStr, 'utf8');
  console.log(`✓ Синхронизирован манифест в local-llm-offline: ${destFile}`);

  // Also create a ready-to-run shell utility for testing agents on the remote server
  const testScriptPath = join(destDir, 'test-remote-agents.sh');
  const testScriptContent = `#!/usr/bin/env bash
# Утилита тестирования агентов кафедры на сервере llama-server
set -euo pipefail

ENDPOINT="\${LLM_ENDPOINT:-http://127.0.0.1:8081}"
MODEL="\${LLM_MODEL:-department-assistant}"
AGENTS_FILE="\$(dirname "\$0")/department-agents.json"

if [ ! -f "\$AGENTS_FILE" ]; then
  echo "Ошибка: файл \$AGENTS_FILE не найден." >&2
  exit 1
fi

AGENT_ID="\${1:-protocol-analysis}"

echo "=========================================================="
echo "Тестирование агента кафедры: \$AGENT_ID"
echo "Сервер: \$ENDPOINT"
echo "Модель: \$MODEL"
echo "=========================================================="

# Извлекаем системный промпт и тестовый запрос
SYSTEM_PROMPT=\$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('\$AGENTS_FILE', 'utf8'));
const ag = data.agents.find(a => a.id === '\$AGENT_ID');
if (!ag) { console.error('Агент не найден: \$AGENT_ID'); process.exit(1); }
process.stdout.write(ag.systemPrompt);
")

USER_CONTENT=\$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('\$AGENTS_FILE', 'utf8'));
const ag = data.agents.find(a => a.id === '\$AGENT_ID');
process.stdout.write(JSON.stringify(ag.sampleInput));
")

echo "Отправка запроса в llama-server..."
START_TIME=\$(date +%s%N)
RESPONSE=\$(curl -s -w "\\nHTTP_STATUS:%{http_code}" -X POST "\$ENDPOINT/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d "\$(node -e "
    const body = {
      model: '\$MODEL',
      temperature: 0.1,
      max_tokens: 1536,
      messages: [
        { role: 'system', content: process.argv[1] },
        { role: 'user', content: process.argv[2] }
      ]
    };
    process.stdout.write(JSON.stringify(body));
  " "\$SYSTEM_PROMPT" "\$USER_CONTENT")")
END_TIME=\$(date +%s%N)

DURATION_MS=\$(( (END_TIME - START_TIME) / 1000000 ))
HTTP_CODE=\$(echo "\$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=\$(echo "\$RESPONSE" | sed '/HTTP_STATUS:/d')

echo "Время ответа: \${DURATION_MS} мс (HTTP \$HTTP_CODE)"

if [ "\$HTTP_CODE" != "200" ]; then
  echo "✗ Ошибка вызова llama-server:"
  echo "\$BODY"
  exit 1
fi

echo "✓ Ответ модели получен:"
node -e "
try {
  const json = JSON.parse(process.argv[1]);
  const content = json.choices[0].message.content;
  console.log('Сгенерированный JSON:');
  console.log(content);
} catch (e) {
  console.log(process.argv[1]);
}
" "\$BODY"
`;

  writeFileSync(testScriptPath, testScriptContent, { mode: 0o755 });
  console.log(`✓ Создана утилита удалённого тестирования: ${testScriptPath}`);

  // Create complete AGENTS_GUIDE.md in local-llm-offline
  const guidePath = join(destDir, 'AGENTS_GUIDE.md');
  const guideContent = `# Руководство: Агенты Кафедры на удалённом LLM-сервере

## 1. Архитектурный принцип: как агенты попадают на сервер модели

В архитектуре локального ИИ Кафедра-планера сервер модели (\`llama-server\` из \`local-llm-offline\`) является **вычислительным движком (stateless inference)**:
- Модель (\`Qwen2.5-7B\` / \`Qwen3-4B\`) не переобучается и не содержит захардкоженных кафедренных скриптов.
- **Агенты живут на узле Кафедры** (\`packages/ai/src/assistant-tasks.mjs\`).
- При каждом действии оператора Кафедра динамически передаёт роль и системную инструкцию агента в поле \`messages[0] (role: "system")\` стандартного запроса OpenAI API \`/v1/chat/completions\`.
- База данных протоколов (SQLite) и поиск цитат также выполняются на узле Кафедры, а в модель передаются только проверенные факты.

## 2. Список доступных агентов Кафедры

Манифест всех агентов с точными формулировками промптов экспортирован в файл:
[\`department-agents.json\`](./department-agents.json).

| Идентификатор | Роль агента | Назначение |
|---|---|---|
| \`search-refine\` | Агент семантического поиска | Разбор вопросов, интент, лемматизация и генерация FTS5-запросов |
| \`protocol-analysis\` | Аналитик протоколов кафедры | Разбор «Слушали / Постановили», фиксация повестки, поручений и сроков |
| \`report-synthesis\` | Методист отчётов кафедры | Синтез разделов отчёта (НИР, УМР, кадры) со ссылками на протоколы |
| \`compliance-check\` | Советник по оформлению | Доброжелательные подсказки к тексту и варианты улучшений в 1 клик |
| \`table-extract\` | Аналитик таблиц | Извлечение списков статей, поручений и нагрузки в таблицы Calc/Excel |
| \`gap-repair\` | Аналитик пропусков | Выявление отсутствующих дат и реквизитов, сквозное исправление |
| \`field-extract\` | Экстрактор реквизитов | Быстрое точечное извлечение даты, номера протокола, председателя |
| \`formula-calc\` | Эксперт формул | Составление формул ВПР, СУММЕСЛИМН для LibreOffice Calc и Excel |
| \`archive-query\` | Архивариус протоколов | RAG-сопоставление вопросов с архивом заседаний кафедры |

## 3. Настройка llama-server для максимальной скорости

На сервере модели (\`llm.52kaf.vka\`) в файле \`/etc/local-llm/server.json\`:

\`\`\`json
{
  "schema": 1,
  "root": "/opt/local-llm/current",
  "model": "qwen2.5-7b-instruct",
  "alias": "department-assistant",
  "host": "0.0.0.0",
  "port": 8081,
  "threads": 22,
  "threads_batch": 22,
  "context_per_slot": 8192,
  "parallel": 2,
  "cpu": "auto",
  "allow_unauthenticated_lan": true
}
\`\`\`

После правки примените настройки:
\`\`\`bash
sudo systemctl restart local-llm.service
\`\`\`

## 4. Тестирование любого агента с сервера модели

В каталоге \`integration/\` запустите проверочный скрипт:

\`\`\`bash
# Проверка агента разбора протоколов:
./integration/test-remote-agents.sh protocol-analysis

# Проверка советника по оформлению:
./integration/test-remote-agents.sh compliance-check

# Проверка агента синтеза отчёта:
./integration/test-remote-agents.sh report-synthesis
\`\`\`
`;
  writeFileSync(guidePath, guideContent, 'utf8');
  console.log(`✓ Создано руководство администратора: ${guidePath}`);
}
