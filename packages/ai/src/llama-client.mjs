import { createHash } from 'node:crypto';

export function extractJsonObject(value) {
  const text = String(value || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1] || text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

export function directivePrompt(text, deterministic) {
  return [
    'Извлеки структуру российского распорядительного документа.',
    'Верни только JSON. Не выдумывай отсутствующие сведения.',
    'Каждое предложенное поле должно содержать sourceQuote — короткую цитату из входного текста.',
    'Схема: {kind, documentNumber, issuedAt, issuerRaw, title, direction, assignments:[{itemNo,title,instructionText,dueDate,executors,controller,expectedResult,sourceQuote}]}.',
    `Детерминированный результат для проверки: ${JSON.stringify(deterministic)}`,
    `Документ:\n${String(text || '').slice(0, 120000)}`
  ].join('\n\n');
}

export async function proposeDirectiveWithLlama({ config, text, deterministic }) {
  if (!config?.llmEnabled || !config.llmEndpoint) {
    return { status: 'disabled', inputSha256: createHash('sha256').update(String(text || '')).digest('hex') };
  }
  const started = Date.now();
  const endpoint = String(config.llmEndpoint).replace(/\/$/u, '');
  const inputSha256 = createHash('sha256').update(String(text || '')).digest('hex');
  try {
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.llmModel || 'local-model',
        temperature: 0,
        max_tokens: config.llmMaxTokens || 4096,
        messages: [
          { role: 'system', content: 'Ты локальный модуль извлечения. Возвращай только проверяемый JSON без пояснений.' },
          { role: 'user', content: directivePrompt(text, deterministic) }
        ]
      }),
      signal: AbortSignal.timeout(config.llmTimeoutMs || 45_000)
    });
    if (!response.ok) throw new Error(`llm_http_${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const output = extractJsonObject(content);
    if (!output) throw new Error('llm_invalid_json');
    return {
      status: 'completed',
      endpoint,
      model: payload.model || config.llmModel || null,
      inputSha256,
      output,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      status: 'failed',
      endpoint,
      model: config.llmModel || null,
      inputSha256,
      error: String(error?.message || error),
      durationMs: Date.now() - started
    };
  }
}
