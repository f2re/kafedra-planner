function isLoopback(host) {
  const value = String(host || '').toLowerCase();
  return ['127.0.0.1', 'localhost', '::1'].includes(value);
}

export function getReleaseReadiness(database, workspaceId, config) {
  const activeAdmins = Number(database.get(`
    SELECT COUNT(*) AS count FROM auth_accounts
    WHERE workspace_id = ? AND role = 'admin' AND is_active = 1
  `, workspaceId)?.count || 0);
  const activeAccounts = Number(database.get(`
    SELECT COUNT(*) AS count FROM auth_accounts
    WHERE workspace_id = ? AND is_active = 1
  `, workspaceId)?.count || 0);
  const peopleWithoutAccounts = Number(database.get(`
    SELECT COUNT(*) AS count
    FROM people p
    LEFT JOIN auth_accounts a
      ON a.workspace_id = p.workspace_id AND a.person_id = p.id
    WHERE p.workspace_id = ? AND p.status = 'active' AND a.id IS NULL
  `, workspaceId)?.count || 0);
  const activeSessions = Number(database.get(`
    SELECT COUNT(*) AS count
    FROM auth_sessions s
    JOIN auth_accounts a ON a.id = s.account_id
    WHERE a.workspace_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `, workspaceId, new Date().toISOString())?.count || 0);

  const checks = [
    {
      code: 'auth_enabled',
      status: config.authEnabled ? 'ok' : 'error',
      title: 'Авторизация включена',
      detail: config.authEnabled
        ? 'Запросы связаны с локальными аккаунтами сотрудников.'
        : 'В промышленной эксплуатации KAFEDRA_AUTH_ENABLED должен быть true.'
    },
    {
      code: 'admin_exists',
      status: activeAdmins > 0 ? 'ok' : 'error',
      title: 'Есть активный администратор',
      detail: activeAdmins > 0
        ? `Активных администраторов: ${activeAdmins}.`
        : 'Создайте первого администратора командой npm run auth:create-admin.'
    },
    {
      code: 'csrf_enabled',
      status: config.authCsrfEnabled ? 'ok' : 'error',
      title: 'CSRF-защита включена',
      detail: config.authCsrfEnabled
        ? 'Изменяющие запросы требуют токен текущей серверной сессии.'
        : 'Установите KAFEDRA_AUTH_CSRF_ENABLED=true.'
    },
    {
      code: 'secure_cookie',
      status: isLoopback(config.host) || config.authSecureCookies ? 'ok' : 'warning',
      title: 'Защищённые cookie',
      detail: isLoopback(config.host) || config.authSecureCookies
        ? 'Cookie соответствуют текущему режиму размещения.'
        : 'Для сетевого HTTPS-размещения включите KAFEDRA_AUTH_SECURE_COOKIES=true.'
    }
  ];
  const hasError = checks.some((item) => item.status === 'error');
  const hasWarning = checks.some((item) => item.status === 'warning');
  return {
    status: hasError ? 'not_ready' : hasWarning ? 'ready_with_warnings' : 'ready',
    checks,
    counts: { activeAdmins, activeAccounts, activeSessions, peopleWithoutAccounts }
  };
}
