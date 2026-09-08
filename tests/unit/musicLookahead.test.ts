import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { GameSim } from '@core/gameplay/GameSim';
import { fallbackForecast, runEnvelope, encounterDistance, MusicTimingMetrics } from '@core/gameplay/musicPlanning';
import { certifyMusicPlacement, withinRunEnvelope } from '@core/levelgen/musicPlacement';
import { resolveLevelgenPreset } from '@core/config/levelgenPresets';
import { carTrafficScrollSpeed } from '@core/levelgen/trafficMotion';
import { analyzeRhythm } from '@audio/rhythmAnalysis';
import { makeMusic, withoutRocketSpawn } from './musicHelpers';
import type { PlayerAction } from '@core/gameplay/actions';
import type { CoinEntity, ObstacleEntity } from '@core/levelgen/types';

const levelgen = levelgenRaw as LevelgenConfig;

describe('musical lookahead', () => {
  it('detects known click times and rejects silence as confident rhythm', () => {
    const samples = new Float32Array(12000 * 20);
    for (let beat = 1; beat < 40; beat++) {
      for (let j = 0; j < 240; j++) samples[beat * 6000 + j] = Math.sin(j * 0.4) * Math.exp(-j / 50);
    }
    const result = analyzeRhythm(samples, 12000);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.period).toBeCloseTo(0.5, 1);
    expect(result.cues.length).toBeGreaterThan(30);
    expect(result.cues.every(cue => Math.abs(cue.time * 2 - Math.round(cue.time * 2)) < 0.05)).toBe(true);
    expect(analyzeRhythm(new Float32Array(12000 * 8), 12000).confidence).toBe(0);
  });

  it('keeps stages independent of local intensity and has a short breather', () => {
    expect(runEnvelope(4, 200).maxBlockedLanes).toBe(1);
    expect(runEnvelope(15, 200).maxActions).toBe(2);
    expect(runEnvelope(50, 200).stage).toBe('build');
    expect(runEnvelope(120, 200).stage).toBe('peak');
    expect(runEnvelope(150, 200).stage).toBe('breather');
    expect(runEnvelope(180, 200).stage).toBe('final');
    expect(runEnvelope(15, 12).stage).toBe('warmup');
    expect(runEnvelope(60, 0).stage).toBe('build');
  });

  it('converts encounters with acceleration and lane flow, without moving an entity', () => {
    expect(encounterDistance(10, 2, 3, 5, 1)).toBe(55);
    const fallback = fallbackForecast(1, 10, 120);
    expect(fallback.source).toBe('fallback');
    expect(fallback.cues.every(c => c.confidence === 0)).toBe(true);
    expect(fallback).toEqual(fallbackForecast(1, 10, 120));
  });

  it('measures against assigned accents and does not label fallback as accurate music', () => {
    const metrics = new MusicTimingMetrics();
    metrics.record(1.08, 1, true, true);
    metrics.record(2.2, 2, true, true);
    metrics.record(3, 3, true, false);
    metrics.record(4, 4, false, true);
    expect(metrics.snapshot(120)).toMatchObject({ samples: 2, missed: 1, hitShare: 0.5 });
    expect(metrics.snapshot(120).p95Ms).toBeCloseTo(200);
  });

  it('rejects a collectible crushed by faster traffic before arrival', () => {
    const cfg = { ...levelgen, laneFlow: [0, 0, 0, 0] };
    const coin: CoinEntity = { id: 1, lane: 3, z: 30, collected: false,
      musicTarget: { time: 3, cueId: 1, confidence: 1, role: 'collect' } };
    const traffic: ObstacleEntity = { id: 2, lane: 3, z: 60, kind: 'low', shoulderPasser: true };
    const context = { speed: 10, minSpeed: 10, maxSpeed: 10, entryLane: 3, envelope: runEnvelope(0, 180) };
    expect(certifyMusicPlacement([], [coin], [], cfg, context)).toBe(true);
    expect(certifyMusicPlacement([traffic], [coin], [], cfg, context)).toBe(false);
  });

  it('rejects rapid forced zigzags even though individual rows have free lanes', () => {
    const cfg = { ...levelgen, laneFlow: [0, 0, 0, 0] };
    const context = { speed: 10, minSpeed: 10, maxSpeed: 10, entryLane: 2, envelope: runEnvelope(0, 180) };
    const coins: CoinEntity[] = [2, 0, 3].map((lane, i) => ({ id: i, lane, z: 25 + i, collected: false,
      musicTarget: { time: 2.5 + i / 10, cueId: i, confidence: 1, role: 'collect' } }));
    expect(certifyMusicPlacement([], coins, [], cfg, context)).toBe(false);
    const hazards: ObstacleEntity[] = [0, 1, 2].map((lane, id) => ({ id, kind: 'tall', lane, z: 30 }));
    expect(withinRunEnvelope(hazards, cfg, context)).toBe(false);
  });
});

