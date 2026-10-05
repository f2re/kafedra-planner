import { test, expect } from '@playwright/test';
import { r2Cases } from './helpers/r2-editing-cases.mjs';
for (const [name,run] of r2Cases) test(name, async ({page}) => { await run({page,expect}); });
