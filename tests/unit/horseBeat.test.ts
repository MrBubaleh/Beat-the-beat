import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import { snapHorseGroupAnchor } from '@core/gameplay/beatGrid';
import { fallbackForecast, type MusicCue } from '@core/gameplay/musicPlanning';
import { findComfortableHorseRoute } from '@core/levelgen/passability';
import type { ObstacleEntity } from '@core/levelgen/types';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { makeMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;

function cue(time: number, extra: Partial<MusicCue> = {}): MusicCue {
  return { id: Math.round(time * 100), time, strength: 0.5, confidence: 1, phrase: false, ...extra };
}

describe('horse group snapping', () => {
  const context = (
    cues: MusicCue[],
    mode: 'phrase' | 'strong' | 'any',
    leadSeconds = 0,
  ) => ({
    cues,
    now: 0,
    rate: 1,
    playerSpeed: 20,
    config: { ...levelgen, laneFlow: [0, 0, 0, 0] },
    windowSeconds: game.musicPlanning.quantizeWindowSeconds,
    mode,
    leadSeconds,
    strongStrength: game.musicPlanning.roleStrongStrength,
  });

  it('pulls mandatory groups to phrases, others to the nearest beat', () => {
    const anchor: ObstacleEntity = { id: 1, kind: 'low', lane: 1, z: 20, horseAction: 'jump' };
    const cues = [cue(0.9), cue(1.05, { phrase: true, strength: 0.9 })];
    const mandatory = snapHorseGroupAnchor(anchor, context(cues, 'phrase'));
    expect(mandatory?.cue.phrase).toBe(true);
    expect(mandatory?.z).toBeCloseTo(21, 6);
    const free = snapHorseGroupAnchor(anchor, context(cues, 'any'));
    expect(free?.cue.time).toBe(1.05);
  });

  it('offsets the obstacle by the action lead so the press lands on the beat', () => {
    // Встреча через 1.0 с, бит на 0.65 с, упреждение прыжка 0.35 с:
    // жать надо ровно на бит — препятствие остаётся на месте.
    const anchor: ObstacleEntity = { id: 1, kind: 'low', lane: 1, z: 20, horseAction: 'jump' };
    const snapped = snapHorseGroupAnchor(anchor, context([cue(0.65)], 'any', 0.35));
    expect(snapped?.cue.time).toBe(0.65);
    expect(snapped?.z).toBeCloseTo(20, 6);
  });

  it('prefers strong beats for big dodges', () => {
    const anchor: ObstacleEntity = { id: 1, kind: 'tall', lane: 1, z: 20, horseDodgeOnly: true };
    // Слабый бит ближе (0.95), сильный чуть дальше (1.1): берём сильный.
    const cues = [cue(0.95, { strength: 0.3 }), cue(1.1, { strength: 0.9 })];
    const strong = snapHorseGroupAnchor(anchor, context(cues, 'strong'));
    expect(strong?.cue.time).toBe(1.1);
    // Без сильных рядом — берём обычный бит, а не пустоту.
    const plain = snapHorseGroupAnchor(anchor, context([cue(0.95, { strength: 0.3 })], 'strong'));
    expect(plain?.cue.time).toBe(0.95);
  });

  it('leaves groups far from any beat untouched', () => {
    const anchor: ObstacleEntity = { id: 1, kind: 'overhead', lane: 0, z: 20, horseAction: 'slide' };
    expect(snapHorseGroupAnchor(anchor, context([cue(5)], 'any'))).toBeNull();
    expect(snapHorseGroupAnchor(anchor, context([cue(5, { phrase: true })], 'phrase'))).toBeNull();
  });
});

describe('horse beat slice in simulation', () => {
  function makeSim(): { sim: GameSim; time: { value: number } } {
    const cfg = structuredClone(game) as GameConfig;
    cfg.horse.firstHorseGuaranteedSeconds = 10000;
    const horseLevelgen = structuredClone(levelgenRaw) as LevelgenConfig;
    horseLevelgen.laneFlow = [0, 0, 0, 0];
    const time = { value: 0 };
    let sim: GameSim;
    sim = new GameSim({
      game: cfg,
      levelgen: horseLevelgen,
      seed: 31415,
      musicPlanningEnabled: true,
      gameplayRules: 'classic',
      director: new ActiveDirector(directorRaw as DirectorConfig),
      nowMs: () => time.value * 1000,
      getTrackTime: () => time.value,
      getTrackDuration: () => 180,
      getMusic: () => {
        const forecast = fallbackForecast(time.value, 24, 120, 1);
        forecast.source = 'decoded';
        forecast.cues = forecast.cues.map((c, i) => ({
          ...c,
          id: 700 + i,
          confidence: 1,
          phrase: i % 4 === 0,
          strength: i % 4 === 0 ? 0.9 : 0.4,
        }));
        forecast.availableUntil = 180;
        return { ...makeMusic({ energy: 0.8, audioTime: time.value }), forecast };
      },
      consumeInput: (): PlayerAction[] => [],
    });
    sim.setMode('horse');
    return { sim, time };
  }

  it('stamps horse groups with beat targets and keeps the route', () => {
    const first = makeSim();
    const stampedFirst: number[] = [];
    for (let frame = 0; frame < 25 * 60; frame++) {
      first.time.value = frame / 60;
      first.sim.fixedUpdate(1 / 60);
      first.sim.sfxEvents.drain();
      if (first.sim.gameOver) break;
      for (const o of first.sim.getSnapshot().obstacles) {
        if (o.musicTarget) stampedFirst.push(o.musicTarget.time);
      }
    }
    expect(stampedFirst.length).toBeGreaterThan(0);
    const snap = first.sim.getSnapshot();
    const horizon = snap.obstacles.filter((o) => o.trainId === undefined);
    expect(findComfortableHorseRoute(horizon, levelgen, 0, snap.player.lane).passable).toBe(true);
    const second = makeSim();
    const stampedSecond: number[] = [];
    for (let frame = 0; frame < 25 * 60; frame++) {
      second.time.value = frame / 60;
      second.sim.fixedUpdate(1 / 60);
      second.sim.sfxEvents.drain();
      if (second.sim.gameOver) break;
      for (const o of second.sim.getSnapshot().obstacles) {
        if (o.musicTarget) stampedSecond.push(o.musicTarget.time);
      }
    }
    expect(stampedSecond).toEqual(stampedFirst);
  });

  it('emits a beat on a horse dodge passing in time', () => {
    const { sim, time } = makeSim();
    const lane = (sim.getSnapshot().player.lane + 1) % levelgen.lanes;
    sim.getSnapshot().obstacles.push({
      id: 8101,
      kind: 'tall',
      lane,
      z: -0.1,
      horseDodgeOnly: true,
      musicTarget: { time: time.value, cueId: 1, confidence: 1, role: 'dodge' },
    });
    sim.fixedUpdate(1 / 60);
    const beats = sim.sfxEvents.drain().filter((e) => e.id === 'beat');
    expect(beats.length).toBe(1);
    sim.fixedUpdate(1 / 60);
    expect(sim.sfxEvents.drain().filter((e) => e.id === 'beat')).toHaveLength(0);
  });

  it('emits a beat on a precise horse jump clear', () => {
    const { sim, time } = makeSim();
    const lane = sim.getSnapshot().player.lane;
    sim.getSnapshot().obstacles.push({
      id: 8201,
      kind: 'low',
      lane,
      z: 0.3,
      horseAction: 'jump',
      actionGroupId: 82,
      musicTarget: { time: time.value, cueId: 2, confidence: 1, role: 'collect' },
    });
    sim.playerSim.state.airSource = 'horseJump';
    sim.playerSim.state.airState = 'airborne';
    sim.playerSim.state.airTime = 0.3;
    sim.playerSim.state.y = 3;
    sim.fixedUpdate(1 / 60);
    expect(sim.sfxEvents.drain().filter((e) => e.id === 'beat').length).toBe(1);
  });
});
