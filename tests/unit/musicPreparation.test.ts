import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicLookahead } from '@audio/MusicLookahead';
import { MUSIC_PLANNING_DEFAULTS } from '@core/gameplay/musicPlanning';
import { PlayerSim } from '@core/gameplay/PlayerSim';
import { ActiveDirector } from '@core/director/ActiveDirector';
import gameRaw from '../../configs/game.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, DirectorConfig } from '@core/config/schemas';
import { fallbackForecast } from '@core/gameplay/musicPlanning';
import { makeMusic } from './musicHelpers';

class WorkerStub {
  static latest: WorkerStub;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: { until: number; serial: number }[] = [];
  terminated = false;
  constructor() { WorkerStub.latest = this; }
  postMessage(message: { until: number; serial: number }): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  reply(index: number): void {
    const request = this.messages[index];
    this.onmessage?.({ data: { ...request, energy: [{ time: request.until - 24, value: 0.6 }],
      cues: Array.from({ length: 48 }, (_, i) => ({ id: Math.round((request.until - 24 + i / 2) * 1000), time: request.until - 24 + i / 2, strength: 1, confidence: 1, phrase: i % 8 === 0 })) } });
  }
}

function context() {
  return { decodeAudioData: vi.fn().mockResolvedValue({ duration: 100, sampleRate: 12000,
    getChannelData: () => new Float32Array(12000 * 100) }) } as unknown as AudioContext;
}

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('preparation lifecycle', () => {
  it('waits for actual analyzed material, advances it and restores the same opening', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    const lookahead = new MusicLookahead(MUSIC_PLANNING_DEFAULTS);
    const progress = vi.fn();
    const pending = lookahead.prepare(context(), async () => new ArrayBuffer(8), 100, progress);
    await flush();
    expect(lookahead.status).toBe('fallback');
    const worker = WorkerStub.latest;
    worker.reply(0);
    await pending;
    const opening = lookahead.forecast(0, 1);
    expect(opening.source).toBe('decoded');
    expect(opening.availableUntil).toBe(24);
    expect(worker.messages).toHaveLength(2);
    lookahead.restart();
    worker.reply(1);
    expect(lookahead.forecast(0, 1).availableUntil).toBe(24);
    worker.reply(2);
    expect(lookahead.forecast(0, 1).cues.filter(cue => cue.time < 24)).toEqual(opening.cues);
    expect(lookahead.forecast(25, 1).availableUntil).toBe(48);
    lookahead.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('uses safe fallback after a preparation deadline and ignores late decoding', async () => {
    vi.useFakeTimers();
    let finish!: (buffer: unknown) => void;
    const ctx = { decodeAudioData: () => new Promise(resolve => { finish = resolve; }) } as unknown as AudioContext;
    const lookahead = new MusicLookahead(MUSIC_PLANNING_DEFAULTS);
    const pending = lookahead.prepare(ctx, async () => new ArrayBuffer(8), 100, vi.fn());
    await flush();
    await vi.advanceTimersByTimeAsync(9001);
    await pending;
    expect(lookahead.status).toBe('fallback: timeout');
    finish({ duration: 100 });
    await flush();
    expect(lookahead.forecast(0, 1).source).toBe('fallback');
  });

  it('handles unsupported decoding and rejects oversized duration without reading bytes', async () => {
    const lookahead = new MusicLookahead(MUSIC_PLANNING_DEFAULTS);
    const read = vi.fn(async () => new ArrayBuffer(8));
    await lookahead.prepare(context(), read, 9999, vi.fn());
    expect(read).not.toHaveBeenCalled();
    const ctx = { decodeAudioData: vi.fn().mockRejectedValue(new Error('codec')) } as unknown as AudioContext;
    await lookahead.prepare(ctx, read, 100, vi.fn());
    expect(lookahead.status).toBe('fallback: decode');
  });

  it('does not mutate real physics while predicting travel', () => {
    const player = new PlayerSim(gameRaw as GameConfig);
    player.update(1, { laneDelta: 0, jump: false, nitro: false }, 1.1);
    const before = { ...player.state };
    const prediction = player.predictTravel([1, 2, 3], -1.5, 1.1);
    expect(player.state).toEqual(before);
    let distance = 0;
    for (let i = 0; i < 180; i++) {
      player.update(1 / 60, { laneDelta: 0, jump: false, nitro: false }, 1.1);
      distance += Math.max(0.5, player.state.speed - 1.5) / 60;
    }
    expect(prediction[2]).toBeCloseTo(distance, 6);
  });

  it('previewing Director leaves live phase and intents identical', () => {
    const withForecast = new ActiveDirector(directorRaw as DirectorConfig);
    const plain = new ActiveDirector(directorRaw as DirectorConfig);
    for (let i = 0; i < 100; i++) {
      const now = i / 10;
      const music = makeMusic({ energy: 0.8, audioTime: now });
      const output = withForecast.update(0.1, now, { ...music, forecast: fallbackForecast(now, 24, 120) }, 0);
      const baseline = plain.update(0.1, now, music, 0);
      expect(output.phase).toBe(baseline.phase);
      expect(output.intents).toEqual(baseline.intents);
      expect(output.speedPlan!.length).toBeGreaterThan(0);
    }
  });
});

it('replays the new planner with its recorded forecast and gameplay rules', async () => {
  const { ReplayRecorder } = await import('@core/replay/ReplayRecorder');
  const { ReplayRunner } = await import('@core/replay/ReplayRunner');
  const { GameSim } = await import('@core/gameplay/GameSim');
  const { default: levelgenRaw } = await import('../../configs/levelgen.default.json');
  const { makeMusic } = await import('./musicHelpers');
  const recorder = new ReplayRecorder();
  const game = structuredClone(gameRaw) as GameConfig;
  let time = 0;
  const levelgen = levelgenRaw as import('@core/config/schemas').LevelgenConfig;
  const sim = new GameSim({ game, levelgen, musicPlanningEnabled: true, gameplayRules: 'classic', seed: 42,
    director: new ActiveDirector(directorRaw as DirectorConfig), nowMs: () => time * 1000,
    getTrackTime: () => time, getTrackDuration: () => 180, getSongProgress: () => time / 180,
    consumeInput: () => [], getMusic: () => {
      const music = { ...makeMusic({ energy: 0.6, audioTime: time }), forecast: fallbackForecast(time, 24, 120) };
      recorder.recordMusic(sim.playerSim.state.gameTime, music);
      return music;
    } });
  recorder.start(42, 180, { musicPlanningEnabled: true, gameplayRules: 'classic' });
  const live = [];
  for (let i = 0; i < 360; i++) {
    sim.fixedUpdate(1 / 60);
    time += 1 / 60;
    live.push(structuredClone(sim.getSnapshot()));
  }
  const replay = new ReplayRunner({ game, levelgen, director: new ActiveDirector(directorRaw as DirectorConfig) })
    .run(recorder.finish(time)!);
  expect(replay).toEqual(live);
});
