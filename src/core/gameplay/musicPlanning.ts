export interface MusicCue {
  id: number;
  time: number;
  strength: number;
  confidence: number;
  phrase: boolean;
}

export interface MusicForecast {
  energy?: readonly { time: number; value: number }[];
  now: number;
  availableUntil: number;
  source: 'decoded' | 'predicted' | 'fallback';
  rate: number;
  cues: readonly MusicCue[];
}

export const MUSIC_PLANNING_DEFAULTS = {
  enabled: true,
  preparationSeconds: 9,
  lookaheadSeconds: 24,
  maxFileMB: 96,
  maxDecodedSeconds: 900,
  minLeadSeconds: 2.4,
  maxLeadSeconds: 4.2,
  confidenceThreshold: 0.48,
  hitWindowMs: 120,
  fallbackBpm: 112,
  introSeconds: 20,
  stageEnds: [0.48,0.72,0.8],
  densityCaps: [0.38,0.48,0.62,0.36,0.7],
  actionCaps: [2,3,4,2,5],
  blockedLaneCaps: [1,2,2,1,3],
  reactionSeconds: [0.65,0.45,0.35,0.5,0.28],
  speedCaps: [1.2,1.35,1.55,1.3,1.65],
};

export type MusicPlanningConfig = typeof MUSIC_PLANNING_DEFAULTS;
export type RunStage = 'warmup' | 'build' | 'peak' | 'breather' | 'final';

export interface RunEnvelope {
  stage: RunStage;
  densityCap: number;
  maxActions: number;
  maxBlockedLanes: number;
  minReactionSeconds: number;
  speedIntentCap: number;
}

export function runEnvelope(time: number, duration: number, config: MusicPlanningConfig = MUSIC_PLANNING_DEFAULTS): RunEnvelope {
  const progress = duration > config.introSeconds * 2 ? time / duration : Math.max(0, time - config.introSeconds) / 160;
  const index = time < config.introSeconds ? 0 : progress < config.stageEnds[0] ? 1 : progress < config.stageEnds[1] ? 2 : progress < config.stageEnds[2] ? 3 : 4;
  const stage: RunStage = (['warmup', 'build', 'peak', 'breather', 'final'] as const)[index];
  const warmup = index === 0 ? Math.max(0, Math.min(1, time / config.introSeconds)) : 1;
  return { stage, densityCap: config.densityCaps[index] * (0.65 + warmup * 0.35),
    maxActions: index === 0 && time < 10 ? 1 : config.actionCaps[index],
    maxBlockedLanes: config.blockedLaneCaps[index], minReactionSeconds: config.reactionSeconds[index],
    speedIntentCap: index === 0 ? 1.08 + (config.speedCaps[0] - 1.08) * warmup : config.speedCaps[index] };
}

export interface MusicalPatternRequest {
  cue: MusicCue;
  kind: 'collect' | 'dodge';
  accents: readonly MusicCue[];
}

export function requestMusicalPatterns(forecast: MusicForecast, intensity: number): MusicalPatternRequest[] {
  return forecast.cues.filter(cue => cue.time > forecast.now).map((cue, index, cues) => ({
    cue,
    kind: cue.phrase && intensity > 0.3 && cue.confidence >= 0.48 ? 'dodge' : 'collect',
    accents: cues.slice(index, index + 4),
  }));
}

export function fallbackForecast(now: number, horizon: number, bpm: number, rate = 1): MusicForecast {
  const period = 60 / bpm;
  const start = Math.max(0, Math.floor(now / period));
  const cues: MusicCue[] = [];
  for (let id = start; id * period <= now + horizon; id++) {
    cues.push({ id, time: id * period, strength: 0.4, confidence: 0, phrase: id % 8 === 0 });
  }
  return { now, availableUntil: now + horizon, source: 'fallback', rate, cues };
}

export function encounterDistance(speed: number, acceleration: number, seconds: number, flow: number, contactZ = 0): number {
  return Math.max(0.5, speed + flow) * seconds + 0.5 * Math.max(0, acceleration) * seconds * seconds + contactZ;
}

export class MusicTimingMetrics {
  planned = 0;
  rejected = 0;
  simplified = 0;
  shifted = 0;
  missed = 0;
  private errors: number[] = [];
  private encounters: number[] = [];
  record(actual: number, target: number, performed: boolean, confident: boolean): void {
    if (!performed) this.missed++;
    if (!confident) return;
    const values = performed ? this.errors : this.encounters;
    values.push((actual - target) * 1000);
    if (values.length > 512) values.shift();
  }
  snapshot(windowMs: number) {
    const sorted = this.errors.map(Math.abs).sort((a, b) => a - b);
    return { planned: this.planned, rejected: this.rejected, simplified: this.simplified, shifted: this.shifted,
      missed: this.missed, samples: sorted.length,
      medianMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : null,
      p95Ms: sorted.length ? sorted[Math.ceil((sorted.length - 1) * 0.95)] : null,
      signedMeanMs: sorted.length ? this.errors.reduce((a, b) => a + b, 0) / sorted.length : null,
      hitShare: sorted.length ? sorted.filter(value => value <= windowMs).length / sorted.length : null,
      encounterErrorsMs: [...this.encounters] };
  }
}
