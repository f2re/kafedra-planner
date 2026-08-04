import { extname } from 'node:path';

const formats = new Map([
  ['.txt', 'text'],
  ['.md', 'text'],
  ['.csv', 'text'],
  ['.json', 'text'],
  ['.xml', 'text'],
  ['.docx', 'docx'],
  ['.odt', 'odt'],
  ['.pdf', 'pdf'],
  ['.xlsx', 'xlsx'],
  ['.ods', 'ods'],
  ['.doc', 'legacy-office'],
  ['.xls', 'legacy-office']
]);

export function detectFormat(fileName, mediaType = '') {
  const extension = extname(String(fileName || '')).toLowerCase();
  if (formats.has(extension)) return formats.get(extension);
  if (mediaType.startsWith('text/')) return 'text';
  return 'unknown';
}

export function supportedFormat(format) {
  return ['text', 'docx', 'odt', 'pdf'].includes(format);
}
