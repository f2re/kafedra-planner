import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('desktop lifecycle segment reuses server status, preserves search and clears stale detail', async ({ page }) => {
  const requests = [];
  await page.route('**/api/plans?**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.get('status'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <main>
        <section id="plans-view" data-view="plans">
          <div class="plans-toolbar" data-plan-filters>
            <label>Поиск <input id="plans-search" value="деканат"></label>
            <label id="lifecycle-owner">Состояние
              <select id="plans-lifecycle-status">
                <option value="active">Текущие</option>
                <option value="archived">Архив</option>
              </select>
            </label>
          </div>
          <div class="empty-state">Планов по этим условиям нет.</div>
          <article id="plan-detail">Старый выбранный план</article>
        </section>
      </main>`;

    const select = document.getElementById('plans-lifecycle-status');
    select.addEventListener('change', async () => {
      const response = await fetch(`/api/plans?status=${encodeURIComponent(select.value)}`);
      const plans = await response.json();
      if (plans.length === 0) document.getElementById('plan-detail').textContent = '';
    });
  });

  const segment = page.locator('#plans-lifecycle-segment');
  await expect(segment).toBeVisible();
  await expect(segment).toHaveAttribute('role', 'tablist');

  const current = segment.getByRole('tab', { name: 'Текущие' });
  const archive = segment.getByRole('tab', { name: 'Архив' });
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(archive).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#plans-lifecycle-status')).toBeHidden();
  await expect(page.locator('#plans-lifecycle-status')).toHaveAttribute('aria-hidden', 'true');

  await archive.click();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plans-search')).toHaveValue('деканат');
  await expect(page.locator('#plan-detail')).toBeEmpty();
  await expect(page.locator('.empty-state')).toHaveText('Планов по этим условиям нет.');
  await expect.poll(() => requests.at(-1)).toBe('archived');

  await page.locator('#plans-search').fill('');
  await current.click();
  await expect(page.locator('.empty-state')).toHaveText('Текущих планов нет');
  await expect.poll(() => requests.at(-1)).toBe('active');

  await current.focus();
  await page.keyboard.press('ArrowRight');
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.empty-state')).toHaveText('Архив пуст');
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
});
