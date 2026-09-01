import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('plans lifecycle is one visible desktop action over the existing state bridge', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = `
      <main>
        <section data-view="plans" data-plans-root>
          <div class="plans-toolbar">
            <label id="lifecycle-owner">Состояние
              <select id="plans-lifecycle-status">
                <option value="active" selected>В работе</option>
                <option value="archived">Архив</option>
              </select>
            </label>
            <input id="plan-search" type="search" value="кафедра">
          </div>
          <div id="plan-list"><p data-plans-empty>Планов по этим условиям нет.</p></div>
          <article id="plan-detail">Старый выбранный план</article>
        </section>
      </main>`;

    const source = document.querySelector('#plans-lifecycle-status');
    window.__lifecycleChanges = [];
    source.addEventListener('change', () => {
      window.__lifecycleChanges.push(source.value);
      document.querySelector('#plan-detail').textContent = '';
    });
    const module = await import(`/plans-lifecycle-desktop.js?browser=${Date.now()}`);
    module.installPlansLifecycleDesktop(document);
  });

  const segment = page.locator('#plans-lifecycle-segment');
  const current = segment.getByRole('tab', { name: 'Текущие' });
  const archive = segment.getByRole('tab', { name: 'Архив' });
  const source = page.locator('#plans-lifecycle-status');

  await expect(segment).toBeVisible();
  await expect(source).toBeHidden();
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(archive).toHaveAttribute('aria-selected', 'false');
  expect((await current.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await archive.click();
  await expect(source).toHaveValue('archived');
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plan-search')).toHaveValue('кафедра');
  await expect(page.locator('#plan-detail')).toHaveText('');
  await expect(page.locator('[data-plans-empty]')).toHaveText('Планов по этим условиям нет.');
  expect(await page.evaluate(() => window.__lifecycleChanges)).toEqual(['archived']);

  await archive.press('ArrowLeft');
  await expect(source).toHaveValue('active');
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.__lifecycleChanges)).toEqual(['archived', 'active']);
});

test('unfiltered desktop empty state follows the selected lifecycle mode', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = `
      <section data-view="plans" data-plans-root>
        <label>Состояние
          <select id="plans-lifecycle-status">
            <option value="active" selected>В работе</option>
            <option value="archived">Архив</option>
          </select>
        </label>
        <input id="plan-search" type="search" value="">
        <div id="plan-list"><p data-plans-empty>Планов по этим условиям нет.</p></div>
      </section>`;
    const module = await import(`/plans-lifecycle-desktop.js?empty=${Date.now()}`);
    module.installPlansLifecycleDesktop(document);
  });

  await expect(page.locator('[data-plans-empty]')).toHaveText('Текущих планов нет');
  await page.getByRole('tab', { name: 'Архив' }).click();
  await expect(page.locator('[data-plans-empty]')).toHaveText('Архив пуст');
});
