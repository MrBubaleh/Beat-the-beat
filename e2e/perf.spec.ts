import { expect, test } from '@playwright/test';

test('performance probe: samples frame time, fps, draw calls and active objects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.keyboard.press('F3');
  const overlay = page.locator('div:has-text("frame")').first();
  await expect(overlay).toBeVisible();

  const samples: { frame: number; fps: number; draws: number; obj: number }[] = [];
  for (let i = 0; i < 60; i++) {
    const text = (await overlay.textContent()) ?? '';
    const read = (pattern: RegExp): number => Number(text.match(pattern)?.[1] ?? NaN);
    const frame = read(/frame\s+([\d.]+)/);
    if (Number.isFinite(frame)) {
      samples.push({
        frame,
        fps: read(/fps\s+([\d.]+)/),
        draws: read(/draws\s+(\d+)/),
        obj: read(/obj\s+(\d+)/),
      });
    }
    await page.waitForTimeout(100);
  }

  expect(samples.length).toBeGreaterThan(10);
  const avg = (key: 'frame' | 'fps' | 'draws' | 'obj'): number =>
    samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const max = (key: 'frame' | 'draws'): number =>
    Math.max(...samples.map((s) => s[key]));

  console.log(
    `PERF avg_frame=${avg('frame').toFixed(1)}ms max_frame=${max('frame').toFixed(1)}ms ` +
      `avg_fps=${avg('fps').toFixed(0)} avg_draws=${avg('draws').toFixed(0)} ` +
      `max_draws=${max('draws')} avg_obj=${avg('obj').toFixed(1)}`,
  );

  expect(avg('frame')).toBeLessThan(50);
  expect(avg('draws')).toBeLessThan(400);
  expect(errors).toEqual([]);
});
