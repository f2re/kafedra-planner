// Retrieval hints only: these functions never modify explicit filters or business data.
const STOP = new Set(('а и или но в во на по про об о от до за из к ко с со у для при через между ' +
  'где когда который которая которое которые был была было были есть будет найти найди ищу ищется ' +
  'нужен нужна нужно нужны мне мы наш наша наши пожалуйста покажи показать материал материалы ' +
  'содержит содержащий упоминается упоминалась упоминание связанный связанные касательно тему теме').split(' '));
const GENERIC = new Set(('отчет отчета отчете отчеты отчетность статья статьи статью статье публикация публикации ' +
  'документ документа документы документе протокол протокола протоколе протоколы заседание заседания заседании ' +
  'кафедра кафедры кафедре работа работы работе результат результаты').split(' '));

export function words(value, max = 24) {
  return (String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
    .match(/[\p{L}\p{N}]+/gu) || []).slice(0, max).map((word) => word.slice(0, 64));
}

export function searchStem(word) {
  // Conservative inflection prefixes; not a claim of full Russian lemmatization.
  if (!/^[а-я]{5,}$/u.test(word)) return word;
  const stem = word.replace(/(?:иями|ями|ами|иями|иях|ах|ях|ого|его|ому|ему|ыми|ими|ение|ения|ению|ений|ия|ие|ий|ый|ой|ая|яя|ое|ее|ые|ие|ов|ев|ам|ям|ом|ем|ах|ях|ую|юю|ы|и|а|я|у|ю|е|о|ь)$/u, '');
  return stem.length >= 4 ? stem : word;
}

export function topicWords(query) {
  const all = [...new Set(words(query).filter((word) => !STOP.has(word)))];
  const topic = all.filter((word) => !GENERIC.has(word));
  return (topic.length ? topic : all).slice(0, 8);
}

export function literalQuery(query) {
  return (String(query || '').normalize('NFKC').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 24).map((word) => word.slice(0, 64)).join(' ');
}
export function topicQuery(query) { return [...new Set(topicWords(query).map(searchStem))].join(' '); }

export function editDistance(a, b) {
  // Optimal-string-alignment distance: one swapped pair also counts as one typo.
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
    }
    beforePrevious = previous;
    previous = row;
  }
  return previous[b.length];
}

export function similarTerms(word, vocabulary) {
  if (!/^[а-яa-z]{5,40}$/u.test(word)) return [];
  const stem = searchStem(word);
  return [...new Set(vocabulary)].map((term) => ({ term, distance: editDistance(stem, searchStem(term.replaceAll('ё', 'е'))) }))
    .filter(({ term, distance }) => term !== word && distance <= (stem.length >= 9 ? 2 : 1)
      && /^[а-яёa-z]{4,40}$/u.test(term) && term.length <= word.length + 3)
    .sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term, 'ru'))
    .slice(0, 3).map(({ term }) => term);
}

export function relatedQueryFor(item) {
  const terms = topicWords(item?.title || '').filter((term) => !/^\d+$/u.test(term));
  return terms.slice(0, 5).join(' ');
}
