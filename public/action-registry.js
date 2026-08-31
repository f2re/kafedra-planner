export const ACTION_GROUPS = Object.freeze([
  { id: 'calendar', label: 'Календарь' },
  { id: 'documents', label: 'Документы' },
  { id: 'plans', label: 'Планы' },
  { id: 'work', label: 'Работа кафедры' },
  { id: 'meetings', label: 'Заседания' },
  { id: 'academic', label: 'Учебный процесс' },
  { id: 'science', label: 'Наука и отчёты' }
]);

export const ACTIONS = Object.freeze([
  { id: 'calendar.task', group: 'calendar', label: 'Новая задача', detail: 'Добавить задачу в календарь', terms: ['задача', 'срок', 'календарь'], order: 10 },
  { id: 'calendar.event', group: 'calendar', label: 'Новое событие', detail: 'Добавить событие или встречу', terms: ['событие', 'встреча', 'календарь'], order: 20 },
  { id: 'document.upload', group: 'documents', label: 'Загрузить документ', detail: 'Система сама определит назначение', terms: ['pdf', 'word', 'excel', 'документ', 'скан'], order: 30 },
  { id: 'template.create', group: 'documents', label: 'Шаблон извлечения', detail: 'Научить разбирать документы этого вида', terms: ['шаблон', 'распознавание', 'извлечение'], order: 40 },
  { id: 'review.open', group: 'documents', label: 'Открытые вопросы', detail: 'Исправить только неоднозначные данные', terms: ['проверка', 'ошибка', 'неоднозначность'], order: 50 },
  { id: 'plan.create', group: 'plans', label: 'Создать план', detail: 'Создать план вручную без файла', terms: ['план', 'ручной', 'год'], order: 60 },
  { id: 'plan.upload', group: 'plans', label: 'Загрузить план', detail: 'Распознать Word, Excel, PDF или ODS', terms: ['план', 'word', 'excel', 'xlsx'], order: 70 },
  { id: 'plan.item', group: 'plans', label: 'Добавить пункт плана', detail: 'Добавить мероприятие в открытый план', terms: ['пункт', 'мероприятие', 'план'], order: 80 },
  { id: 'work.periodic', group: 'work', label: 'Периодическая задача', detail: 'Создать повторяющуюся работу', terms: ['периодическая', 'повтор', 'задача'], order: 90 },
  { id: 'directive.upload', group: 'work', label: 'Загрузить распоряжение', detail: 'Извлечь номер, дату и поручения', terms: ['распоряжение', 'приказ', 'указ', 'поручение'], order: 100 },
  { id: 'meeting.create', group: 'meetings', label: 'Создать заседание', detail: 'Подготовить повестку вручную', terms: ['заседание', 'повестка', 'протокол'], order: 110 },
  { id: 'meeting.upload', group: 'meetings', label: 'Загрузить протокол', detail: 'Создать или дополнить заседание', terms: ['протокол', 'заседание', 'повестка'], order: 120 },
  { id: 'academic.import', group: 'academic', label: 'Загрузить ведомость', detail: 'Распознать оценки и открыть сводку успеваемости', terms: ['ведомость', 'оценки', 'успеваемость', 'группа', 'excel', 'xlsx', 'ods', 'csv'], order: 130 },
  { id: 'science.import', group: 'science', label: 'Импортировать научные данные', detail: 'Распознать список публикаций и работ', terms: ['наука', 'публикация', 'импорт'], order: 140 },
  { id: 'science.report', group: 'science', label: 'Сформировать отчёт', detail: 'Открыть научные и годовые отчёты', terms: ['отчёт', 'годовой', 'научный'], order: 150 }
]);

export const ACTION_IDS = Object.freeze(ACTIONS.map((action) => action.id));

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function filterActions(actions = ACTIONS, query = '') {
  const needle = normalized(query);
  if (!needle) return [...actions];
  return actions.filter((action) => normalized([
    action.label,
    action.detail,
    ...(action.terms || [])
  ].join(' ')).includes(needle));
}

function frequencyOf(frequencies, actionId) {
  if (frequencies instanceof Map) return Number(frequencies.get(actionId) || 0);
  return Number(frequencies?.[actionId] || 0);
}

function contextScore(action, context = {}) {
  if (context.explicitAction === action.id) return 1000;
  let score = 0;
  if (context.date && action.group === 'calendar') score += 300;
  const contextGroup = context.view === 'academic-performance' ? 'academic' : context.view;
  if (contextGroup && contextGroup === action.group) score += 120;
  if (context.documentType === 'plan' && action.id === 'plan.upload') score += 500;
  if (context.documentType === 'protocol' && action.id === 'meeting.upload') score += 500;
  if (context.documentType === 'directive' && action.id === 'directive.upload') score += 500;
  return score;
}

function periodScore(action, context = {}) {
  const month = Number(context.month || 0);
  if ([11, 12, 1].includes(month) && ['plan.create', 'plan.upload', 'science.report'].includes(action.id)) return 20;
  return 0;
}

export function rankActions(actions = ACTIONS, {
  query = '',
  context = {},
  frequencies = {},
  available = () => true
} = {}) {
  return filterActions(actions, query)
    .map((action) => {
      const isAvailable = Boolean(available(action));
      return {
        ...action,
        available: isAvailable,
        _rank: [
          isAvailable ? 1 : 0,
          contextScore(action, context),
          periodScore(action, context),
          frequencyOf(frequencies, action.id),
          -Number(action.order || 0)
        ]
      };
    })
    .sort((left, right) => {
      for (let index = 0; index < left._rank.length; index += 1) {
        const delta = right._rank[index] - left._rank[index];
        if (delta) return delta;
      }
      return left.id.localeCompare(right.id, 'ru');
    })
    .map(({ _rank, ...action }) => action);
}

export function recommendActions(options = {}) {
  return rankActions(ACTIONS, options).filter((action) => action.available).slice(0, 3);
}
