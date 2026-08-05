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
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.tif', 'image'],
  ['.tiff', 'image'],
  ['.bmp', 'image'],
  ['.webp', 'image'],
  ['.doc', 'legacy-office'],
  ['.xls', 'legacy-office']
]);

export function detectFormat(fileName, mediaType = '') {
  const extension = extname(String(fileName || '')).toLowerCase();
  if (formats.has(extension)) return formats.get(extension);
  if (mediaType.startsWith('text/')) return 'text';
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  return 'unknown';
}

export function supportedFormat(format) {
  return ['text', 'docx', 'odt', 'pdf', 'xlsx', 'ods', 'image'].includes(format);
}

export function isOfficeFormat(format) {
  return ['docx', 'odt', 'xlsx', 'ods'].includes(format);
}

export function isNativePreviewFormat(format) {
  return ['pdf', 'image'].includes(format);
}
