// Only structural labels are normalized. Values and business text are not spell-corrected.
export const protocolMarkers = Object.freeze({
  agenda: ['Повестка дня', 'Повестка заседания', 'Повестка'],
  heard: ['Слушали', 'Слушал', 'Заслушали'],
  discussed: ['Выступили', 'Выступил', 'Обсудили'],
  decision: ['Решение', 'Решения', 'Решили', 'Решено', 'Постановили', 'Постановление', 'Постановлено'],
  chairperson: ['Председатель заседания', 'Председательствовал', 'Председатель'],
  secretary: ['Секретарь заседания', 'Секретарь'],
  attendees: ['Присутствовали', 'Присутствует', 'Присутствуют', 'Присутствовало', 'Присутствующие']
});
const confusables = { a:'а', c:'с', e:'е', o:'о', p:'р', x:'х', y:'у', k:'к', m:'м', t:'т', h:'н', b:'в' };
export function markerKey(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replace(/ё/gu,'е')
    .replace(/[aceopxykmthb]/gu, (letter) => confusables[letter]).replace(/\s+/gu,' ').trim();
}
function near(a,b) {
  if (a === b) return true;
  if (Math.min(a.length,b.length) < 5 || Math.abs(a.length-b.length) > 1) return false;
  let i=0;
  while (i < Math.min(a.length,b.length) && a[i] === b[i]) i+=1;
  if (a.length === b.length) return a.slice(i+1) === b.slice(i+1)
    || (a[i] === b[i+1] && a[i+1] === b[i] && a.slice(i+2) === b.slice(i+2));
  return a.length > b.length ? a.slice(i+1) === b.slice(i) : a.slice(i) === b.slice(i+1);
}
export function normalizeMarkerAliases(input = {}) {
  const result={};
  for (const kind of Object.keys(protocolMarkers)) {
    const values=Array.isArray(input?.[kind]) ? input[kind] : [];
    result[kind]=[...new Set(values.map((value) => String(value).replace(/\s+/gu,' ').replace(/[:.]+$/u,'').trim())
      .filter((value) => value.length >= 3 && value.length <= 64))].slice(0,16);
  }
  return result;
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
export function createMarkerMatcher(aliases={}) {
  const custom=normalizeMarkerAliases(aliases);
  const entries=Object.entries(protocolMarkers).flatMap(([kind,labels]) => [...new Set([...labels,...custom[kind]])]
    .map((label) => ({kind,label,key:markerKey(label),pattern:new RegExp(`^\\s*${escape(label).replace(/ /gu,'\\s+')}(?=$|\\s|[:.：–—-])\\s*[:.：–—-]?\\s*(.*)$`,'iu')})))
    .sort((a,b) => b.label.length-a.label.length);
  return (text,kinds=Object.keys(protocolMarkers)) => {
    const candidates=entries.filter((entry) => kinds.includes(entry.kind));
    for (const entry of candidates) {
      const match=String(text).match(entry.pattern);
      if (match) return {kind:entry.kind,value:match[1],fuzzy:false,label:entry.label};
    }
    // Fuzzy matching requires an isolated/delimited label and a unique section kind.
    const token=String(text).match(/^\s*([\p{L}\s]{5,70}?)\s*(?:[:.：]\s*(.*)|$)/u);
    if (!token) return null;
    const key=markerKey(token[1]);
    const matches=candidates.filter((entry) => near(key,entry.key) || key.replace(/\s/gu,'') === entry.key.replace(/\s/gu,''));
    if (new Set(matches.map((entry) => entry.kind)).size !== 1) return null;
    return {kind:matches[0].kind,value:token[2] || '',fuzzy:true,label:token[1]};
  };
}
