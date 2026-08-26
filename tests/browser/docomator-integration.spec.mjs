import { test, expect } from '@playwright/test';

async function openOrganization(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 12_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#organization-shell-panel')).toBeVisible();
  await expect(page.locator('#docomator-integration')).toBeVisible({ timeout: 15_000 });
}

test('Настройки: адрес Оформлятора → проверка → выбор группы → импорт сотрудников', async ({ page }) => {
  const baseSettings = {
    scheme: 'http', host: '', port: 8080, spaceId: null, groupId: null,
    includeInactive: false, lastStatus: 'unknown', lastCheckedAt: null,
    lastImportedAt: null, remoteVersion: null, lastError: null
  };
  let importBody = null;
  await page.route('**/api/integrations/docomator**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = request.method() === 'GET' ? {} : JSON.parse(request.postData() || '{}');
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseSettings) });
    }
    if (url.pathname === '/api/integrations/docomator/check') {
      const selected = json.spaceId === 'space-1';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reachable: true, ready: true, authRequired: false, dataAvailable: true,
        remoteVersion: '0.6.6', endpoint: 'http://192.168.1.50:8080',
        spaces: [{ id: 'space-1', name: 'Кафедра' }],
        groups: selected ? [{ id: 'group-1', name: 'Штат кафедры' }] : [],
        peopleCount: selected ? 2 : null,
        peoplePreview: selected ? [
          { id: 'remote-1', displayName: 'Иванов Иван', status: 'active' },
          { id: 'remote-2', displayName: 'Петрова Анна', status: 'active' }
        ] : [],
        settings: { ...baseSettings, host: '192.168.1.50', spaceId: json.spaceId || null, groupId: json.groupId || null, remoteVersion: '0.6.6' }
      }) });
    }
    if (url.pathname === '/api/integrations/docomator/import') {
      importBody = json;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        stats: { total: 2, created: 2, updated: 0, matched: 0, skipped: 0 },
        imported: [],
        settings: { ...baseSettings, host: '192.168.1.50', spaceId: 'space-1', groupId: 'group-1', lastImportedAt: '2026-08-26T12:00:00Z' }
      }) });
    }
    return route.continue();
  });

  await openOrganization(page);
  const section = page.locator('#docomator-integration');
  await section.locator('[name="host"]').fill('192.168.1.50');
  await section.locator('[name="port"]').fill('8080');
  await section.locator('[name="accessCode"]').fill('1234');
  await section.locator('[data-docomator-check]').click();

  await expect(section.locator('#docomator-connection-badge')).toContainText('Доступен', { timeout: 15_000 });
  await expect(section.locator('#docomator-space')).toHaveValue('space-1');
  await expect(section.locator('#docomator-group')).toContainText('Штат кафедры');
  await expect(section.locator('#docomator-people-count')).toHaveText('2');
  await expect(section.locator('#docomator-preview')).toContainText('Иванов Иван');
  await section.locator('#docomator-group').selectOption('group-1');
  await expect(section.locator('[data-docomator-import]')).toBeEnabled({ timeout: 15_000 });
  await section.locator('[data-docomator-import]').click();
  await expect(section.locator('#docomator-status')).toContainText('Импорт завершён', { timeout: 15_000 });
  expect(importBody.spaceId).toBe('space-1');
  expect(importBody.groupId).toBe('group-1');
  expect(importBody.accessCode).toBe('1234');
});