function runIntro(seed: number, rules: 'classic' | 'destroy', confident = true, background = true, preset?: 'mega-traffic' | 'grok-traffic' | 'ultimate-traffic', trackRate = 1) {
  const game = withoutRocketSpawn(structuredClone(gameRaw) as GameConfig);
  game.horse.firstHorseGuaranteedSeconds = 10000;
  game.ramp.startDelaySeconds = 10000;
  const cfg = preset ? resolveLevelgenPreset(preset, structuredClone(levelgenRaw) as LevelgenConfig) : structuredClone(levelgenRaw) as LevelgenConfig;
  if (!background) {
    cfg.segmentWeights = { obstacle: 0, coins: 0, bonus: 0, empty: 1 };
    cfg.laneFlow = [0, 0, 0, 0];
  }
  let time = 0;
  let sim: GameSim;
  const published = new Map<number, { lane: number; z: number }>();
  const scheduled: number[] = [];
  sim = new GameSim({ game, levelgen: cfg, seed, musicPlanningEnabled: true, gameplayRules: rules,
    director: new ActiveDirector(directorRaw as DirectorConfig), nowMs: () => time * 1000,
    getTrackTime: () => time, getTrackDuration: () => 180,
    getMusic: () => {
      const forecast = fallbackForecast(time, 24, 120, trackRate);
      forecast.source = confident ? 'decoded' : 'fallback';
      forecast.cues = forecast.cues.map(cue => ({ ...cue, confidence: confident ? 1 : 0 }));
      return { ...makeMusic({ energy: 0.6, audioTime: time }), forecast };
    },
    consumeInput: (): PlayerAction[] => {
      const snap = sim.getSnapshot();
      const targets = [...snap.coins.filter(c => !c.collected && !c.destroyed), ...snap.obstacles.filter(o => o.kind === 'micro' && !o.broken)]
        .filter(e => e.musicTarget && e.z > 0).sort((a, b) => a.musicTarget!.time - b.musicTarget!.time);
      let lane = targets[0]?.lane ?? snap.player.lane;
      const clearance = Array.from({ length: cfg.lanes }, () => Infinity);
      for (const obstacle of snap.obstacles) {
        if (obstacle.broken || obstacle.kind === 'micro' || obstacle.z < -3) continue;
        clearance[obstacle.lane] = Math.min(clearance[obstacle.lane], (obstacle.z - (obstacle.zExtent ?? 3) / 2) / carTrafficScrollSpeed(snap.player.speed, obstacle.lane, cfg, obstacle));
      }
      if (clearance[lane] < 0.8 || clearance[snap.player.lane] < 0.8) {
        lane = clearance.reduce((best, value, i) => Math.abs(i - snap.player.lane) <= 1 && value > clearance[best] ? i : best, snap.player.lane);
      }
      return lane > snap.player.lane ? ['laneLeft'] : lane < snap.player.lane ? ['laneRight'] : [];
    },
  });
  for (let frame = 0; frame < 20 * 60; frame++) {
    time = frame / 60 * trackRate;
    sim.fixedUpdate(1 / 60);
    const snap = sim.getSnapshot();
    for (const e of [...snap.obstacles, ...snap.coins]) {
      if (e.musicTarget && !published.has(e.id)) scheduled.push(e.musicTarget.time);
      const before = published.get(e.id);
      if (before && 'kind' in e && !e.broken && !e.panicFleeActive) {
        expect(e.lane).toBe(before.lane);
        expect(e.z).toBeLessThanOrEqual(before.z + 0.001);
      }
      published.set(e.id, { lane: e.lane, z: e.z });
    }
  }
  return { snapshot: sim.getSnapshot(), scheduled };
}

describe('music slice in real simulation', () => {
  it('publishes early musical collections and retains them on a fixed seed', () => {
    const result = runIntro(42, 'classic', true, false);
    expect(Math.min(...result.scheduled)).toBeLessThanOrEqual(5);
    expect(result.snapshot.musicTiming!.planned).toBeGreaterThan(12);
    expect(result.snapshot.musicTiming!.samples).toBeGreaterThan(6);
    expect(result.snapshot.musicTiming!.medianMs).toBeLessThan(160);
    expect(result.snapshot.runStats.hits).toBe(0);
    expect(runIntro(42, 'classic', true, false).scheduled).toEqual(result.scheduled);
  });

  it.each([1, 7, 42])('keeps an active safe opening with traffic, seed %s', seed => {
    const result = runIntro(seed, 'destroy');
    expect(Math.min(...result.scheduled)).toBeLessThanOrEqual(5);
    expect(result.snapshot.musicTiming!.planned).toBeGreaterThan(8);
    expect(result.snapshot.musicTiming!.samples).toBeGreaterThan(3);
    expect(result.snapshot.musicTiming!.medianMs).toBeLessThan(120);
    expect(result.snapshot.musicTiming!.p95Ms).toBeLessThan(260);
    expect(result.snapshot.musicTiming!.hitShare).toBeGreaterThan(0.5);
    expect(result.snapshot.runStats.hits).toBe(0);
  });

  it.each(['mega-traffic', 'grok-traffic', 'ultimate-traffic'] as const)('keeps the opening available in %s', preset => {
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

  it('continues with useful content on an uncertain track', () => {
    const result = runIntro(42, 'destroy', false);
    expect(result.snapshot.musicTiming!.planned).toBeGreaterThan(8);
    expect(result.snapshot.musicTiming!.samples).toBe(0);
    expect(result.snapshot.runStats.hits).toBe(0);
  });
});
