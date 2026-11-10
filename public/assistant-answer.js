// Presentation only. Sources and permissions are resolved by the server, never inferred from model text.
export function appendAssistantPlainAnswer(container, text) {
  const section = document.createElement('section');
  section.className = 'assistant-plain-answer';
  const warning = document.createElement('p');
  warning.className = 'helper';
  warning.textContent = 'Модель вернула текст вместо структуры выбранной задачи. Проверьте сведения перед использованием.';
  section.append(warning);
  let list = null;
  let code = null;
  let inCode = false;
  for (const line of String(text || '').slice(0, 100_000).replace(/\r\n?/gu, '\n').split('\n').slice(0, 400)) {
    if (/^\s*```/u.test(line)) {
      inCode = !inCode;
      if (inCode) {
        code = document.createElement('pre');
        section.append(code);
      }
      list = null;
      continue;
    }
    if (inCode) {
      if (code) code.textContent += line + '\n';
      continue;
    }
    if (!line.trim()) { list = null; continue; }
    const heading = /^(#{1,4})\s+(.+)$/u.exec(line);
    if (heading) {
      const el = document.createElement(heading[1].length < 3 ? 'h3' : 'h4');
      el.textContent = heading[2];
      section.append(el);
      list = null;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    if (bullet || numbered) {
      const listTag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== listTag) {
        list = document.createElement(listTag);
        section.append(list);
      }
      const item = document.createElement('li');
      item.textContent = bullet ? bullet[1] : numbered[1];
      list.append(item);
      continue;
    }
    list = null;
    const block = document.createElement(line.startsWith('> ') ? 'blockquote' : 'p');
    block.textContent = line.startsWith('> ') ? line.slice(2) : line;
    section.append(block);
  }
  container.append(section);
}

export function appendAssistantSources(container, sources = [], { navigate = () => {}, error = () => {} } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  const section = document.createElement('section');
  section.className = 'assistant-source-section';
  const title = document.createElement('h3');
  title.textContent = 'Найденные материалы';
  section.append(title);
  const note = document.createElement('p');
  note.className = 'helper';
  note.textContent = 'Источники получены из архива. Не каждый вывод модели подтверждён этими материалами.';
  section.append(note);
  for (const source of sources.slice(0, 12)) {
    const card = document.createElement('article');
    card.className = 'assistant-source-item';
    const head = document.createElement('div');
    head.className = 'assistant-source-heading';
    const name = document.createElement('strong');
    name.textContent = String(source.title || 'Материал');
    const type = document.createElement('span');
    type.className = 'assistant-source-type';
    type.textContent = ['document', 'document_version'].includes(source.kind) ? 'Документ'
      : source.kind === 'meeting' ? 'Заседание' : source.kind === 'decision' ? 'Решение' : 'Материал';
    head.append(name, type);
    card.append(head);
    if (source.snippet) {
      const excerpt = document.createElement('p');
      excerpt.className = 'assistant-source-snippet';
      excerpt.textContent = String(source.snippet);
      card.append(excerpt);
    }
    const actions = document.createElement('div');
    actions.className = 'assistant-source-actions';
    const makeButton = (label, kind, id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button small-button';
      button.textContent = label;
      button.addEventListener('click', () => {
        Promise.resolve(navigate(kind, id)).catch((e) => error(e.message || 'Ошибка перехода'));
      });
      actions.append(button);
    };
    if (source.documentId) {
      makeButton('Карточка документа', 'document', source.documentId);
      const prefix = '/api/documents/' + encodeURIComponent(source.documentId) + '/content?variant=';
      const suffix = source.versionId ? '&versionId=' + encodeURIComponent(source.versionId) : '';
      const makeLink = (label, variant, download = false) => {
        const link = document.createElement('a');
        link.className = 'secondary-button small-button';
        link.href = prefix + variant + suffix + (download ? '&download=1' : '');
        if (!download) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        link.textContent = label;
        actions.append(link);
      };
      makeLink('Открыть оригинал', 'original');
      if (source.previewAvailable) makeLink('Предпросмотр', 'preview');
      makeLink('Скачать', 'original', true);
    } else if (source.kind === 'meeting' && source.id) {
      makeButton('Открыть заседание', 'meeting', source.id);
    }
    if (actions.childElementCount) card.append(actions);
    section.append(card);
  }
  container.append(section);
}
