import { test, expect } from '@playwright/test';

async function resetAcrossMobileReflow(page, resetButton) {
  await resetButton.scrollIntoViewIfNeeded();
  const box = await resetButton.boundingBox();
  if (!box) throw new Error('Кнопка сброса недоступна для мобильной проверки.');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const viewport = page.viewportSize();
  if (!viewport || point.x < 0 || point.x >= viewport.width || point.y < 0 || point.y >= viewport.height) {
    throw new Error('Кнопка сброса после прокрутки осталась вне мобильного viewport.');
  }
  const hitReset = await page.evaluate(({ x, y }) => {
    const button = document.querySelector('[data-search-reset]');
    return document.elementFromPoint(x, y)?.closest('[data-search-reset]') === button;
  }, point);
  if (!hitReset) throw new Error('Кнопка сброса перекрыта в точке мобильного касания.');

  await page.evaluate(() => {
    window.__searchResetPointerDown = null;
    document.querySelector('[data-search-reset]')?.addEventListener('pointerdown', (event) => {
      window.__searchResetPointerDown = { pointerId: event.pointerId, button: event.button, isPrimary: event.isPrimary };
    }, { capture: true, once: true });
  });

  const session = await page.context().newCDPSession(page);
  let touchActive = false;
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, radiusX: 2, radiusY: 2, force: 1, id: 1 }]
    });
    touchActive = true;
    const pointerDown = await page.evaluate(() => window.__searchResetPointerDown);
    if (!pointerDown?.isPrimary || pointerDown.button !== 0) {
      throw new Error(`Мобильное касание не породило ожидаемый primary pointerdown: ${JSON.stringify(pointerDown)}`);
    }
    const captured = await page.evaluate((pointerId) => {
      const button = document.querySelector('[data-search-reset]');
      return Boolean(button?.hasPointerCapture?.(pointerId));
    }, pointerDown.pointerId);
    if (!captured) throw new Error('Кнопка сброса не захватила активный pointer до перестроения интерфейса.');

    const shiftedBox = await page.evaluate(() => {
      const button = document.querySelector('[data-search-reset]');
      const actions = button?.closest('.search-filter-actions');
      if (!button || !actions) return null;
      const spacer = document.createElement('div');
      spacer.id = 'search-reset-reflow-blocker';
      spacer.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 40; index += 1) spacer.append(document.createElement('br'));
      actions.before(spacer);
      const rect = button.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    if (!shiftedBox || Math.abs(shiftedBox.y - box.y) < 40) {
      throw new Error('Мобильная компоновка не изменилась во время активного касания.');
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    touchActive = false;
  } finally {
    if (touchActive) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {});
    }
    await page.evaluate(() => {
      document.querySelector('#search-reset-reflow-blocker')?.remove();
      delete window.__searchResetPointerDown;
    }).catch(() => {});
    await session.detach().catch(() => {});
  }
}

test('единый поиск фильтрует периодическую задачу без текстового запроса и сбрасывается одним действием', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.includes('mobile') ? 'моб' : 'деск';
  const searchText = `проверка поиска ${suffix}`;
  const personResponse = await page.request.post('/api/people', {
    data: { displayName: `Петров Фасетный ${suffix}` }
  });
  expect(personResponse.ok()).toBeTruthy();
  const person = await personResponse.json();
  const taskResponse = await page.request.post('/api/periodic-tasks', {
    data: {
      ownerPersonId: person.id,
      title: `Семестровая проверка поиска ${suffix}`,
      periodKind: 'semester', periodKey: '2026-1',
      startsAt: '2026-08-18', dueDate: '2026-09-15', direction: 'education'
    }
  });
  expect(taskResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.evaluate(() => window.kafedraSetView('search'));
  await expect(page.locator('[data-view-panel="search"]')).toBeVisible();
  const filters = page.locator('#search-filters');
  await expect(filters).toBeVisible();
  await filters.locator('select[name="sourceKind"]').selectOption('periodic_task');
  await filters.locator('input[name="person"]').fill('Петров Фасетный');
  await filters.locator('input[name="period"]').fill('2026-1');

  const result = page.locator('#search-results .search-result-next').filter({ hasText: `Семестровая проверка поиска ${suffix}` }).first();
  await expect(result).toBeVisible();
  await expect(result).toContainText('Периодическая задача');
  await expect(result).toContainText('2026-09-15');
  await expect(result).toContainText('2026-1');
  await expect(page.locator('#search-count')).toContainText('Найдено:');

  const resetButton = filters.getByRole('button', { name: 'Сбросить' });
  if (testInfo.project.name.includes('mobile')) await resetAcrossMobileReflow(page, resetButton);
  else await resetButton.click();
  await expect(page.locator('#search-results')).toContainText('Введите текст или выберите один из фильтров');
  await expect(filters.locator('select[name="sourceKind"]')).toHaveValue('');
  await expect(filters.locator('input[name="person"]')).toHaveValue('');
  await expect(filters.locator('input[name="period"]')).toHaveValue('');

  const searchInput = page.locator('#search-input');
  await page.evaluate((match) => {
    const originalFetch = window.fetch.bind(window);
    const harness = { match, delayNext: true, started: false, signal: null };
    window.__searchAbortHarness = harness;
    window.fetch = (input, options = {}) => {
      const url = new URL(String(input), window.location.href);
      if (harness.delayNext && url.pathname === '/api/search' && url.searchParams.get('q') === harness.match) {
        harness.delayNext = false;
        harness.started = true;
        harness.signal = options.signal || null;
        return new Promise((_resolve, reject) => {
          if (!options.signal) return;
          if (options.signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return originalFetch(input, options);
    };
  }, searchText);

  await searchInput.fill(searchText);
  await page.waitForFunction(() => window.__searchAbortHarness?.started === true);
  await resetButton.click();
  const aborted = await page.evaluate(() => window.__searchAbortHarness?.signal?.aborted === true);
  expect(aborted).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('#search-results')).toContainText('Введите текст или выберите один из фильтров');
  await expect(page.locator('#search-count')).toHaveText('');

  await searchInput.fill(searchText);
  await expect(result).toBeVisible();
  await resetButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-results')).toContainText('Введите текст или выберите один из фильтров');
  await expect(searchInput).toHaveValue('');
});
