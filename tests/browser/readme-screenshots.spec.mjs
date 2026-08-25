import { test, expect } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function readmeImages(markdown) {
  return [...markdown.matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)\s]+)\)/gu)]
    .map((match) => match[1]);
}

test('README: все локальные скриншоты существуют и реально декодируются Chromium', async ({ page }) => {
  const markdown = await readFile(resolve('README.md'), 'utf8');
  const images = [...new Set(readmeImages(markdown))];
  expect(images.length).toBeGreaterThanOrEqual(5);

  for (const relativePath of images) {
    const path = resolve(relativePath);
    const info = await stat(path);
    expect(info.isFile(), relativePath).toBe(true);
    expect(info.size, relativePath).toBeGreaterThan(128);
    const mime = MIME[extname(path).toLocaleLowerCase()];
    expect(mime, `Неподдерживаемый формат README-изображения: ${relativePath}`).toBeTruthy();
    const bytes = await readFile(path);
    const source = `data:${mime};base64,${bytes.toString('base64')}`;
    await page.setContent(`<img id="probe" alt="" src="${source}">`);
    const decoded = await page.locator('#probe').evaluate(async (image) => {
      await image.decode();
      return {
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight
      };
    });
    expect(decoded.complete, relativePath).toBe(true);
    expect(decoded.width, `${relativePath}: ширина после decode`).toBeGreaterThan(0);
    expect(decoded.height, `${relativePath}: высота после decode`).toBeGreaterThan(0);
  }
});
