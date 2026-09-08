import { expect, test } from '@playwright/test';

function wav(silent = false): Buffer {
  const rate = 12000;
  const frames = rate * 40;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  if (!silent) for (let beat = 1; beat < 80; beat++) for (let j = 0; j < 240; j++) {
    buffer.writeInt16LE(Math.round(Math.sin(j * 0.4) * Math.exp(-j / 50) * 26000), 44 + (beat * 6000 + j) * 2);
  }
  return buffer;
}

test('uploaded track prepares, starts, pauses and reloads with safe silence fallback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?dev=1&seed=42');
  await page.getByRole('button', { name: 'свой файл', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'rhythm.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.locator('.menu-root')).toBeHidden({ timeout: 15000 });
  const source = page.locator('video[src^="blob:"]');
  await expect.poll(() => source.evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 10000 }).toBeGreaterThan(1);
  await page.keyboard.press('F3');
  await expect(page.locator('body')).toContainText('warmup decoded');
  await page.keyboard.press('Escape');
  await expect.poll(() => source.evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
  const pausedTime = await source.evaluate(video => (video as HTMLVideoElement).currentTime);
  await page.waitForTimeout(300);
  expect(await source.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeCloseTo(pausedTime, 2);
  await page.keyboard.press('Escape');
  await expect.poll(() => source.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(pausedTime + 0.2);
  await page.locator('input[type=file]').setInputFiles({ name: 'silence.wav', mimeType: 'audio/wav', buffer: wav(true) });
  await expect(page.locator('.menu-root')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => source.evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 10000 }).toBeGreaterThan(1);
  await expect(page.locator('body')).toContainText('warmup fallback');
  expect(errors).toEqual([]);
});
