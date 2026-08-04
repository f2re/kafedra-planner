import { mkdir } from 'node:fs/promises';
import { loadConfig } from '../../../packages/config/src/index.mjs';
import { createLogger } from '../../../packages/core/src/logger.mjs';
import { Database } from '../../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../../packages/storage/src/bootstrap.mjs';
import { createApp } from './app.mjs';

const config = loadConfig();
await Promise.all([
  mkdir(config.dataDir, { recursive: true }),
  mkdir(config.blobDir, { recursive: true }),
  mkdir(config.tempDir, { recursive: true })
]);
const logger = createLogger(config.logLevel, { service: 'api' });
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
const workspace = ensureDefaultWorkspace(database);
const server = createApp({ database, config, logger });

server.listen(config.port, config.host, () => {
  logger.info('api started', {
    address: `http://${config.host}:${config.port}`,
    databasePath: config.databasePath,
    workspaceId: workspace.id
  });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info('api stopping', { signal });
    server.close(() => {
      database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
