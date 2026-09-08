import fs from 'node:fs';
function edit(p,a,b){const s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');if(!s.includes(a))throw Error(p+': '+a.slice(0,60));fs.writeFileSync(p,s.replace(a,b));}
edit('src/audio/AudioWorkletAnalyzer.ts','  private clock: AudioClock | null = null;','  private clock: AudioClock | null = null;\n  private source: AudioNode | null = null;');
edit('src/audio/AudioWorkletAnalyzer.ts','    sourceNode.connect(this.node);','    this.source = sourceNode;\n    sourceNode.connect(this.node);');
edit('src/audio/AudioWorkletAnalyzer.ts','      this.node.disconnect();','      this.source?.disconnect(this.node);\n      this.source = null;\n      this.node.disconnect();');
edit('src/audio/VideoFileAudioSource.ts','    await new Promise<void>((resolve, reject) => {','    await new Promise<void>((resolve, reject) => {\n      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Не удалось открыть файл: ${fileName}`)); }, 15000);');
edit('src/audio/VideoFileAudioSource.ts','      const cleanup = (): void => {','      const cleanup = (): void => {\n        clearTimeout(timeout);');
edit('src/audio/AudioSession.ts','    this.playing = false;\n    this.loadedFileName = fileName;','    this.pause();\n    this.ready = false;\n    this.loadedFileName = fileName;');
edit('tests/unit/musicLookahead.test.ts',"import { carTrafficScrollSpeed }", "import { resolveLevelgenPreset } from '@core/config/levelgenPresets';\nimport { carTrafficScrollSpeed }");
edit('tests/unit/musicLookahead.test.ts',"confident = true, background = true)","confident = true, background = true, preset?: 'mega-traffic' | 'grok-traffic' | 'ultimate-traffic', trackRate = 1)");
edit('tests/unit/musicLookahead.test.ts','  const cfg = structuredClone(levelgenRaw) as LevelgenConfig;','  const cfg = preset ? resolveLevelgenPreset(preset, structuredClone(levelgenRaw) as LevelgenConfig) : structuredClone(levelgenRaw) as LevelgenConfig;');
edit('tests/unit/musicLookahead.test.ts','const forecast = fallbackForecast(time, 24, 120);','const forecast = fallbackForecast(time, 24, 120, trackRate);');
edit('tests/unit/musicLookahead.test.ts','    time = frame / 60;','    time = frame / 60 * trackRate;');
edit('tests/unit/musicLookahead.test.ts',"  it('continues with useful content on an uncertain track',",`  it.each(['mega-traffic', 'grok-traffic', 'ultimate-traffic'] as const)('keeps the opening available in %s', preset => {
    const result = runIntro(42, 'destroy', true, true, preset);
    expect(Math.min(...result.scheduled)).toBeLessThanOrEqual(5);
    expect(result.snapshot.musicTiming!.planned).toBeGreaterThan(8);
    expect(result.snapshot.runStats.hits).toBe(0);
  });

  it('maps song time to simulation time during tutorial slowdown', () => {
    const result = runIntro(42, 'classic', true, false, undefined, 1.06);
    expect(result.snapshot.musicTiming!.medianMs).toBeLessThan(150);
    expect(result.snapshot.musicTiming!.samples).toBeGreaterThan(6);
  });

  it('continues with useful content on an uncertain track',`);
