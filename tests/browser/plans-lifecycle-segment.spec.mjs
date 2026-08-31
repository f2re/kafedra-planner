import { test, expect } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

async function mountFixture(page, suffix) {
  return page.evaluate(async (id) => {
    const old = document.querySelector('[data-plans-root="lifecycle-test"]');
    old?.remove();
    const root = document.createElement('section');
    root.dataset.plansRoot = 'lifecycle-test';
    root.innerHTML = `
      <h2>Планы</h2>
      <div class="plans-toolbar-filter">
        <label>Состояние
          <select id="plan-lifecycle-${id}" name="lifecycle">
            <option value="active">В работе</option>
            <option value="archived">Архив</option>
          </select>
        </label>
      </div>
      <input data-test-search value="Приёмная кампания">
    `;
    document.body.append(root);
    const select = root.querySelector('select');
    let changes = 0;
    select.addEventListener('change', () => { changes += 1; });
    const module = await import(`/plans-lifecycle-segment.js?test=${id}`);
    const segment = module.enhanceLifecycleSelect(select);
    globalThis.__plansLifecycleChanges = () => changes;
    return {
      segmentId: segment?.id || '',
      sourceHidden: select.hidden,
      search: root.querySelector('[data-test-search]').value
    };
  }, suffix);
}

for (const viewport of viewports) {
  test(`current/archive is one action on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    const mounted = await mountFixture(page, `${viewport.name}-${Date.now()}`);
    expect(mounted.segmentId).not.toBe('');
    expect(mounted.sourceHidden).toBe(true);
    expect(mounted.search).toBe('Приёмная кампания');

    const root = page.locator('[data-plans-root="lifecycle-test"]');
    const segment = root.locator('.plans-lifecycle-segment');
    const current = segment.locator('[data-lifecycle-view="current"]');
    const archived = segment.locator('[data-lifecycle-view="archived"]');
    await expect(segment).toHaveAttribute('role', 'tablist');
    await expect(current).toHaveAttribute('aria-selected', 'true');
    await expect(archived).toHaveAttribute('aria-selected', 'false');

    const currentBox = await current.boundingBox();
    const archivedBox = await archived.boundingBox();
    expect(currentBox?.height || 0).toBeGreaterThanOrEqual(44);
    expect(archivedBox?.height || 0).toBeGreaterThanOrEqual(44);

    await archived.click();
    await expect(archived).toHaveAttribute('aria-selected', 'true');
    await expect(current).toHaveAttribute('aria-selected', 'false');
    await expect(root.locator('select')).toHaveValue('archived');
    await expect(root.locator('[data-test-search]')).toHaveValue('Приёмная кампания');
    expect(await page.evaluate(() => globalThis.__plansLifecycleChanges())).toBe(1);

    await archived.focus();
    await archived.press('ArrowLeft');
    await expect(current).toBeFocused();
    await expect(current).toHaveAttribute('aria-selected', 'true');
    await expect(root.locator('select')).toHaveValue('active');
    expect(await page.evaluate(() => globalThis.__plansLifecycleChanges())).toBe(2);
  });

  test(`lifecycle segment respects reduced motion on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await mountFixture(page, `reduced-${viewport.name}-${Date.now()}`);
    const button = page.locator('[data-plans-root="lifecycle-test"] [data-lifecycle-view="archived"]');
    await expect(button).toBeVisible();
    const duration = await button.evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(duration.split(',').every((value) => value.trim() === '0s')).toBe(true);
  });
}

test('rerendered source select receives one replacement segment without duplicates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await mountFixture(page, `first-${Date.now()}`);
  await page.evaluate(async () => {
    const module = await import('/plans-lifecycle-segment.js');
    const root = document.querySelector('[data-plans-root="lifecycle-test"]');
    root.querySelector('.plans-toolbar-filter').innerHTML = `
      <label>Состояние
        <select id="plan-lifecycle-rerendered" name="lifecycle">
          <option value="active">Текущие</option>
          <option value="archived">Архив</option>
        </select>
      </label>`;
    module.installPlansLifecycleSegment(root);
  });
  const root = page.locator('[data-plans-root="lifecycle-test"]');
  await expect(root.locator('.plans-lifecycle-segment')).toHaveCount(1);
  await expect(root.locator('[data-lifecycle-view="archived"]')).toBeVisible();
});
