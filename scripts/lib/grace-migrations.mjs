import { MIGRATION_FILE_PATTERN, normalizeRepositoryPath } from './grace-runtime.mjs';

export function migrationDescriptor(filePath) {
  const normalized = normalizeRepositoryPath(filePath);
  const match = normalized.match(MIGRATION_FILE_PATTERN);
  return match ? { path: normalized, version: Number(match[1]), slug: match[2] } : null;
}

export function analyzeMigrationDiff({ entries, baseFiles, headFiles }) {
  const errors = [];
  const baseMigrations = baseFiles.filter((file) => file.startsWith('migrations/'));
  const headMigrations = headFiles.filter((file) => file.startsWith('migrations/'));
  const baseDescriptors = baseMigrations.map(migrationDescriptor);
  const headDescriptors = headMigrations.map(migrationDescriptor);
  baseDescriptors.forEach((item, index) => {
    if (!item) errors.push(`Неканоническое имя существующей миграции: ${baseMigrations[index]}`);
  });
  headDescriptors.forEach((item, index) => {
    if (!item) errors.push(`Миграция должна иметь имя NNN_slug.sql: ${headMigrations[index]}`);
  });

  const baseSet = new Set(baseMigrations);
  for (const entry of entries) {
    const paths = entry.paths.filter((file) => file.startsWith('migrations/'));
    if (!paths.length) continue;
    if (entry.status !== 'A') {
      errors.push(`Миграции append-only: запрещено изменение ${entry.statusToken} ${paths.join(' → ')}`);
    } else if (entry.newPath && baseSet.has(entry.newPath)) {
      errors.push(`Существующая миграция не может быть добавлена повторно: ${entry.newPath}`);
    }
  }

  const validBase = baseDescriptors.filter(Boolean);
  const validHead = headDescriptors.filter(Boolean);
  const versions = new Map();
  for (const item of validHead) {
    const previous = versions.get(item.version);
    if (previous) errors.push(`Дублируется номер миграции ${item.version}: ${previous}, ${item.path}`);
    versions.set(item.version, item.path);
  }
  const baseMax = validBase.reduce((max, item) => Math.max(max, item.version), 0);
  const newMigrations = validHead
    .filter((item) => !baseSet.has(item.path))
    .sort((left, right) => left.version - right.version || left.path.localeCompare(right.path));
  newMigrations.forEach((item, index) => {
    const expected = baseMax + index + 1;
    if (item.version !== expected) {
      errors.push(`Новая миграция ${item.path} должна иметь следующий последовательный номер ${String(expected).padStart(3, '0')}.`);
    }
  });
  return {
    errors, baseMax, newMigrations,
    headMax: validHead.reduce((max, item) => Math.max(max, item.version), 0)
  };
}

export function migrationEvidenceErrors(planXmlDocuments) {
  const text = planXmlDocuments.join('\n').toLowerCase();
  const required = [
    ['grace:migrations', 'план schema-change должен запускать npm run grace:migrations'],
    ['backup:selftest', 'план schema-change должен запускать npm run backup:selftest'],
    ['quick_check', 'план schema-change должен требовать PRAGMA quick_check'],
    ['foreign_key_check', 'план schema-change должен требовать PRAGMA foreign_key_check'],
    ['rollback', 'план schema-change должен содержать rollback-стратегию']
  ];
  return required.filter(([needle]) => !text.includes(needle)).map(([, message]) => message);
}
