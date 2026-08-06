import { readFile } from 'node:fs/promises';
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, normalizePersonName } from '../packages/work-management/src/service.mjs';
import { createAuthAccount, listAuthAccounts } from '../packages/auth/src/service.mjs';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const config = loadConfig();
const username = argument('username') || process.env.KAFEDRA_ADMIN_USERNAME || 'admin';
const personIdArg = argument('person-id') || process.env.KAFEDRA_ADMIN_PERSON_ID || '';
const personName = argument('person-name') || process.env.KAFEDRA_ADMIN_PERSON_NAME || 'Администратор системы';
const passwordFile = argument('password-file') || process.env.KAFEDRA_ADMIN_PASSWORD_FILE || '';
let password = process.env.KAFEDRA_ADMIN_PASSWORD || '';
if (!password && passwordFile) password = (await readFile(passwordFile, 'utf8')).trimEnd();
if (!password) {
  console.error('Не задан пароль. Передайте KAFEDRA_ADMIN_PASSWORD или --password-file.');
  process.exit(2);
}

const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
try {
  const workspace = ensureDefaultWorkspace(database);
  let person = personIdArg
    ? database.get('SELECT * FROM people WHERE workspace_id = ? AND id = ?', workspace.id, personIdArg)
    : database.get('SELECT * FROM people WHERE workspace_id = ? AND normalized_name = ?', workspace.id, normalizePersonName(personName));
  if (!person) {
    person = createPerson(database, workspace.id, {
      displayName: personName,
      position: 'Администратор системы'
    });
  }
  const existing = listAuthAccounts(database, workspace.id).find((item) => item.personId === person.id);
  if (existing) {
    console.error(`Для сотрудника «${person.display_name}» аккаунт уже существует: ${existing.username}`);
    process.exit(3);
  }
  const account = createAuthAccount(database, workspace.id, {
    personId: person.id,
    username,
    password,
    role: 'admin',
    mustChangePassword: false
  });
  console.log(`Создан администратор ${account.username} для «${account.person.displayName}».`);
} finally {
  database.close();
}
