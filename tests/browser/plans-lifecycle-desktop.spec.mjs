import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('desktop lifecycle segment delegates to the existing select and restores it below the breakpoint', async ({ page }) => {
  const requests = [];
  await page.route('**/api/plans?**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.get('status'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.KafedraPlansLifecycleDesktop))).toBe(true);

  await page.evaluate(() => {
    window.KafedraPlansLifecycleDesktop.destroyPlansLifecycleDesktop();
    document.body.innerHTML = `
      <main>
        <section data-view-panel="plans" class="plans-view">
          <div class="plans-filterbar" data-plan-filters>
            <label>Поиск <input id="plans-q" value="деканат"></label>
            <label id="lifecycle-owner" aria-hidden="false" tabindex="4">Состояние
              <select id="plans-lifecycle-status" aria-hidden="false" tabindex="3">
                <option value="active">Текущие</option>
                <option value="archived">Архив</option>
              </select>
            </label>
          </div>
          <div id="plans-list" class="plans-list"><div class="empty-state">Планов по этим условиям нет.</div></div>
          <article id="plan-detail">Старый выбранный план</article>
        </section>
      </main>`;

    const select = document.getElementById('plans-lifecycle-status');
    select.addEventListener('change', async () => {
      const response = await fetch(`/api/plans?status=${encodeURIComponent(select.value)}`);
      const plans = await response.json();
      if (Array.isArray(plans) && plans.length === 0) document.getElementById('plan-detail').textContent = '';
    });
    window.KafedraPlansLifecycleDesktop.installPlansLifecycleDesktop();
    window.KafedraPlansLifecycleDesktop.installPlansLifecycleDesktop();
  });
  requests.splice(0);

  const segment = page.locator('#plans-lifecycle-segment');
  const source = page.locator('#plans-lifecycle-status');
  const owner = page.locator('#lifecycle-owner');
  await expect(segment).toHaveCount(1);
  await expect(segment).toBeVisible();
  await expect(segment).toHaveAttribute('role', 'tablist');

  const current = segment.getByRole('tab', { name: 'Текущие' });
  const archive = segment.getByRole('tab', { name: 'Архив' });
  await expect(current).toHaveAttribute('data-lifecycle-view', 'active');
  await expect(archive).toHaveAttribute('data-lifecycle-view', 'archived');
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(current).toHaveAttribute('tabindex', '0');
  await expect(archive).toHaveAttribute('aria-selected', 'false');
  await expect(archive).toHaveAttribute('tabindex', '-1');
  await expect(source).toBeHidden();
  await expect(source).toHaveAttribute('aria-hidden', 'true');
  await expect(owner).toBeHidden();

  await archive.click();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(source).toHaveValue('archived');
  await expect(page.locator('#plans-q')).toHaveValue('деканат');
  await expect(page.locator('#plan-detail')).toBeEmpty();
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Планов по этим условиям нет.');
  await expect.poll(() => requests.at(-1)).toBe('archived');

  await page.locator('#plans-q').fill('');
  await current.click();
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Текущих планов нет');
  await expect.poll(() => requests.at(-1)).toBe('active');

  await current.focus();
  await page.keyboard.press('ArrowRight');
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Архив пуст');
  await expect.poll(() => requests.at(-1)).toBe('archived');

  const requestCount = requests.length;
  await archive.click();
  await expect.poll(() => requests.length).toBe(requestCount);

  const sizes = await segment.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => {
    const box = tab.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  for (const size of sizes) {
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.width).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(segment).toBeVisible();
  await expect(page.locator('#plans-lifecycle-segment')).toHaveCount(1);

  await page.setViewportSize({ width: 720, height: 900 });
  await expect(page.locator('#plans-lifecycle-segment')).toHaveCount(0);
  await expect(source).toBeVisible();
  await expect(owner).toBeVisible();
  await expect(source).toHaveAttribute('aria-hidden', 'false');
  await expect(source).toHaveAttribute('tabindex', '3');
  await expect(owner).toHaveAttribute('aria-hidden', 'false');
  await expect(owner).toHaveAttribute('tabindex', '4');
  await expect(source).toHaveValue('archived');
  await expect.poll(() => requests.length).toBe(requestCount);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#plans-lifecycle-segment')).toHaveCount(1);
  await expect(page.locator('#plans-lifecycle-segment')).toBeVisible();
  await expect(page.locator('#plans-lifecycle-segment').getByRole('tab', { name: 'Архив' })).toHaveAttribute('aria-selected', 'true');
  await expect(source).toBeHidden();
  await expect.poll(() => requests.length).toBe(requestCount);
});
