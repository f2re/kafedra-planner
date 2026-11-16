import { test, expect } from '@playwright/test';

function workButton(page, testInfo) {
  return page.locator(`${testInfo.project.name === 'mobile' ? '.mobile-tab' : '.nav-item'}[data-view="work"]`).first();
}
const payload = title => ({ items: [{ id: 'audit-directive', title, sourceKind: 'directive', status: 'open', direction: 'science', eventDate: '2026-11-16' }] });
async function ready(page, testInfo) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.kafedraOpenStandaloneAssignment && document.querySelector('#work-create-periodic')));
  await workButton(page, testInfo).click();
  await expect(page.locator('#work-results')).toHaveAttribute('aria-busy', 'false');
}
async function emptyPeriodic(page) {
  await page.route('**/api/periodic-tasks?**', route => route.fulfill({ json: { items: [] } }));
}

test('поиск поручений: последний запрос побеждает, справочники не загружаются на ввод', async ({ page }, testInfo) => {
  // A transport that cannot cancel proves the sequence fence independently of AbortController.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (String(input).includes('/api/work/search')) {
        const { signal, ...options } = init;
        return original(input, options);
      }
      return original(input, init);
    };
  });
  let releaseSlow, slowStarted = false, slowDelivered = false;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  let peopleRequests = 0, documentRequests = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/people') peopleRequests++;
    if (url.pathname === '/api/documents' && url.searchParams.get('limit') === '500') documentRequests++;
  });
  await emptyPeriodic(page);
  await page.route('**/api/work/search**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'старый') { slowStarted = true; await slow; }
    await route.fulfill({ json: payload(query || 'Начальный список') });
    if (query === 'старый') slowDelivered = true;
  });
  await ready(page, testInfo);
  await expect.poll(() => peopleRequests).toBeGreaterThan(0);
  const before = { peopleRequests, documentRequests };
  const search = page.getByRole('searchbox', { name: 'Поиск поручений' });
  await search.fill('старый');
  await expect.poll(() => slowStarted).toBe(true);
  await search.fill('новый');
  await expect(page.locator('#work-results')).toContainText('новый');
  releaseSlow();
  await expect.poll(() => slowDelivered).toBe(true);
  await expect(page.locator('#work-results')).toContainText('новый');
  await expect(page.locator('#work-results')).not.toContainText('старый');
  await expect(page.locator('#work-results')).toContainText('В работе');
  await expect(page.locator('#work-results')).toContainText('Наука');
  expect({ peopleRequests, documentRequests }).toEqual(before);
});

test('ошибка поиска видна, повтор сохраняет запрос и выбор сотрудника', async ({ page }, testInfo) => {
  const person = await (await page.request.post('/api/people', { data: { displayName: `Поиск Сотрудник ${testInfo.project.name}` } })).json();
  let fail = false;
  await emptyPeriodic(page);
  await page.route('**/api/work/search**', route => fail
    ? route.fulfill({ status: 503, json: { error: { message: 'Поиск временно недоступен' } } })
    : route.fulfill({ json: payload('Сохранённая выдача') }));
  await ready(page, testInfo);
  await page.locator('#work-create-periodic').click();
  const owner = page.locator('#periodic-task-form select[name="ownerPersonId"]');
  await expect(owner.locator(`option[value="${person.id}"]`)).toHaveCount(1);
  await owner.selectOption(person.id);
  fail = true;
  const search = page.getByRole('searchbox', { name: 'Поиск поручений' });
  await search.fill('отчёт');
  await expect(page.locator('#work-load-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#work-load-status')).toContainText('Поиск временно недоступен');
  await expect(search).toHaveValue('отчёт');
  await expect(owner).toHaveValue(person.id);
  fail = false;
  await page.locator('[data-work-search-retry]').click();
  await expect(page.locator('#work-load-status')).toBeEmpty();
  await expect(search).toHaveValue('отчёт');
  await expect(owner).toHaveValue(person.id);
});

test('ошибка открытия карточки исправляется повтором без потери фильтра', async ({ page }, testInfo) => {
  let fail = true;
  await emptyPeriodic(page);
  await page.route('**/api/work/search**', route => route.fulfill({ json: payload('Проверяемое распоряжение') }));
  await page.route('**/api/directives/audit-directive', route => fail
    ? route.fulfill({ status: 503, json: { error: { message: 'Карточка временно недоступна' } } })
    : route.fulfill({ json: { id: 'audit-directive', title: 'Открытая карточка', assignments: [], directive_kind: 'Распоряжение' } }));
  await ready(page, testInfo);
  const search = page.getByRole('searchbox', { name: 'Поиск поручений' });
  await search.fill('распоряжение');
  await expect(page.locator('#work-results')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-work-id="audit-directive"]').click();
  await expect(page.locator('#work-open-status')).toContainText('Карточка временно недоступна');
  fail = false;
  await page.locator('[data-work-open-retry]').click();
  await expect(page.locator('#ux-inspector-body')).toContainText('Открытая карточка');
  await expect(search).toHaveValue('распоряжение');
});

test('смена сессии не возвращает позднюю выдачу прежнего пользователя', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (String(input).includes('/api/work/search')) {
        const { signal, ...options } = init;
        return original(input, options);
      }
      return original(input, init);
    };
  });
  let release, started = false, delivered = false;
  const pending = new Promise(resolve => { release = resolve; });
  await emptyPeriodic(page);
  await page.route('**/api/work/search**', async route => {
    if (new URL(route.request().url()).searchParams.get('q')) { started = true; await pending; }
    await route.fulfill({ json: payload('Сведения прежней сессии') });
    if (started) delivered = true;
  });
  await ready(page, testInfo);
  await page.getByRole('searchbox', { name: 'Поиск поручений' }).fill('задержка');
  await expect.poll(() => started).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kafedra-auth-changed', { detail: { authEnabled: true, authenticated: false } })));
  release();
  await expect.poll(() => delivered).toBe(true);
  await expect(page.locator('#work-results')).toBeEmpty();
  await expect(page.locator('#work-results')).toHaveAttribute('aria-busy', 'false');
});

test('смена сессии очищает открытую карточку и несохранённые поля поручений', async ({ page }, testInfo) => {
  await emptyPeriodic(page);
  await page.route('**/api/work/search**', route => route.fulfill({ json: payload('Сведения пользователя') }));
  await page.route('**/api/directives/audit-directive', route => route.fulfill({ json: { id: 'audit-directive', title: 'Открытые сведения пользователя', assignments: [], directive_kind: 'Распоряжение' } }));
  await ready(page, testInfo);
  await page.locator('[data-work-id="audit-directive"]').click();
  await expect(page.locator('#ux-inspector')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kafedra-auth-changed', { detail: { authEnabled: true, authenticated: false } })));
  await expect(page.locator('#ux-inspector')).toBeHidden();
  await expect(page.locator('#ux-inspector-body')).toBeEmpty();
  await expect(page.locator('#work-results')).toBeEmpty();
});
