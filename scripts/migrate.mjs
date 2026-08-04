import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';

const config = loadConfig();
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
const workspace = ensureDefaultWorkspace(database);
console.log(JSON.stringify({ status: 'ok', databasePath: config.databasePath, workspaceId: workspace.id }));
database.close();
