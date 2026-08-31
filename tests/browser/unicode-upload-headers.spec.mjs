import { test, expect } from '@playwright/test';

const cases = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } }
];

for (const current of cases) {
  test(`Unicode upload reaches API with bounded ASCII identity on ${current.name}`, async ({ page }) => {
    await page.setViewportSize(current.viewport);
    const observed = [];
    await page.route('**/api/documents', async (route) => {
      observed.push(route.request().headers()['idempotency-key'] || '');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'doc-unicode', versionId: 'ver-unicode' })
      });
    });
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const transport = await import('/http-headers.js');
      transport.installUnicodeSafeHeaders(globalThis);
      const name = `План кафедры 📄 ${'очень-длинное-имя-'.repeat(16)}.docx`;
      const rawIdentity = `upload:${name}:application/vnd.openxmlformats-officedocument.wordprocessingml.document:12`;
      const file = new File([new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0])], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      const send = async () => {
        const body = new FormData();
        body.append('file', file, file.name);
        const headers = new Headers({ 'idempotency-key': rawIdentity });
        const response = await fetch('/api/documents', { method: 'POST', headers, body });
        return response.status;
      };
      return {
        fileName: file.name,
        fileSize: file.size,
        statuses: [await send(), await send()]
      };
    });

    expect(result.fileName).toContain('План кафедры 📄');
    expect(result.fileSize).toBe(12);
    expect(result.statuses).toEqual([201, 201]);
    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(observed[1]);
    expect(observed[0]).toMatch(/^kp-v1-[a-f0-9]{64}$/u);
    expect(observed[0].length).toBeLessThanOrEqual(80);
    expect([...observed[0]].every((character) => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) <= 0x7e)).toBe(true);
  });
}
