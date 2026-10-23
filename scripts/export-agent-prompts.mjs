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
    const meta = AGENT_METADATA[id] || { name: task.role || id, description: task.role || '', sampleQuery: 'Пример запроса' };
    return {
      id,
      name: meta.name,
      role: task.role,
      description: meta.description,
      temperature: task.temperature,
      maxTokens: task.maxTokens,
      responseFormat: task.responseFormat || 'json',
      systemPrompt: task.system,
      sampleInput: {
        task: id,
        text: meta.sampleQuery,
        query: meta.sampleQuery
      },
    };
  })
};

// 1. Write local copy
const localPath = resolve(process.cwd(), 'packages/ai/department-agents.json');
writeFileSync(localPath, JSON.stringify(agentsManifest, null, 2), 'utf8');
console.log(`✓ Записан локальный манифест агентов: ${localPath}`);

// 2. Synchronize to local-llm-offline if directory exists
const destDir = resolve('/home/YaremenkoIA/Загрузки/local-llm-offline/integration');
if (existsSync(destDir)) {
  const destPath = join(destDir, 'department-agents.json');
  writeFileSync(destPath, JSON.stringify(agentsManifest, null, 2), 'utf8');
  console.log(`✓ Синхронизирован манифест в local-llm-offline: ${destPath}`);

  // Create executable test script in local-llm-offline with python3 and node support
  const testScriptPath = join(destDir, 'test-remote-agents.sh');
  const testScript = `#!/usr/bin/env bash
# ==============================================================================
# Утилита тестирования агентов кафедры на удалённом / локальном LLM-сервере
# Работает полностью автономно в Astra Linux / Debian (требует curl и python3 или node).
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ENDPOINT="\${LLM_ENDPOINT:-http://127.0.0.1:8081}"
MODEL="\${LLM_MODEL:-department-assistant}"
AGENTS_FILE="\${AGENTS_FILE:-\$SCRIPT_DIR/department-agents.json}"

if [[ ! -f "$AGENTS_FILE" ]]; then
  echo "ОШИБКА: Манифест агентов не найден: \$AGENTS_FILE" >&2
  exit 1
fi

JSON_RUNNER=""
if command -v python3 >/dev/null 2>&1; then
  JSON_RUNNER="python3"
elif command -v node >/dev/null 2>&1; then
  JSON_RUNNER="node"
else
  echo "ОШИБКА: Для работы утилиты требуется python3 или node." >&2
  exit 1
fi

list_agents() {
  echo "Доступные агенты Кафедры в манифесте:"
  if [[ "$JSON_RUNNER" == "python3" ]]; then
    python3 -c "
import json
with open('\$AGENTS_FILE', 'r', encoding='utf-8') as f:
    d = json.load(f)
for a in d.get('agents', []):
    print(f\\\"  • {a['id']:<20} - {a.get('role', '')} ({a.get('description', '')})\\\")
"
  else
    node -e "
const d = JSON.parse(require('node:fs').readFileSync('\$AGENTS_FILE', 'utf8'));
d.agents.forEach(a => console.log('  • ' + a.id.padEnd(20) + ' - ' + (a.role||'') + ' (' + (a.description||'') + ')'));
"
  fi
}

run_agent_test() {
  local agent_id="$1"
  echo "=========================================================="
  echo "Тестирование агента кафедры: \$agent_id"
  echo "Сервер:  \$ENDPOINT"
  echo "Модель:  \$MODEL"
  echo "=========================================================="

  local system_prompt=""
  local user_input=""
  local temp=0.1
  local max_tokens=1536

  if [[ "\$JSON_RUNNER" == "python3" ]]; then
    readarray -t agent_data < <(python3 -c "
import json, sys
with open('\$AGENTS_FILE', 'r', encoding='utf-8') as f:
    d = json.load(f)
agent = next((a for a in d.get('agents', []) if a['id'] == '\$agent_id'), None)
if not agent:
    print('NOT_FOUND', file=sys.stderr)
    sys.exit(2)
print(json.dumps(agent.get('systemPrompt', '')))
print(json.dumps(agent.get('sampleInput', {})))
print(agent.get('temperature', 0.1))
print(agent.get('maxTokens', 1536))
") || {
      echo "ОШИБКА: Агент '\$agent_id' не найден в \$AGENTS_FILE." >&2
      return 1
    }
    system_prompt="\${agent_data[0]}"
    user_input="\${agent_data[1]}"
    temp="\${agent_data[2]}"
    max_tokens="\${agent_data[3]}"
  else
    readarray -t agent_data < <(node -e "
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync('\$AGENTS_FILE', 'utf8'));
const agent = d.agents.find(a => a.id === '\$agent_id');
if (!agent) process.exit(2);
console.log(JSON.stringify(agent.systemPrompt || ''));
console.log(JSON.stringify(agent.sampleInput || {}));
console.log(agent.temperature || 0.1);
console.log(agent.maxTokens || 1536);
") || {
      echo "ОШИБКА: Агент '\$agent_id' не найден в \$AGENTS_FILE." >&2
      return 1
    }
    system_prompt="\${agent_data[0]}"
    user_input="\${agent_data[1]}"
    temp="\${agent_data[2]}"
    max_tokens="\${agent_data[3]}"
  fi

  local payload_file
  payload_file="$(mktemp)"
  trap 'rm -f "\$payload_file"' RETURN

  if [[ "\$JSON_RUNNER" == "python3" ]]; then
    python3 -c "
import json
prompt = json.loads('''\$system_prompt''')
uinput = json.loads('''\$user_input''')
user_text = json.dumps(uinput, ensure_ascii=False) if isinstance(uinput, (dict, list)) else str(uinput)
body = {
    'model': '\$MODEL',
    'temperature': float('\$temp'),
    'max_tokens': int('\$max_tokens'),
    'messages': [
        {'role': 'system', 'content': prompt},
        {'role': 'user', 'content': user_text}
    ]
}
with open('\$payload_file', 'w', encoding='utf-8') as out:
    json.dump(body, out, ensure_ascii=False)
"
  else
    node -e "
const fs = require('node:fs');
const prompt = JSON.parse(process.argv[1]);
const uinput = JSON.parse(process.argv[2]);
const userText = typeof uinput === 'object' ? JSON.stringify(uinput) : String(uinput);
const body = {
  model: '\$MODEL',
  temperature: parseFloat('\$temp'),
  max_tokens: parseInt('\$max_tokens', 10),
  messages: [
    { role: 'system', content: prompt },
    { role: 'user', content: userText }
  ]
};
fs.writeFileSync('\$payload_file', JSON.stringify(body), 'utf8');
" "\$system_prompt" "\$user_input"
  fi

  echo "Отправка запроса в llama-server..."
  local start_time end_time duration_ms http_code response body
  start_time=\$(date +%s%N 2>/dev/null || date +%s)
  response=\$(curl -s -S -w "\\nHTTP_STATUS:%{http_code}" -X POST "\$ENDPOINT/v1/chat/completions" \\
    -H "Content-Type: application/json; charset=utf-8" \\
    --data-binary @"\$payload_file" || true)
  end_time=\$(date +%s%N 2>/dev/null || date +%s)

  if [[ "\$start_time" =~ [0-9]{10,} ]]; then
    duration_ms=\$(( (end_time - start_time) / 1000000 ))
  else
    duration_ms="~"
  fi

  http_code=\$(echo "\$response" | grep "HTTP_STATUS:" | cut -d: -f2 || echo "000")
  body=\$(echo "\$response" | sed '/HTTP_STATUS:/d')

  echo "Время ответа: \${duration_ms} мс (HTTP \$http_code)"

  if [[ "\$http_code" != "200" ]]; then
    echo "✗ Ошибка вызова llama-server (HTTP \$http_code):" >&2
    echo "\$body" >&2
    return 1
  fi

  echo "✓ Ответ модели получен:"
  if [[ "\$JSON_RUNNER" == "python3" ]]; then
    python3 -c "
import json, sys
try:
    resp = json.loads('''\$body''')
    msg = resp['choices'][0]['message']['content']
    usage = resp.get('usage', {})
    prompt_tokens = usage.get('prompt_tokens', '?')
    comp_tokens = usage.get('completion_tokens', '?')
    print(f'Токены: вход={prompt_tokens}, выход={comp_tokens}')
    print('--- Содержимое ответа ---')
    print(msg)
except Exception as e:
    print('''\$body''')
"
  else
    node -e "
try {
  const resp = JSON.parse(process.argv[1]);
  const msg = resp.choices[0].message.content;
  const u = resp.usage || {};
  console.log('Токены: вход=' + (u.prompt_tokens||'?') + ', выход=' + (u.completion_tokens||'?'));
  console.log('--- Содержимое ответа ---');
  console.log(msg);
} catch (e) {
  console.log(process.argv[1]);
}
" "\$body"
  fi
  echo "=========================================================="
  return 0
}

case "\${1:-protocol-analysis}" in
  -h|--help)
    echo "Использование: \$0 [AGENT_ID | --list | --all]"
    echo ""
    echo "Переменные окружения:"
    echo "  LLM_ENDPOINT   URL сервера (по умолчанию: http://127.0.0.1:8081)"
    echo "  LLM_MODEL      Имя модели или alias (по умолчанию: department-assistant)"
    echo "  AGENTS_FILE    Путь к department-agents.json"
    exit 0
    ;;
  --list)
    list_agents
    exit 0
    ;;
  --all)
    echo "Запуск тестирования всех агентов..."
    agents_list=()
    if [[ "\$JSON_RUNNER" == "python3" ]]; then
      mapfile -t agents_list < <(python3 -c "
import json
with open('\$AGENTS_FILE', 'r', encoding='utf-8') as f:
    d = json.load(f)
for a in d.get('agents', []):
    print(a['id'])
")
    else
      mapfile -t agents_list < <(node -e "
const d = JSON.parse(require('node:fs').readFileSync('\$AGENTS_FILE', 'utf8'));
d.agents.forEach(a => console.log(a.id));
")
    fi

    failed=0
    for ag in "\${agents_list[@]}"; do
      if ! run_agent_test "\$ag"; then
        failed=\$((failed + 1))
      fi
    done
    if [[ \$failed -eq 0 ]]; then
      echo "✓ Все агенты успешно протестированы!"
      exit 0
    else
      echo "✗ Сбоев при тестировании: \$failed" >&2
      exit 1
    fi
    ;;
  *)
    run_agent_test "\$1"
    ;;
esac
`;
  writeFileSync(testScriptPath, testScript, { mode: 0o755 });
  console.log(`✓ Создана утилита удалённого тестирования: ${testScriptPath}`);
}
