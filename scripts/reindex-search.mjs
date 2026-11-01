#!/usr/bin/env node
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { rebuildSearchIndex } from '../packages/storage/src/search.mjs';

const config = loadConfig();
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });

try {
  ensureDefaultWorkspace(database);
  const workspaces = database.all('SELECT id, code, name FROM workspaces');
  if (!workspaces || workspaces.length === 0) {
    console.log('Нет рабочих пространств для индексации.');
    process.exit(0);
  }

  for (const ws of workspaces) {
    console.log(`Переиндексация рабочего пространства: ${ws.name || ws.code} (${ws.id})...`);
    const result = rebuildSearchIndex(database, ws.id);
    console.log(`Индексация завершена: актуализировано ${result.indexedCount} фрагментов.`);
    console.log(`  - Протоколы заседаний: ${result.meetingsCount}`);
    console.log(`  - Решения заседаний: ${result.decisionsCount}`);
    console.log(`  - Документы: ${result.documentsCount}`);
    console.log(`  - Планы: ${result.plansCount}`);
    console.log(`  - Пункты планов: ${result.planItemsCount}`);
    console.log(`  - Распорядительные документы: ${result.directivesCount}`);
    console.log(`  - Поручения: ${result.assignmentsCount}`);
    console.log(`  - Научные материалы: ${result.scienceCount}`);
  }

  console.log('Поисковый индекс FTS5 успешно актуализирован.');
} catch (error) {
  console.error('Ошибка при переиндексации:', error);
  process.exit(1);
} finally {
  database.close();
}
