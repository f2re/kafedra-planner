const entities = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"]
]);

export function decodeXmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, token) => {
    if (token.startsWith('#x')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return entities.get(token.toLowerCase()) ?? `&${token};`;
  });
}

export function wordDocumentXmlToText(xml) {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t');
  const pieces = [];
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(withBreaks)) !== null) {
    const between = withBreaks.slice(cursor, match.index).replace(/<[^>]+>/g, '');
    pieces.push(between, decodeXmlEntities(match[1]));
    cursor = pattern.lastIndex;
  }
  pieces.push(withBreaks.slice(cursor).replace(/<[^>]+>/g, ''));
  return cleanupText(pieces.join(''));
}

export function odtContentXmlToText(xml) {
  return cleanupText(
    decodeXmlEntities(
      xml
        .replace(/<text:tab\b[^>]*\/>/gi, '\t')
        .replace(/<text:line-break\b[^>]*\/>/gi, '\n')
        .replace(/<\/text:p>/gi, '\n')
        .replace(/<\/text:h>/gi, '\n')
        .replace(/<table:table-cell\b[^>]*>/gi, '')
        .replace(/<\/table:table-cell>/gi, '\t')
        .replace(/<\/table:table-row>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    )
  );
}

export function cleanupText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}
