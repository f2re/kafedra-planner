import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

const REQUIREMENTS = Object.freeze([
  { id: 'tar', names: ['tar'], required: true, capability: 'backup', label: 'архивирование резервных копий' },
  { id: 'sha256sum', names: ['sha256sum'], required: true, capability: 'integrity', label: 'проверка контрольных сумм' },
  { id: 'systemctl', names: ['systemctl'], required: true, capability: 'install', label: 'управление systemd-службами' },
  { id: 'runuser', names: ['runuser'], required: true, capability: 'install', label: 'запуск миграций от системного пользователя' },
  { id: 'useradd', names: ['useradd'], required: true, capability: 'install', label: 'создание системного пользователя' },
  // External document converters are capabilities, not deployment prerequisites.
  // A damaged/mixed APT database must not prevent the calendar/tasks core from
  // starting; the operator can restore these capabilities independently.
  { id: 'unzip', names: ['unzip'], required: false, capability: 'office_extract', label: 'чтение DOCX/ODT/XLSX/ODS' },
  { id: 'pdftotext', names: ['pdftotext'], required: false, capability: 'pdf_text', label: 'извлечение текстового слоя PDF' },
  { id: 'pdftoppm', names: ['pdftoppm'], required: false, capability: 'ocr', label: 'преобразование страниц PDF для OCR' },
  { id: 'tesseract', names: ['tesseract'], required: false, capability: 'ocr', label: 'локальный OCR сканов' },
  { id: 'libreoffice', names: ['soffice', 'libreoffice'], required: false, capability: 'office_preview', label: 'PDF-предпросмотр офисных документов' },
  { id: 'nginx', names: ['nginx'], required: false, capability: 'reverse_proxy', label: 'рекомендуемый локальный reverse proxy' }
]);

function executablePath(name, pathEnv) {
  for (const directory of String(pathEnv || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function checkRequirement(requirement, pathEnv) {
  const found = requirement.names
    .map((name) => ({ name, path: executablePath(name, pathEnv) }))
    .find((entry) => entry.path);
  return {
    id: requirement.id,
    capability: requirement.capability,
    label: requirement.label,
    required: requirement.required,
    names: [...requirement.names],
    available: Boolean(found),
    command: found?.name || null,
    path: found?.path || null
  };
}

function runtimeInfo() {
  const header = typeof process.report?.getReport === 'function' ? process.report.getReport().header : {};
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    glibcVersionRuntime: header?.glibcVersionRuntime || null,
    glibcVersionCompiler: header?.glibcVersionCompiler || null
  };
}

export function inspectSystem({ pathEnv = process.env.PATH, platform = process.platform } = {}) {
  const checks = REQUIREMENTS.map((requirement) => checkRequirement(requirement, pathEnv));
  const byId = new Map(checks.map((check) => [check.id, check]));
  const requiredMissing = checks.filter((check) => check.required && !check.available).map((check) => check.id);
  const optionalMissing = checks.filter((check) => !check.required && !check.available).map((check) => check.id);
  const capabilities = {
    backup: Boolean(byId.get('tar')?.available && byId.get('sha256sum')?.available),
    serviceInstall: Boolean(byId.get('systemctl')?.available && byId.get('runuser')?.available && byId.get('useradd')?.available),
    officeExtract: Boolean(byId.get('unzip')?.available),
    pdfText: Boolean(byId.get('pdftotext')?.available),
    ocr: Boolean(byId.get('pdftoppm')?.available && byId.get('tesseract')?.available),
    officePreview: Boolean(byId.get('libreoffice')?.available),
    reverseProxy: Boolean(byId.get('nginx')?.available)
  };
  return {
    platform,
    runtime: runtimeInfo(),
    status: requiredMissing.length ? 'blocked' : optionalMissing.length ? 'degraded' : 'ready',
    requiredMissing,
    optionalMissing,
    capabilities,
    checks
  };
}

export function renderPreflight(result) {
  const lines = [];
  const runtime = result.runtime || {};
  lines.push(`Runtime: ${runtime.nodeVersion || process.version} · ${runtime.platform || process.platform}/${runtime.arch || process.arch}${runtime.glibcVersionRuntime ? ` · glibc ${runtime.glibcVersionRuntime}` : ''}`);
  if (result.status === 'ready') lines.push('Системные зависимости: готовы.');
  else if (result.status === 'degraded') lines.push('Системные зависимости: ядро готово, часть обработки документов недоступна.');
  else lines.push('Системные зависимости: установка заблокирована — отсутствуют обязательные команды ОС.');
  for (const check of result.checks) {
    const marker = check.available ? '✓' : check.required ? '✗' : '–';
    const detail = check.available ? check.path : check.names.join(' / ');
    lines.push(`${marker} ${check.label}: ${detail}`);
  }
  if (!result.capabilities.officeExtract) lines.push('  DOCX/ODT/XLSX/ODS нельзя разбирать до установки unzip; остальные контуры продолжают работать.');
  if (!result.capabilities.pdfText) lines.push('  Текстовый слой PDF недоступен до установки Poppler; исходный PDF всё равно можно хранить.');
  if (!result.capabilities.ocr) lines.push('  OCR сканов недоступен до установки pdftoppm и Tesseract.');
  if (!result.capabilities.officePreview) lines.push('  Предпросмотр DOCX/XLSX/ODT/ODS недоступен до установки LibreOffice.');
  if (!result.capabilities.reverseProxy) lines.push('  Nginx не найден: API может работать напрямую, но reverse proxy нужно настроить отдельно при необходимости.');
  return lines.join('\n');
}

export const systemRequirements = REQUIREMENTS;
