#!/usr/bin/env bash
# Standalone diagnostic: bash + Python 3 standard library; no application/database writes.
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Нужен Python 3 со стандартной библиотекой. Установка pip/npm-пакетов не требуется.' >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 - "$SCRIPT_DIR" "$@" <<'PY'
import json
import math
import os
from pathlib import Path
import re
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 65536
SCHEMA_KEYS = {'type', 'additionalProperties', 'required', 'properties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'enum'}
SCHEMA_TYPES = {'object', 'array', 'string', 'null', 'boolean', 'number', 'integer'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def loads(text):
    def invalid_constant(value):
        raise ValueError('Недопустимая JSON-константа: ' + value)
    return json.loads(text, parse_constant=invalid_constant)


def check_schema(schema):
    require(isinstance(schema, dict), 'Schema должна быть объектом')
    require(not set(schema) - SCHEMA_KEYS, 'Неподдерживаемое свойство schema: ' + ', '.join(sorted(set(schema) - SCHEMA_KEYS)))
    types = schema.get('type')
    types = types if isinstance(types, list) else [types]
    require(bool(types) and all(kind in SCHEMA_TYPES for kind in types), 'Неподдерживаемый type в schema')
    if 'additionalProperties' in schema:
        require(isinstance(schema['additionalProperties'], bool), 'Поддерживается только boolean additionalProperties')
    for child in schema.get('properties', {}).values():
        check_schema(child)
    if 'items' in schema:
        check_schema(schema['items'])


def validate_schema(value, schema, path='$'):
    types = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
    checks = {'object': isinstance(value, dict), 'array': isinstance(value, list), 'string': isinstance(value, str),
              'null': value is None, 'boolean': isinstance(value, bool),
              'number': type(value) in (int, float) and math.isfinite(value), 'integer': type(value) is int}
    require(any(checks[kind] for kind in types), path + ': неверный тип')
    if 'enum' in schema:
        require(value in schema['enum'], path + ': значение вне enum')
    if isinstance(value, dict):
        properties = schema.get('properties', {})
        require(all(key in value for key in schema.get('required', [])), path + ': отсутствует обязательное поле')
        if schema.get('additionalProperties') is False:
            require(not set(value) - set(properties), path + ': неизвестное поле')
        for key, child in value.items():
            if key in properties:
                validate_schema(child, properties[key], path + '.' + key)
    elif isinstance(value, list):
        require(schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', math.inf), path + ': неверная длина массива')
        if 'items' in schema:
            for index, child in enumerate(value):
                validate_schema(child, schema['items'], path + '[' + str(index) + ']')
    elif isinstance(value, str):
        require(schema.get('minLength', 0) <= len(value) <= schema.get('maxLength', math.inf), path + ': неверная длина строки')


def normalized(value):
    return ' '.join(value.split())


def quoted(source, value):
    return isinstance(value, str) and bool(normalized(value)) and normalized(value) in normalized(source)


def validate_plan_sample(agent, result):
    # These are bounded diagnostics for catalogue samples, not the application's domain validator.
    if agent['id'] == 'plan-extract-v1':
        rows = {row['sourceRowKey']: row['text'] for row in agent['sampleInput']['rows']}
        require(bool(result['items']), 'Модель не извлекла мероприятие из диагностического примера')
        for item in result['items']:
            require(item['sourceRowKey'] in rows, 'Неизвестный sourceRowKey')
            source = rows[item['sourceRowKey']]
            require(quoted(source, item['sourceQuote']) and quoted(item['sourceQuote'], item['title']), 'Неподтверждённые title/sourceQuote')
            for field in ('dateRaw', 'deadlineRaw', 'responsibleRaw', 'expectedResult'):
                require(item[field] is None or quoted(source, item[field]), 'Неподтверждённое поле: ' + field)
    elif agent['id'] == 'plan-department-selection-v1':
        candidates = {item['planItemId']: item for item in agent['sampleInput']['candidates']}
        fields = {field['key']: field for field in agent['sampleInput']['fields']}
        require(bool(result['items']), 'Модель не вернула подбор для диагностического примера')
        seen = set()
        for item in result['items']:
            identifier = item['planItemId']
            require(identifier in candidates and identifier not in seen, 'Неизвестный или повторный planItemId')
            seen.add(identifier)
            candidate = candidates[identifier]
            segments = {segment['id']: segment['text'] for segment in candidate['segments']}
            require(item['segmentId'] in segments and quoted(segments[item['segmentId']], item['quote']), 'Неподтверждённое основание подбора')
            used = set()
            for proposal in item['fields']:
                key, segment = proposal['key'], proposal['segmentId']
                require(key in fields and key not in used, 'Неизвестное или повторное дополнительное поле')
                used.add(key)
                require(segment in segments and not segment.startswith('plan:'), 'Недопустимый источник поля')
                require(quoted(segments[segment], proposal['quote']) and quoted(proposal['quote'], proposal['value']), 'Неподтверждённое значение поля')
                field = fields[key]
                known = candidate['known']
                require(not (field['source'] == 'location' and known.get('location')), 'Попытка заменить сохранённое место')
                require(not (field['source'] == 'custom' and key in known.get('customValues', {})), 'Попытка заменить сохранённое поле')
                if field['type'] == 'select':
                    require(proposal['value'] in field.get('options', []), 'Значение поля вне доступных вариантов')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, 'Redirect запрещён', headers, fp)


def endpoint_url(endpoint, path):
    parsed = urllib.parse.urlsplit(endpoint.strip())
    require(parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment, 'Некорректный endpoint')
    root = endpoint.strip().rstrip('/')
    if root.endswith('/v1'):
        root = root[:-3]
    return root + path


def post(endpoint, path, payload, key, deadline):
    remaining = deadline - time.monotonic()
    require(remaining > 0, 'Истёк срок запроса')
    headers = {'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    request = urllib.request.Request(endpoint_url(endpoint, path), data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.build_opener(NoRedirect).open(request, timeout=remaining) as response:
        require(response.status == 200, 'Ожидался HTTP 200')
        body = response.read(MAX_BYTES + 1)
    require(len(body) <= MAX_BYTES, 'Ответ превышает 65536 байт')
    return loads(body.decode('utf-8'))


def timeout_handler(signum, frame):
    raise TimeoutError('Истёк общий срок запроса')


def probe(agent, catalogue, timeout):
    request = agent['request']
    require(request['method'] == 'POST' and request['path'] == '/v1/chat/completions', 'Неподдерживаемый маршрут задачи')
    schema = agent.get('responseSchema')
    if schema is not None:
        check_schema(schema)
        require(request['options'].get('response_format', {}).get('schema') == schema, 'Schema запроса и ответа расходятся')
    payload = dict(request['options'])
    payload['model'] = os.environ.get('LLM_MODEL') or catalogue['defaultModelAlias']
    payload['messages'] = [{'role': 'system', 'content': agent['systemPrompt']},
                           {'role': 'user', 'content': json.dumps(agent['sampleInput'], ensure_ascii=False)}]
    endpoint = os.environ.get('LLM_ENDPOINT') or catalogue['targetServer']
    started = time.monotonic()
    deadline = started + timeout
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        try:
            response = post(endpoint, request['path'], payload, os.environ.get('LLM_API_KEY', ''), deadline)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            if status not in (400, 422) or 'response_format' not in payload:
                raise ValueError('HTTP ' + str(status)) from None
            del payload['response_format']
            print(agent['id'] + ': одна совместимая попытка без response_format')
            response = post(endpoint, request['path'], payload, os.environ.get('LLM_API_KEY', ''), deadline)
        choice = response['choices'][0]
        message = choice['message']
        require(choice.get('finish_reason') == 'stop', 'Ответ не завершён обычным stop')
        require(not message.get('tool_calls') and not message.get('function_call') and not message.get('refusal'), 'Вызовы инструментов и refusal не принимаются')
        content = message.get('content')
        require(isinstance(content, str) and content.strip(), 'Пустой content')
        content = content.strip()
        fence = re.fullmatch(r'```(?:json)?\s*([\s\S]*?)\s*```', content, flags=re.IGNORECASE)
        result = loads(fence.group(1) if fence else content)
        require(isinstance(result, (dict, list)), 'Ответ должен быть JSON-объектом или массивом')
        if schema is not None:
            validate_schema(result, schema)
        validate_plan_sample(agent, result)
        print(agent['id'] + ': PASS — запрос и контракт ответа, ' + str(round((time.monotonic() - started) * 1000)) + ' мс')
        print(json.dumps(result, ensure_ascii=False))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def embeddings(timeout):
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        response = post(os.environ.get('EMBED_ENDPOINT', 'http://127.0.0.1:8082'), '/v1/embeddings',
                        {'model': os.environ.get('EMBED_MODEL', 'bge-m3'), 'input': ['Семинар кафедры метеорологии.']},
                        os.environ.get('EMBED_API_KEY', ''), time.monotonic() + timeout)
        vector = response['data'][0]['embedding']
        require(isinstance(vector, list) and bool(vector) and all(type(value) in (int, float) and math.isfinite(value) for value in vector), 'Неверный embedding')
        print('embeddings: PASS — получен числовой вектор, размерность ' + str(len(vector)))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def main():
    args = sys.argv[2:]
    require(len(args) <= 1, 'Допустим один аргумент: task id, --list, --all, --embeddings или --help')
    action = args[0] if args else '--list'
    if action in ('-h', '--help'):
        print('Использование: test-remote-agents.sh [TASK_ID | --list | --all | --embeddings]')
        print('Без аргументов: список задач, без HTTP. Требуются bash и Python 3 stdlib.')
        print('LLM_ENDPOINT, LLM_MODEL, LLM_API_KEY, LLM_TIMEOUT (секунды, 45 по умолчанию), AGENTS_FILE.')
        print('Эмбеддинги: EMBED_ENDPOINT, EMBED_MODEL, EMBED_API_KEY. --all проверяет только задачи chat completions.')
        print('PASS означает проверку запроса/ответа на искусственном примере; это не оценка качества на документах кафедры.')
        return 0
    timeout = float(os.environ.get('LLM_TIMEOUT', '45'))
    require(math.isfinite(timeout) and 0 < timeout <= 300, 'LLM_TIMEOUT должен быть > 0 и <= 300 секунд')
    signal.signal(signal.SIGALRM, timeout_handler)
    if action == '--embeddings':
        embeddings(timeout)
        return 0
    explicit = os.environ.get('AGENTS_FILE')
    paths = [Path(explicit)] if explicit else [Path(sys.argv[1]) / 'department-agents.json',
              Path(sys.argv[1]).parent / 'packages/ai/department-agents.json', Path('/etc/local-llm/agents/department-agents.json')]
    path = next((candidate for candidate in paths if candidate.is_file()), None)
    require(path is not None, 'Не найден department-agents.json; задайте AGENTS_FILE')
    catalogue = loads(path.read_text(encoding='utf-8'))
    require(catalogue.get('schema') == 'kafedra-agents-v1', 'Неподдерживаемая версия каталога')
    agents = catalogue['agents']
    require(isinstance(agents, list) and agents and len({agent['id'] for agent in agents}) == len(agents), 'Некорректные id каталога')
    if action == '--list':
        for agent in agents:
            print(agent['id'] + '\t' + agent['name'])
        return 0
    selected = agents if action == '--all' else [agent for agent in agents if agent['id'] == action]
    require(bool(selected), 'Неизвестная задача: ' + action)
    failures = 0
    for agent in selected:
        try:
            probe(agent, catalogue, timeout)
        except Exception as error:
            failures += 1
            print(agent['id'] + ': FAIL — ' + str(error), file=sys.stderr)
    return 1 if failures else 0


try:
    sys.exit(main())
except Exception as error:
    print('FAIL — ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
