import { expect, test } from '@playwright/test';

test('app boots, renders the 3D view, and the game runs without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible();

  await page.keyboard.press('F3');
  const overlay = page.locator('div:has-text("fps")').first();
  await expect(overlay).toBeVisible();

  const readDist = async (): Promise<number> => {
    const text = await overlay.textContent();
    const match = text?.match(/dist\s+(\d+)/);
    return match ? Number(match[1]) : NaN;
  };

  const dist1 = await readDist();
  await page.waitForTimeout(2000);
  const dist2 = await readDist();
  expect(Number.isFinite(dist1)).toBe(true);
  expect(dist2).toBeGreaterThan(dist1);

  expect(errors).toEqual([]);
});
