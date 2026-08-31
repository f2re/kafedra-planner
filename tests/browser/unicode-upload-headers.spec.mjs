import { test, expect } from '@playwright/test';

const uploadNames = [
  'План кафедры.xlsx',
  'Протокол заседания № 7.docx',
  'plan-кафедра-2026.xlsx',
  'план🙂.xlsx',
  `${'д'.repeat(240)}.pdf`
];

test.describe('Unicode-safe document upload headers', () => {
  test('normalizes idempotency keys before native Headers construction', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(async (names) => {
      const module = await import('/http-headers.js');
      const output = [];
      for (const name of names) {
        const raw = `action-center:document:${name}:4096:1788150000`;
        const key = module.normalizeIdempotencyHeader(raw);
        const headers = new Headers({
          'Idempotency-Key': raw,
          'X-File-Name': encodeURIComponent(name)
        });
        output.push({
          name,
          key,
          header: headers.get('idempotency-key'),
          encodedName: headers.get('x-file-name')
        });
      }
      return output;
    }, uploadNames);

    for (const result of results) {
      expect(result.key).toMatch(/^kp-v1-[a-f0-9]{64}$/);
      expect(result.header).toBe(result.key);
      expect(result.encodedName).toBe(encodeURIComponent(result.name));
    }
  });

  test('keeps retry key stable and separates different source names', async ({ page }) => {
    await page.goto('/');
    const values = await page.evaluate(async () => {
      const { normalizeIdempotencyHeader } = await import('/http-headers.js');
      const first = 'Документ🙂.pdf';
      const second = 'Документ-другой🙂.pdf';
      return {
        firstA: normalizeIdempotencyHeader(first),
        firstB: normalizeIdempotencyHeader(first),
        second: normalizeIdempotencyHeader(second)
      };
    });
    expect(values.firstA).toBe(values.firstB);
    expect(values.firstA).not.toBe(values.second);
  });
});
