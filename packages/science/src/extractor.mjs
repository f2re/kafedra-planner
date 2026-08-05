const doiPattern = /\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+\b/iu;

function linesOf(text) {
  return String(text || '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function lineIndex(lines, pattern) {
  return lines.findIndex((line) => pattern.test(line));
}

function likelyAuthorLine(line) {
  if (!line || line.length > 260) return false;
  if (/^(удк|doi|аннотация|ключевые слова|abstract|keywords)\b/iu.test(line)) return false;
  return /(?:[А-ЯЁA-Z][а-яёa-z-]+\s+[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.|[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z][а-яёa-z-]+)/u.test(line)
    || (line.includes(',') && /[А-ЯЁA-Z][а-яёa-z-]{2,}/u.test(line));
}

function splitAuthors(line) {
  return String(line || '')
    .split(/\s*[,;]\s*|\s+и\s+/iu)
    .map((value) => value.trim())
    .filter((value) => value.length >= 4 && value.length <= 120)
    .slice(0, 30);
}

function itemKind(text, title) {
  const value = `${title}\n${text}`.toLocaleLowerCase('ru-RU');
  if (/\bпатент|изобретени[ея]|полезн(?:ая|ой) модель\b/u.test(value)) return 'patent';
  if (/\bгрант|заявк[аи] на конкурс|рнф|рффи\b/u.test(value)) return 'grant';
  if (/\bотчет\s+о\s+нир|отчёт\s+о\s+нир|научно-исследовательск(?:ая|ой) работ/u.test(value)) return 'nir_report';
  if (/\bконференц|сборник материалов|тезисы доклад/u.test(value)) return 'conference';
  if (/\bпроект\b/u.test(value) && !doiPattern.test(value)) return 'project';
  return 'article';
}

function extractYear(text) {
  const years = [...String(text || '').matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1950 && year <= 2100);
  return years.length ? years[0] : null;
}

function classificationEntries(text) {
  const value = String(text || '');
  const entries = [];
  if (/(?:вак)|переч(?:ень|ня)\s+вак/iu.test(value)) entries.push({ kind: 'vak', value: 'ВАК' });
  if (/(?:ринц)|russian science citation index/iu.test(value)) entries.push({ kind: 'rinc', value: 'РИНЦ' });
  if (/\bweb\s+of\s+science\b|\bwos\b/iu.test(value)) entries.push({ kind: 'database', value: 'Web of Science' });
  if (/\bscopus\b/iu.test(value)) entries.push({ kind: 'database', value: 'Scopus' });
  if (/(?:мбд)/iu.test(value)) entries.push({ kind: 'mbd', value: 'МБД' });
  return entries;
}

export function looksLikeScientificMaterial(text, documentTitle = '') {
  const value = `${documentTitle}\n${text}`;
  if (doiPattern.test(value)) return true;
  const signals = [
    /\bаннотация\b/iu,
    /\bключевые слова\b/iu,
    /\babstract\b/iu,
    /\bkeywords\b/iu,
    /\bудк\s*[:\d]/iu,
    /\bсписок литературы\b|\breferences\b/iu
  ].filter((pattern) => pattern.test(value)).length;
  if (signals >= 2) return true;
  return /\bпатент\b|\bотч[её]т\s+о\s+нир\b|\bтезисы\s+доклад/iu.test(value);
}

export function extractScientificMaterial(text, documentTitle = '') {
  const lines = linesOf(text);
  const doi = String(text || '').match(doiPattern)?.[0]?.replace(/[.,;]+$/, '') || null;
  const abstractIndex = lineIndex(lines, /^(аннотация|abstract)\b/iu);
  const keywordsIndex = lineIndex(lines, /^(ключевые слова|keywords)\b/iu);
  const authorIndex = lines.findIndex(likelyAuthorLine);

  let title = null;
  const titleStart = authorIndex >= 0 ? authorIndex + 1 : 0;
  for (let index = titleStart; index < Math.min(lines.length, titleStart + 8); index += 1) {
    const line = lines[index];
    if (/^(удк|doi|аннотация|abstract|ключевые слова|keywords)\b/iu.test(line)) continue;
    if (likelyAuthorLine(line)) continue;
    if (line.length >= 12 && line.length <= 320) { title = line; break; }
  }
  title ||= String(documentTitle || '').replace(/\.[^.]+$/, '').trim() || lines[0] || 'Научный материал';

  const authors = authorIndex >= 0 ? splitAuthors(lines[authorIndex]) : [];
  let abstractText = null;
  if (abstractIndex >= 0) {
    const end = keywordsIndex > abstractIndex ? keywordsIndex : Math.min(lines.length, abstractIndex + 8);
    abstractText = lines.slice(abstractIndex, end).join(' ').replace(/^(аннотация|abstract)\s*[:.-]?\s*/iu, '').trim() || null;
  }

  const year = extractYear(`${documentTitle}\n${text}`);
  const venue = lines.find((line) => /\b(журнал|вестник|известия|сборник|труды|conference|journal)\b/iu.test(line) && line !== title) || null;
  const kind = itemKind(text, title);
  const classifications = classificationEntries(text);
  const confidence = Math.min(1,
    0.28 + (doi ? 0.28 : 0) + (authors.length ? 0.14 : 0) + (abstractText ? 0.14 : 0)
    + (year ? 0.08 : 0) + (venue ? 0.05 : 0) + (classifications.length ? 0.03 : 0)
  );

  return {
    kind,
    title,
    abstractText,
    publishedAt: year ? `${year}-01-01` : null,
    publicationYear: year,
    venue,
    doi,
    authors,
    classifications,
    confidence: Number(confidence.toFixed(3)),
    evidence: {
      title: { line: lines.indexOf(title) + 1, text: title },
      authors: authorIndex >= 0 ? { line: authorIndex + 1, text: lines[authorIndex] } : null,
      doi: doi ? { text: doi } : null,
      abstract: abstractIndex >= 0 ? { line: abstractIndex + 1 } : null
    }
  };
}
