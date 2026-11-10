const MONTH_FORMS = [
  ['январь', 'января', 'январе'], ['февраль', 'февраля', 'феврале'],
  ['март', 'марта', 'марте'], ['апрель', 'апреля', 'апреле'],
  ['май', 'мая', 'мае'], ['июнь', 'июня', 'июне'],
  ['июль', 'июля', 'июле'], ['август', 'августа', 'августе'],
  ['сентябрь', 'сентября', 'сентябре'], ['октябрь', 'октября', 'октябре'],
  ['ноябрь', 'ноября', 'ноябре'], ['декабрь', 'декабря', 'декабре']
];

export function monthlyPeriod(periodKey) {
  const match = /^(20\d{2})-(0[1-9]|1[0-2])$/u.exec(String(periodKey || ''));
  if (!match) throw new Error('plan_generation_period_invalid');
  const year = Number(match[1]);
  const month = Number(match[2]);
  return { periodKind: 'monthly', periodKey: match[0], yearStart: year, yearEnd: year, month };
}

export function monthLabel(month, grammaticalCase = 0) {
  return MONTH_FORMS[Number(month) - 1]?.[grammaticalCase] || '';
}

export function monthWord(value) {
  const text = String(value || '');
  const variants = MONTH_FORMS.flat().sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(`(?<![а-яё])(${variants})(?![а-яё])`, 'giu');
  return [...text.matchAll(pattern)].map((match) => {
    const normalized = match[0].toLocaleLowerCase('ru-RU');
    const index = MONTH_FORMS.findIndex((forms) => forms.includes(normalized));
    return { text: match[0], month: index + 1, grammaticalCase: MONTH_FORMS[index].indexOf(normalized), index: match.index };
  });
}

export function replaceMonthCase(source, month, grammaticalCase = 0) {
  const label = monthLabel(month, grammaticalCase);
  if (source === source.toLocaleUpperCase('ru-RU')) return label.toLocaleUpperCase('ru-RU');
  if (source[0] === source[0]?.toLocaleUpperCase('ru-RU')) return label[0]?.toLocaleUpperCase('ru-RU') + label.slice(1);
  return label;
}
