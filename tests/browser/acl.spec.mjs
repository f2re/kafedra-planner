import { test, expect } from '@playwright/test';

async function login(page, username, password) {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await page.locator('#auth-login-form input[name="username"]').fill(username);
  await page.locator('#auth-login-form input[name="password"]').fill(password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();
}

async function logout(page) {
  await page.locator('.auth-user-button').click();
  await expect(page.locator('[data-auth-action="logout"]')).toBeVisible();
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('[data-auth-action="logout"]').click()
  ]);
  await expect(page.locator('#auth-gate')).toBeVisible();
}

test('объектная ACL закрывает прямой URL и поиск и поддерживает явный грант', async ({ page }) => {
  await login(page, 'staff', 'StaffPassword2026');

  const documents = await page.request.get('/api/documents');
  expect(documents.status()).toBe(200);
  const documentPayload = await documents.json();
  expect(documentPayload.items.map((item) => item.id)).toContain('doc-staff');
  expect(documentPayload.items.map((item) => item.id)).not.toContain('doc-outsider');

  expect((await page.request.get('/api/documents/doc-staff')).status()).toBe(200);
  expect((await page.request.get('/api/documents/doc-outsider')).status()).toBe(403);
  expect((await page.request.get('/api/documents/doc-outsider/content?variant=original')).status()).toBe(403);

  const hiddenSearch = await page.request.get('/api/search?q=%D0%A7%D0%A3%D0%96%D0%9E%D0%99%D0%A1%D0%95%D0%9A%D0%A0%D0%95%D0%A2');
  expect(hiddenSearch.status()).toBe(200);
  expect((await hiddenSearch.json()).items).toHaveLength(0);

  const ownSearch = await page.request.get('/api/search?q=%D0%9C%D0%9E%D0%99%D0%94%D0%9E%D0%9A%D0%A3%D0%9C%D0%95%D0%9D%D0%A2');
  expect(ownSearch.status()).toBe(200);
  expect((await ownSearch.json()).items.some((item) => item.source_id === 'ver-staff')).toBe(true);

  const scienceBefore = await page.request.get('/api/science');
  expect(scienceBefore.status()).toBe(200);
  expect((await scienceBefore.json()).items.map((item) => item.id)).not.toContain('science-outsider');

  await logout(page);
  await login(page, 'manager', 'ManagerPass2026');
  expect((await page.request.get('/api/documents/doc-staff')).status()).toBe(200);
  expect((await page.request.get('/api/documents/doc-outsider')).status()).toBe(403);

  await logout(page);
  await login(page, 'admin', 'AdminPassword2026');
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.csrfToken).toBeTruthy();

  const documentGrant = await page.request.put('/api/admin/access/document/doc-outsider', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: {
      ownerPersonId: 'person-outsider',
      accessScope: 'restricted',
      grants: [{ personId: 'person-staff', role: 'reader' }]
    }
  });
  expect(documentGrant.status()).toBe(200);
  const documentExplanation = await documentGrant.json();
  expect(documentExplanation.policy.owner_person_id).toBe('person-outsider');
  expect(documentExplanation.grants.some((grant) =>
    grant.person_id === 'person-staff' && grant.access_role === 'reader'
  )).toBe(true);

  const scienceGrant = await page.request.put('/api/admin/access/scientific_item/science-outsider', {
    headers: { 'x-csrf-token': me.csrfToken },
    data: {
      ownerPersonId: 'person-outsider',
      accessScope: 'restricted',
      grants: [{ personId: 'person-staff', role: 'reader' }]
    }
  });
  expect(scienceGrant.status()).toBe(200);

  await logout(page);
  await login(page, 'staff', 'StaffPassword2026');
  expect((await page.request.get('/api/documents/doc-outsider')).status()).toBe(200);
  expect((await page.request.get('/api/documents/doc-outsider/content?variant=original')).status()).toBe(200);
  const scienceAfter = await page.request.get('/api/science');
  expect(scienceAfter.status()).toBe(200);
  expect((await scienceAfter.json()).items.map((item) => item.id)).toContain('science-outsider');
});
