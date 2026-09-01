import { expect } from '@playwright/test';

const MONTH_STEMS = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'май',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр'
];

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  if (!match) throw new Error(`Некорректная fixture-дата календаря: ${value}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Некорректная fixture-дата календаря: ${value}`);
  }
  return { year, monthIndex };
}

async function readDisplayedPeriod(page) {
  const title = page.locator('#calendar-title');
  await expect(title).toBeVisible();
  const value = String(await title.textContent() || '').trim().toLocaleLowerCase('ru-RU');
  const yearMatch = /\b(\d{4})\b/u.exec(value);
  const monthIndex = MONTH_STEMS.findIndex((stem) => value.includes(stem));
  if (!yearMatch || monthIndex < 0) {
    throw new Error(`Не удалось определить показанный период календаря: ${value}`);
  }
  return { year: Number(yearMatch[1]), monthIndex, title };
}

export async function navigateCalendarToDate(page, isoDate) {
  const target = parseIsoDate(isoDate);
  const current = await readDisplayedPeriod(page);
  const monthDistance = (target.year - current.year) * 12 + target.monthIndex - current.monthIndex;
  const periodButton = monthDistance < 0 ? '#previous-period' : '#next-period';

  for (let step = 0; step < Math.abs(monthDistance); step += 1) {
    await page.locator(periodButton).click();
  }

  await expect(current.title).toContainText(
    new RegExp(`${MONTH_STEMS[target.monthIndex]}.*${target.year}`, 'iu')
  );
}
