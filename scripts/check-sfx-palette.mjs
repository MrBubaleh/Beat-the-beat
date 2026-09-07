import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
await server.listen();
const base = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const report = { comparisons: {}, errors: [] };
await fs.mkdir('logs/sfx/palette', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(base + '/sfx-lab.html');
  await page.waitForFunction(() => Boolean(window.sfxLab));
  for (const id of ['hit','canister','smash','coin','motor','hoof']) {
    const pair = await page.evaluate(id => window.sfxLab.renderComparison(id), id);
    for (const version of ['before','after']) {
      const r = pair[version];
      assert.equal(r.nonFinite, 0, id + ': non-finite audio');
      assert.equal(r.clipped, 0, id + ': clipping');
      assert.ok(r.peak > 0.001 && r.peak < 0.5, id + ': raw peak');
      assert.ok(r.tailRms < 1e-6, id + ': tail');
      assert.equal(r.diagnostics.nodes, 13, id + ': cleanup');
      assert.equal(r.diagnostics.errors, 0, id + ': engine error');
    }
    assert.notEqual(pair.before.hash, pair.after.hash);
    const deltaDb = Math.abs(20 * Math.log10(pair.matchedWeightedRms[0] / pair.matchedWeightedRms[1]));
    assert.ok(deltaDb < 0.1, id + ': level matching');
    assert.ok(Math.max(pair.before.peak * pair.gains[0], pair.after.peak * pair.gains[1]) <= 0.451, id + ': comparison peak');
    report.comparisons[id] = pair;
    const download = page.waitForEvent('download');
    await page.evaluate(id => window.sfxLab.downloadComparison(id), id);
    await (await download).saveAs('logs/sfx/palette/' + id + '-A-B.wav');
  }
  await page.selectOption('#compareSound','canister');
  await page.click('#compareBefore');
  await page.waitForFunction(() => document.querySelector('#compareStatus').textContent.startsWith('A ·'));
  await page.click('#compareAfter');
  await page.waitForFunction(() => document.querySelector('#compareStatus').textContent.startsWith('B ·'));
  await page.uncheck('#matchLevel');
  await page.click('#compareAfter');
  await page.waitForFunction(() => document.querySelector('#compareStatus').textContent.includes('исходный игровой баланс'));
  await page.click('#stop');
  report.cancelled = await page.evaluate(async () => {
    const pending = window.sfxLab.compare('motor','after');
    window.sfxLab.stop();
    await pending;
    return window.sfxLab.diagnostics().comparisonPlaying;
  });
  assert.equal(report.cancelled, false, 'stop must cancel comparison while context resume is pending');
  await page.screenshot({ path: 'logs/sfx/palette/laboratory.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile overflow');
  report.variantChecks = await page.evaluate(async () => {
    const { sfxFallback } = await import('/src/core/sfx/defaults.ts');
    const { SfxEngine } = await import('/src/audio/sfx/SfxEngine.ts');
    const { measureAudio } = await import('/src/audio/sfx/SfxOffline.ts');
    const results = [];
    for (const sampleRate of [22050, 48000]) {
      const cfg = structuredClone(sfxFallback);
      cfg.palette.coin.fmDepth = 3;
      cfg.patches.coin.partials = [1];
      cfg.palette.smash.fragments = 6;
      const ctx = new OfflineAudioContext(2, sampleRate * 2, sampleRate);
      const engine = new SfxEngine(ctx, ctx.destination, cfg);
      for (const [index, event] of ['coin','smash','hoof','hit'].entries()) {
        const patch = cfg.patches[event];
        engine.apply([{ type:'start', voice:{voiceId:index+1,event,mode:'horse',surface:'metal',bus:patch.bus,gain:patch.gain,
          pitch:1.12,pan:0.3,strength:1,duration:(patch.attackMs+patch.decayMs+patch.tailMs)/1000,at:0.1+index*0.2}}],0);
      }
      const buffer = await ctx.startRendering();
      const diagnostics = engine.diagnostics;
      engine.dispose(); results.push({ sampleRate, signal:measureAudio(buffer), diagnostics });
    }
    return results;
  });
  for (const result of report.variantChecks) {
    assert.equal(result.signal.nonFinite,0);
    assert.equal(result.signal.clipped,0);
    assert.equal(result.diagnostics.errors,0);
    assert.equal(result.diagnostics.nodes,13);
  }
  assert.deepEqual(report.errors, []);
  console.log('SFX palette passed: six A/B scenes, matched levels, export, switching, mobile layout, 22/48 kHz and material variants.');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.comparisons).map(([id,r]) => [id, {
    beforeRms:r.before.weightedRms,afterRms:r.after.weightedRms,peak:r.after.peak,matched:r.matchedWeightedRms
  }])), null, 2));
} finally {
  await fs.writeFile('logs/sfx/palette/report.json', JSON.stringify(report,null,2));
  await browser.close(); await server.close();
}