import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
await server.listen();
const port = server.httpServer.address().port;
const base = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const report = { patches: {}, errors: [] };
await fs.mkdir('logs/sfx', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + '/sfx-lab.html');
  await page.waitForFunction(() => Boolean(window.sfxLab));
  const ids = ['hit','canister','smash','coin','nitroReady','nitroStart','nitroEnd','nitroDry','rocketPrepare','rocketLaunch','rocketEnd','jump','land','slideStart','slideEnd','lane','nearMiss','combo','mode','gameOver','hoof'];
  for (const id of ids) {
    const result = await page.evaluate(id => window.sfxLab.renderPatch(id), id);
    assert.equal(result.metrics.nonFinite, 0, id + ': non-finite audio');
    assert.equal(result.metrics.clipped, 0, id + ': clipping');
    assert.ok(result.metrics.peak > 0.0001 && result.metrics.peak < 0.3, id + ': gain range');
    assert.ok(result.metrics.tailRms < 0.000001, id + ': unfinished tail');
    assert.equal(result.diagnostics.errors, 0);
    report.patches[id] = result;
  }
  assert.equal(new Set(Object.values(report.patches).map(r => r.metrics.hash)).size, ids.length, 'patches must differ');
  report.rocketSample = await page.evaluate(async () => {
    const { SfxEngine } = await import('/src/audio/sfx/SfxEngine.ts');
    const { sfxFallback } = await import('/src/core/sfx/defaults.ts');
    const { measureAudio } = await import('/src/audio/sfx/SfxOffline.ts');
    const results = [];
    for (const pause of [false, true]) {
      const ctx = new OfflineAudioContext(2, 44100 * 3, 44100);
      const engine = new SfxEngine(ctx, ctx.destination, sfxFallback);
      await engine.ready;
      engine.apply([{ type:'rocket', phase:'powered', offset:0 }], 0.1);
      if (pause) engine.silence(0.6);
      else {
        engine.apply([{ type:'rocket', phase:'fall', offset:0.7 }], 0.8);
        engine.apply([{ type:'rocket', phase:'fall', offset:0.9 }], 1);
        engine.apply([{ type:'rocket', phase:'off', offset:0 }], 2.4);
      }
      const buffer = await ctx.startRendering();
      const signal = measureAudio(buffer);
      const data = buffer.getChannelData(0);
      const stopTime = pause ? 0.65 : 2.55;
      let residual = 0;
      for (let i = Math.ceil(stopTime * 44100); i < data.length; i++) residual = Math.max(residual, Math.abs(data[i]));
      results.push({pause,signal,residual,diagnostics:engine.diagnostics}); engine.dispose();
    }
    return results;
  });
  for (const r of report.rocketSample) {
    assert.ok(r.signal.peak > 0.02, 'rocket turbo audible');
    assert.equal(r.signal.clipped, 0);
    assert.ok(r.residual < 1e-5, 'rocket stop/pause must end');
    assert.equal(r.diagnostics.nodes, 13);
    assert.equal(r.diagnostics.lastError, '');
  }
  report.demo = await page.evaluate(() => window.sfxLab.renderDemo());
  const repeat = await page.evaluate(() => window.sfxLab.renderDemo());
  assert.deepEqual(report.demo.diagnostics.director, repeat.diagnostics.director, 'scenario commands must be deterministic');
  assert.ok(Math.abs(report.demo.metrics.peak - repeat.metrics.peak) < 0.00001, 'render peak repeatability');
  assert.ok(Math.abs(report.demo.metrics.rms - repeat.metrics.rms) < 0.000001, 'render RMS repeatability');
  report.repeatRender = repeat.metrics;
  assert.equal(report.demo.metrics.clipped, 0);
  assert.equal(report.demo.metrics.nonFinite, 0);
  assert.ok(report.demo.metrics.peak < 0.3);
  assert.ok(report.demo.metrics.tailRms < 0.000001);
  assert.equal(report.demo.diagnostics.engine.nodes, 13, 'only static bus nodes remain');
  assert.equal(report.demo.diagnostics.engine.errors, 0);
  assert.ok(report.demo.diagnostics.engine.peakVoices <= 12);
  assert.ok(report.demo.diagnostics.engine.peakNodes < 240);

  await page.click('#demo');
  await page.waitForTimeout(500);
  await page.click('[data-patch="hit"]');
  await page.waitForTimeout(100);
  report.live = await page.evaluate(() => window.sfxLab.diagnostics());
  assert.ok(report.live.engine.beds > 0);
  assert.equal(report.live.engine.errors, 0);
  await page.click('#stop');
  await page.waitForTimeout(350);
  report.stopped = await page.evaluate(() => window.sfxLab.diagnostics());
  assert.equal(report.stopped.engine.voices, 0);
  assert.equal(report.stopped.engine.beds, 0);
  assert.equal(report.stopped.engine.retiring, 0);
  assert.equal(report.stopped.engine.nodes, 13);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.sfxLab.play('horse'));
    await page.waitForTimeout(130);
    await page.evaluate(() => window.sfxLab.stop());
    await page.waitForTimeout(100);
  }
  report.restarts = await page.evaluate(() => window.sfxLab.diagnostics());
  assert.equal(report.restarts.engine.nodes, 13);


  report.stress = await page.evaluate(async () => {
    const { SfxEngine } = await import('/src/audio/sfx/SfxEngine.ts');
    const { SfxDirector } = await import('/src/core/sfx/SfxDirector.ts');
    const { sfxFallback } = await import('/src/core/sfx/defaults.ts');
    const { SFX_IDS } = await import('/src/core/sfx/types.ts');
    const cfg = structuredClone(sfxFallback);
    cfg.masterGain = 0;
    for (const patch of Object.values(cfg.patches)) patch.cooldownMs = 0;
    const ctx = new AudioContext(); await ctx.resume();
    const engine = new SfxEngine(ctx, ctx.destination, cfg);
    const director = new SfxDirector(cfg);
    let sequence = 0;
    const state = {gameTime:0,mode:'car',speed:30,lane:2,laneX:0,y:0,airState:'grounded',nitroActive:true,nitroReady:false,sliding:false,rocketPhase:'none',combo:0,gameOver:false};
    for (let i=0;i<35;i++) {
      state.gameTime = i / 50;
      const events = SFX_IDS.filter(id=>id!=='gameOver').map(id=>({id,run:1,sequence:++sequence,gameTime:state.gameTime,mode:'car',speed:30,pan:0,strength:0.8,count:8}));
      engine.apply(director.tick(events,{state,phase:'running',tutorialScale:1},ctx.currentTime));
      await new Promise(r=>setTimeout(r,20));
    }
    const peak = engine.diagnostics;
    const policy = director.diagnostics;
    engine.silence();
    await new Promise(r=>setTimeout(r,150));
    const stopped = engine.diagnostics;
    engine.dispose(); await ctx.close();
    return {peak,policy,stopped};
  });
  assert.ok(report.stress.peak.peakVoices <= 12);
  assert.ok(report.stress.peak.peakNodes < 360);
  assert.ok(report.stress.policy.stolen > 0);
  assert.equal(report.stress.stopped.nodes, 13);
  assert.equal(report.stress.stopped.errors, 0);

  const download = page.waitForEvent('download');
  await page.click('#render');
  await (await download).saveAs('logs/sfx/runner-sfx-demo.wav');
  await page.screenshot({ path: 'logs/sfx/laboratory.png', fullPage: true });

  await page.goto(base + '/?dev=1');
  await page.waitForFunction(() => typeof window.runnerSfxDiagnostics === 'function');
  const sampleRate = 22050, seconds = 14, size = sampleRate * seconds * 2;
  const wav = Buffer.alloc(44 + size);
  wav.write('RIFF',0); wav.writeUInt32LE(36+size,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(sampleRate,24); wav.writeUInt32LE(sampleRate*2,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(size,40);
  for(let i=0;i<sampleRate*seconds;i++) wav.writeInt16LE(Math.round(Math.sin(i/sampleRate*Math.PI*2*220)*1200),44+i*2);
  await page.locator('input[type=file]').first().setInputFiles({name:'sfx-test.wav',mimeType:'audio/wav',buffer:wav});
  await page.waitForFunction(() => (window.runnerSfxDiagnostics().engine?.beds ?? 0) > 0, null, {timeout:15000});
  report.game = await page.evaluate(() => window.runnerSfxDiagnostics());
  assert.equal(report.game.engine.errors, 0);
  assert.equal(report.game.failure, null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  report.gamePaused = await page.evaluate(() => window.runnerSfxDiagnostics());
  assert.equal(report.gamePaused.engine.beds, 0);
  assert.equal(report.gamePaused.engine.voices, 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window.runnerSfxDiagnostics().engine?.beds ?? 0) > 0);
  report.gameResumed = await page.evaluate(() => window.runnerSfxDiagnostics());
  assert.equal(report.gameResumed.engine.errors, 0);
  assert.deepEqual(report.errors, []);
  console.log('SFX audio checks passed: 20 patches, deterministic 24 s demo, live mixing, restart cleanup, game load/pause/resume.');
  console.log(JSON.stringify({signal:report.demo.metrics,resources:report.demo.diagnostics.engine},null,2));
} finally {
  await fs.writeFile('logs/sfx/audio-report.json', JSON.stringify(report,null,2));
  await browser.close();
  await server.close();
}
