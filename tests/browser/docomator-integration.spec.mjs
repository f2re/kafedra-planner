import { test, expect } from '@playwright/test';

async function openOrganization(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 12_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#organization-shell-panel')).toBeVisible();
  await expect(page.locator('#docomator-integration')).toBeVisible({ timeout: 15_000 });
}

function initialSettings() {
  return {
    url: '', scheme: 'http', host: '', port: 8080,
    spaceId: null, groupId: null, includeInactive: false,
    lastStatus: 'unknown', lastCheckedAt: null, lastImportedAt: null,
    remoteVersion: null, lastError: null,
    emailPropertyKey: null, positionPropertyKey: null, extraPropertyKeys: []
  };
}

test('Оформлятор: один скопированный адрес подключает источник и импортирует людей', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let settings = initialSettings();
  const checkBodies = [];
  let importBody = null;
  let putBody = null;

  await page.route('**/api/integrations/docomator**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.method() === 'GET' ? {} : JSON.parse(request.postData() || '{}');
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
    }
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'PUT') {
      putBody = body;
      settings = { ...settings, ...body };
      delete settings.accessCode;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
    }
    if (url.pathname === '/api/integrations/docomator/check') {
      checkBodies.push(body);
      const selected = body.spaceId === 'space-1';
      settings = {
        ...settings,
        url: 'http://192.168.1.50:8080', scheme: 'http', host: '192.168.1.50', port: 8080,
        spaceId: selected ? 'space-1' : null, lastStatus: 'ok', lastCheckedAt: '2026-09-03T13:30:00Z'
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reachable: true, ready: true, authRequired: false, dataAvailable: true,
        remoteVersion: '0.7.0', endpoint: 'http://192.168.1.50:8080',
        spaces: [{ id: 'space-1', name: 'Кафедра' }],
        groups: selected ? [{ id: 'group-1', name: 'Штат кафедры' }] : [],
        peopleCount: selected ? 2 : null,
        peoplePreview: selected ? [
          { id: 'remote-1', displayName: 'Иванов Иван', status: 'active' },
          { id: 'remote-2', displayName: 'Петрова Анна', status: 'active' }
        ] : [],
        properties: [], suggestedMappings: { emailPropertyKey: null, positionPropertyKey: null },
        settings
      }) });
    }
    if (url.pathname === '/api/integrations/docomator/fields/discover') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        properties: [], suggestedMappings: { emailPropertyKey: null, positionPropertyKey: null }
      }) });
    }
    if (url.pathname === '/api/integrations/docomator/import') {
      importBody = body;
      settings = { ...settings, lastImportedAt: '2026-09-03T13:31:00Z' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        stats: { total: 2, created: 2, updated: 0, matched: 0, skipped: 0 },
        fieldStats: { mapped: 0, extras: 0 }, imported: [], settings
      }) });
    }
    return route.continue();
  });

  await openOrganization(page);
  const section = page.locator('#docomator-integration');
  await expect(section.locator('[name="scheme"]')).toHaveCount(0);
  await expect(section.locator('[name="host"]')).toHaveCount(0);
  await expect(section.locator('[name="port"]')).toHaveCount(0);
  await expect(section.getByLabel('Адрес Оформлятора')).toBeVisible();
  await section.getByLabel('Адрес Оформлятора').fill('192.168.1.50:8080/api/v1/system/health');
  await section.getByLabel('Код доступа').fill('1234');
  await section.getByRole('button', { name: 'Подключить' }).click();

  await expect(section.getByLabel('Адрес Оформлятора')).toHaveValue('http://192.168.1.50:8080');
  await expect(section.locator('#docomator-endpoint')).toHaveText('http://192.168.1.50:8080');
  await expect(section.locator('#docomator-connection-badge')).toHaveText('Доступен');
  await expect(section.locator('#docomator-space')).toHaveValue('space-1', { timeout: 15_000 });
  await expect(section.locator('#docomator-people-count')).toHaveText('2');
  await expect(section.locator('#docomator-preview')).toContainText('Иванов Иван');
  await expect(section.locator('[data-docomator-import]')).toBeEnabled();

  expect(checkBodies.length).toBeGreaterThanOrEqual(2);
  expect(checkBodies[0].url).toBe('192.168.1.50:8080/api/v1/system/health');
  expect(checkBodies[0].accessCode).toBe('1234');
  expect(Object.hasOwn(checkBodies[0], 'scheme')).toBe(false);
  expect(Object.hasOwn(checkBodies[0], 'host')).toBe(false);
  expect(Object.hasOwn(checkBodies[0], 'port')).toBe(false);

  await section.locator('[data-docomator-import]').click();
  await expect(section.locator('#docomator-status')).toContainText('Импорт завершён', { timeout: 15_000 });
  expect(putBody.url).toBe('http://192.168.1.50:8080');
  expect(Object.hasOwn(putBody, 'accessCode')).toBe(false);
  expect(importBody.url).toBe('http://192.168.1.50:8080');
  expect(importBody.spaceId).toBe('space-1');
  expect(importBody.accessCode).toBe('1234');
  expect(Object.hasOwn(settings, 'accessCode')).toBe(false);

  const badgeMotion = await section.locator('#docomator-connection-badge').evaluate((node) => ({
    animationName: getComputedStyle(node).animationName,
    transitionDuration: getComputedStyle(node).transitionDuration
  }));
  expect(badgeMotion).toEqual({ animationName: 'none', transitionDuration: '0s' });

  await page.reload();
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 12_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#docomator-integration')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#docomator-integration [name="accessCode"]')).toHaveValue('');
  await expect(page.locator('#docomator-integration [name="url"]')).toHaveValue('http://192.168.1.50:8080');
});

test('Оформлятор: DNS-ошибка объясняет, где проверяется адрес, и не блокирует локальную структуру', async ({ page }) => {
  const settings = initialSettings();
  await page.route('**/api/integrations/docomator**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
    }
    if (url.pathname === '/api/integrations/docomator/check') {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'docomator_dns_failed', message: 'Сервер Планнера не смог разрешить имя Оформлятора. Вставьте доступный ему DNS-адрес или IP. Проверено: http://docomator.invalid:8080.' } })
      });
    }
    return route.continue();
  });

  await openOrganization(page);
  const section = page.locator('#docomator-integration');
  await section.getByLabel('Адрес Оформлятора').fill('docomator.invalid');
  await section.getByRole('button', { name: 'Подключить' }).click();

  await expect(section.locator('#docomator-connection-badge')).toHaveText('Ошибка');
  await expect(section.locator('#docomator-status')).toContainText('Сервер Планнера не смог разрешить имя');
  await expect(section.locator('#docomator-status')).toContainText('DNS-адрес или IP');
  await expect(section.locator('#docomator-source')).toBeHidden();
  await expect(page.locator('#organization-shell-panel')).toBeVisible();
  await expect(page.locator('#organization-admin')).toBeVisible();
});
