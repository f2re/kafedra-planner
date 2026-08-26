import { test, expect } from '@playwright/test';

async function openOrganization(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 12_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#organization-shell-panel')).toBeVisible();
  await expect(page.locator('#docomator-integration')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#docomator-fields-panel')).toBeVisible({ timeout: 15_000 });
}

test('Оформлятор: предложенные и дополнительные поля сохраняются до каждого импорта', async ({ page }) => {
  let settings = {
    scheme: 'http', host: '', port: 8080, spaceId: null, groupId: null,
    includeInactive: false, lastStatus: 'unknown', lastCheckedAt: null,
    lastImportedAt: null, remoteVersion: null, lastError: null,
    emailPropertyKey: null, positionPropertyKey: null, extraPropertyKeys: []
  };
  let savedMapping = null;
  let importBody = null;
  let imports = 0;

  await page.route('**/api/integrations/docomator**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.method() === 'GET' ? {} : JSON.parse(request.postData() || '{}');
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
    }
    if (url.pathname === '/api/integrations/docomator' && request.method() === 'PUT') {
      savedMapping = {
        emailPropertyKey: body.emailPropertyKey || null,
        positionPropertyKey: body.positionPropertyKey || null,
        extraPropertyKeys: body.extraPropertyKeys || []
      };
      settings = { ...settings, ...body, accessCode: undefined };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
    }
    if (url.pathname === '/api/integrations/docomator/check') {
      const selected = body.spaceId === 'space-1';
      settings = { ...settings, host: '192.168.1.50', spaceId: selected ? 'space-1' : null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reachable: true, ready: true, authRequired: false, dataAvailable: true,
        remoteVersion: '0.6.6', endpoint: 'http://192.168.1.50:8080',
        spaces: [{ id: 'space-1', name: 'Кафедра' }], groups: [],
        peopleCount: selected ? 1 : null,
        peoplePreview: selected ? [{ id: 'remote-1', displayName: 'Иванов Иван', status: 'active' }] : [],
        properties: [], suggestedMappings: { emailPropertyKey: null, positionPropertyKey: null },
        settings
      }) });
    }
    if (url.pathname === '/api/integrations/docomator/fields/discover') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        properties: [
          { key: 'email', label: 'Электронная почта', valueType: 'string' },
          { key: 'phone', label: 'Телефон', valueType: 'string' },
          { key: 'position', label: 'Должность', valueType: 'string' }
        ],
        suggestedMappings: { emailPropertyKey: 'email', positionPropertyKey: 'position' }
      }) });
    }
    if (url.pathname === '/api/integrations/docomator/import') {
      imports += 1;
      importBody = body;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        stats: { total: 1, created: imports === 1 ? 1 : 0, updated: imports === 1 ? 0 : 1, matched: 0, skipped: 0 },
        fieldStats: { mapped: 2, extras: savedMapping?.extraPropertyKeys?.length || 0 }, imported: [],
        settings: { ...settings, lastImportedAt: '2026-08-26T18:00:00Z' }
      }) });
    }
    return route.continue();
  });

  await openOrganization(page);
  const section = page.locator('#docomator-integration');
  await section.locator('[name="host"]').fill('192.168.1.50');
  await section.locator('[name="accessCode"]').fill('1234');
  await section.locator('[data-docomator-check]').click();
  await expect(section.locator('#docomator-space')).toHaveValue('space-1', { timeout: 15_000 });

  await expect(section.locator('#docomator-email-field')).toHaveValue('email', { timeout: 15_000 });
  await expect(section.locator('#docomator-position-field')).toHaveValue('position');
  await expect(section.locator('#docomator-extra-fields')).toContainText('Телефон');

  // Оператор принимает автопредложение и сразу запускает импорт: mapping всё равно должен сохраниться первым.
  await expect(section.locator('[data-docomator-import]')).toBeEnabled({ timeout: 15_000 });
  await section.locator('[data-docomator-import]').click();
  await expect(section.locator('#docomator-status')).toContainText('Импорт завершён', { timeout: 15_000 });
  expect(savedMapping).toEqual({
    emailPropertyKey: 'email', positionPropertyKey: 'position', extraPropertyKeys: []
  });
  expect(importBody.spaceId).toBe('space-1');
  expect(importBody.accessCode).toBe('1234');

  // Затем оператор добавляет произвольное поле; повторный импорт должен использовать уже новый mapping.
  await section.locator('#docomator-extra-fields input[value="phone"]').check();
  await expect(section.locator('#docomator-extra-count')).toHaveText('1 выбрано');
  await expect.poll(() => savedMapping?.extraPropertyKeys || [], { timeout: 10_000 }).toEqual(['phone']);
  importBody = null;
  await section.locator('[data-docomator-import]').click();
  await expect.poll(() => imports, { timeout: 10_000 }).toBe(2);
  expect(savedMapping).toEqual({
    emailPropertyKey: 'email', positionPropertyKey: 'position', extraPropertyKeys: ['phone']
  });
  expect(importBody.accessCode).toBe('1234');
});
