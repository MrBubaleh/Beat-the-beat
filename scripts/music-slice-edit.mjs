import fs from 'node:fs';
function edit(path, from, to) {
  const source = fs.readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  if (!source.includes(from)) throw new Error(path + ': missing ' + from.slice(0, 80));
  fs.writeFileSync(path, source.replace(from, to));
}
edit('src/core/config/schemas.ts', "import { z } from 'zod';", "import { z } from 'zod';\nimport { MUSIC_PLANNING_DEFAULTS } from '../gameplay/musicPlanning';");
edit('src/core/config/schemas.ts', '  musicScenes: z.object({', `  musicPlanning: z.object({
    enabled: z.boolean(), preparationSeconds: z.number().min(1).max(15),
    lookaheadSeconds: z.number().min(8).max(60), maxFileMB: z.number().min(1).max(256),
    maxDecodedSeconds: z.number().min(20).max(1800), minLeadSeconds: z.number().min(1),
    maxLeadSeconds: z.number().min(1), confidenceThreshold: z.number().min(0).max(1),
    hitWindowMs: z.number().positive(), fallbackBpm: z.number().min(60).max(180),
    introSeconds: z.number().min(15).max(25),
  }).refine(value => value.maxLeadSeconds >= value.minLeadSeconds && value.lookaheadSeconds > value.maxLeadSeconds,
    { message: 'music planning horizon must exceed the scheduling lead' }).default(MUSIC_PLANNING_DEFAULTS),
  musicScenes: z.object({`);
edit('src/core/config/fallbacks.ts', "import { sfxFallback }", "import { MUSIC_PLANNING_DEFAULTS } from '../gameplay/musicPlanning';\nimport { sfxFallback }");
edit('src/core/config/fallbacks.ts', '    musicScenes: {', '    musicPlanning: { ...MUSIC_PLANNING_DEFAULTS },\n    musicScenes: {');
edit('configs/game.default.json', '  "musicScenes": {', `  "musicPlanning": {
    "enabled": true, "preparationSeconds": 9, "lookaheadSeconds": 24,
    "maxFileMB": 96, "maxDecodedSeconds": 900,
    "minLeadSeconds": 2.4, "maxLeadSeconds": 4.2, "confidenceThreshold": 0.48,
    "hitWindowMs": 120, "fallbackBpm": 112, "introSeconds": 20
  },
  "musicScenes": {`);
edit('src/core/state/MusicState.ts', 'export interface TimedValue', "import type { MusicForecast } from '../gameplay/musicPlanning';\n\nexport interface TimedValue");
edit('src/core/state/MusicState.ts', 'export interface MusicState {', 'export interface MusicState {\n  forecast?: MusicForecast;');
edit('src/core/director/types.ts', 'export interface DirectorOutput {', "import type { MusicalPatternRequest } from '../gameplay/musicPlanning';\n\nexport interface DirectorOutput {\n  patterns?: MusicalPatternRequest[];");
edit('src/core/director/ActiveDirector.ts', "export class ActiveDirector", "import { requestMusicalPatterns } from '../gameplay/musicPlanning';\n\nexport class ActiveDirector");
edit('src/core/director/ActiveDirector.ts', 'return { intents, phase: this.fsm.phase, phaseElapsed: this.fsm.phaseElapsed };', 'return { intents, phase: this.fsm.phase, phaseElapsed: this.fsm.phaseElapsed,\n      patterns: music.forecast ? requestMusicalPatterns(music.forecast, this.sectionEnergy) : undefined };');
edit('src/audio/AudioSession.ts', 'export class AudioSession {', "import { MusicLookahead } from './MusicLookahead';\nimport { MUSIC_PLANNING_DEFAULTS, type MusicPlanningConfig } from '@core/gameplay/musicPlanning';\n\nexport class AudioSession {\n  private lookahead = new MusicLookahead(MUSIC_PLANNING_DEFAULTS);\n  private planningConfig = MUSIC_PLANNING_DEFAULTS;\n  onPreparationProgress: (message: string) => void = () => undefined;\n  private lastCueId = -1;\n\n  configureMusicPlanning(config: MusicPlanningConfig): void {\n    this.lookahead.dispose();\n    this.planningConfig = config;\n    this.lookahead = new MusicLookahead(config);\n  }");
edit('src/audio/AudioSession.ts', 'await this.loadFromSource(file.name, (source) => source.load(file));', `await this.loadFromSource(file.name, (source) => source.load(file));
    await this.lookahead.prepare(this.ctx!, async () => {
      if (file.size > this.planningConfig.maxFileMB * 1024 * 1024) throw new Error('file budget');
      return file.arrayBuffer();
    }, this.trackDuration, this.onPreparationProgress);`);
edit('src/audio/AudioSession.ts', 'await this.loadFromSource(fileName, (source) => source.loadUrl(url, fileName));', `await this.loadFromSource(fileName, (source) => source.loadUrl(url, fileName));
    await this.lookahead.prepare(this.ctx!, async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('track fetch');
      if (Number(response.headers.get('content-length')) > this.planningConfig.maxFileMB * 1024 * 1024) throw new Error('file budget');
      return response.arrayBuffer();
    }, this.trackDuration, this.onPreparationProgress);`);
edit('src/audio/AudioSession.ts', '    this.source?.rewind();', '    this.source?.rewind();\n    this.lastCueId = -1;');
edit('src/audio/AudioSession.ts', '    return this.analyzer?.getLatestState() ?? emptyMusicState();', `    const live = this.analyzer?.getLatestState() ?? emptyMusicState();
    if (!this.planningConfig.enabled) return live;
    const now = Math.max(0, this.trackTime - this.latencyOffset);
    const rate = Math.max(this.tutorialConfig.audioMinPlaybackRate,
      this.tutorialScale ** this.tutorialConfig.audioPlaybackRatePower) / Math.max(0.01, this.tutorialScale);
    const forecast = this.lookahead.forecast(now, rate);
    const cue = forecast.source === 'decoded' ? forecast.cues.findLast(c => c.time <= now && now - c.time < 0.09) : undefined;
    const beat = this.isPlaying && cue !== undefined && cue.id !== this.lastCueId;
    if (beat) this.lastCueId = cue.id;
    return { ...live, audioTime: now, forecast,
      beat: forecast.source === 'decoded' ? { value: beat, audioTime: cue?.time ?? now } : live.beat };
`);
edit('src/audio/AudioSession.ts', "this.clock = new AudioClock(this.ctx, this.config.latencyOffsetMs / 1000);", "this.clock = new AudioClock({ get currentTime() { return 0; } }, this.config.latencyOffsetMs / 1000);");
edit('src/audio/AudioSession.ts', '    await load(this.source);', `    await load(this.source);
    this.clock = new AudioClock(this.source, this.config.latencyOffsetMs / 1000);`);
edit('src/audio/AudioSession.ts', '    this.ensurePipeline();', '    this.ensurePipeline();\n    await this.analyzer!.start(this.graph!.musicBus, this.clock!);');
edit('src/audio/AudioSession.ts', '      void this.analyzer.start(this.graph.musicBus, this.clock!);', '');
