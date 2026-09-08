import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import {
  resolveBeatRole,
  DEFAULT_BEAT_ROLES,
  fallbackForecast,
  type MusicCue,
} from '@core/gameplay/musicPlanning';
import {
  snapObstacleToBeat,
  quantizeStagedToBeat,
  pickNearCue,
  pickStrongCue,
  snapBonusToStrongCue,
} from '@core/gameplay/beatGrid';
import type { ObstacleEntity } from '@core/levelgen/types';
import { ActiveDirector } from '@core/director/ActiveDirector';
import { makeMusic, withoutRocketSpawn } from './musicHelpers';

const game = withoutRocketSpawn(gameRaw as GameConfig);
const levelgen = levelgenRaw as LevelgenConfig;

function cue(time: number, extra: Partial<MusicCue> = {}): MusicCue {
  return { id: Math.round(time * 100), time, strength: 0.5, confidence: 1, phrase: false, ...extra };
}

describe('beat role grid', () => {
  it('maps weak beats to collects, phrases to dodges, strong phrases to air', () => {
    expect(resolveBeatRole(cue(1), 0.9)).toBe('collect');
    expect(resolveBeatRole(cue(1, { phrase: true }), 0.9)).toBe('dodge');
    expect(resolveBeatRole(cue(1, { phrase: true, strength: 0.9 }), 0.9)).toBe('air');
    expect(resolveBeatRole(cue(1, { phrase: true, strength: 0.9 }), 0.1)).toBe('air');
    expect(resolveBeatRole(cue(1, { phrase: true, strength: 0.9, confidence: 0 }), 0.9)).toBe('collect');
    expect(resolveBeatRole(cue(1, { phrase: true, strength: 0.9 }), 0.9, DEFAULT_BEAT_ROLES)).toBe('air');
  });
});

describe('beat grid snapping', () => {
  const context = (cues: MusicCue[]) => ({
    cues,
    now: 0,
    rate: 1,
    playerSpeed: 20,
    config: { ...levelgen, laneFlow: [0, 0, 0, 0] },
    windowSeconds: game.musicPlanning.quantizeWindowSeconds,
  });

  it('snaps a hazard so the encounter lands on the beat', () => {
    // Приезд через 1.0 с, рядом бит на 1.05 с (окно 0.22 с).
    const obstacle: ObstacleEntity = { id: 1, kind: 'tall', lane: 1, z: 20 };
    const snapped = snapObstacleToBeat(obstacle, context([cue(1.05)]));
    expect(snapped).toBeCloseTo(21, 6);
  });

  it('leaves hazards far from any beat untouched', () => {
    const obstacle: ObstacleEntity = { id: 1, kind: 'low', lane: 0, z: 20 };
    expect(snapObstacleToBeat(obstacle, context([cue(5)]))).toBeNull();
  });

  it('never snaps micros, walls or special rows', () => {
    const base = { lane: 0, z: 20 };
    const micros: ObstacleEntity = { id: 1, kind: 'micro', ...base };
    const wall: ObstacleEntity = { id: 2, kind: 'tall', redWall: true, ...base };
    const nitro: ObstacleEntity = { id: 3, kind: 'low', nitroChallenge: true, ...base };
    const ctx = context([cue(1.0)]);
    expect(snapObstacleToBeat(micros, ctx)).toBeNull();
    expect(snapObstacleToBeat(wall, ctx)).toBeNull();
    expect(snapObstacleToBeat(nitro, ctx)).toBeNull();
  });

  it('keeps separation from published obstacles and does not mutate inputs', () => {
    const staged: ObstacleEntity[] = [
      { id: 11, kind: 'tall', lane: 1, z: 20 },
      { id: 12, kind: 'low', lane: 2, z: 40 },
    ];
    const before = staged.map((o) => o.z);
    const published: ObstacleEntity[] = [{ id: 99, kind: 'tall', lane: 1, z: 21.5 }];
    const result = quantizeStagedToBeat(staged, published, context([cue(1.05), cue(2.0)]));
    // Первая упёрлась в опубликованную (separation) — осталась на месте.
    expect(result[0].z).toBe(20);
    expect(staged.map((o) => o.z)).toEqual(before);
    expect(published[0].z).toBe(21.5);
  });
});

describe('strong cue picking', () => {
  const context = (cues: MusicCue[]) => ({
    cues,
    rate: 1,
    windowSeconds: 0.4,
    strongStrength: 0.7,
  });

  it('prefers downbeats over phrases and strong beats', () => {
    const cues = [
      cue(1.0, { strength: 0.95, phrase: true }),
      cue(1.1, { downbeat: true, strength: 0.9 }),
      cue(0.9, { strength: 0.3 }),
    ];
    expect(pickStrongCue(1.0, context(cues))?.time).toBe(1.1);
  });

  it('falls back to phrases when no downbeat is near', () => {
    const cues = [cue(1.0, { phrase: true, strength: 0.8 }), cue(0.9, { strength: 0.3 })];
    expect(pickStrongCue(1.0, context(cues))?.time).toBe(1.0);
  });

  it('ignores weak beats and empty windows', () => {
    expect(pickStrongCue(1.0, context([cue(0.9, { strength: 0.3 })]))?.time).toBeUndefined();
    expect(pickStrongCue(5.0, context([cue(1.0, { downbeat: true })]))).toBeNull();
  });

  it('snaps pickups to the nearest beat', () => {
    const cues = [cue(1.0), cue(1.5)];
    expect(pickNearCue(1.1, cues, 1, 0.25)?.time).toBe(1.0);
    expect(pickNearCue(2.0, cues, 1, 0.25)).toBeNull();
  });

  it('snaps a ground bonus so the pickup lands on a downbeat', () => {
    // Приезд через 2.0 с (z=40, скорость 20), даунбит на 2.05 с.
    const cues = [cue(2.05, { downbeat: true, strength: 0.9 })];
    const snapped = snapBonusToStrongCue(40, 20, 0, context(cues));
    expect(snapped?.cue.downbeat).toBe(true);
    expect(snapped?.z).toBeCloseTo(41, 6);
  });

  it('leaves the bonus alone when no strong beat is near', () => {
    const cues = [cue(2.05, { strength: 0.3 })];
    expect(snapBonusToStrongCue(40, 20, 0, context(cues))).toBeNull();
  });
});

describe('beat slice in simulation', () => {
  function makeSim(cues: MusicCue[], followTargets: boolean): { sim: GameSim; time: { value: number } } {
    const cfg = structuredClone(game) as GameConfig;
    cfg.horse.firstHorseGuaranteedSeconds = 10000;
    cfg.ramp.startDelaySeconds = 0;
    cfg.train.chance = 0;
    const emptyLevelgen: LevelgenConfig = {
      ...(structuredClone(levelgenRaw) as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const time = { value: 0 };
    let sim: GameSim;
    sim = new GameSim({
      game: cfg,
      levelgen: emptyLevelgen,
      seed: 913,
      musicPlanningEnabled: true,
      gameplayRules: 'classic',
      director: new ActiveDirector(directorRaw as DirectorConfig),
      nowMs: () => time.value * 1000,
      getTrackTime: () => time.value,
      getTrackDuration: () => 180,
      getMusic: () => {
        const forecast = fallbackForecast(time.value, 24, 120, 1);
        forecast.source = 'decoded';
        forecast.cues = cues
          .filter((c) => c.time >= time.value - 0.12)
          .map((c, i) => ({ ...c, id: 500 + i }));
        forecast.availableUntil = 180;
        return { ...makeMusic({ energy: 0.8, audioTime: time.value }), forecast };
      },
      consumeInput: (): PlayerAction[] => {
        if (!followTargets) return [];
        const snap = sim.getSnapshot();
        const target = [...snap.coins.filter((c) => !c.collected)]
          .filter((e) => e.musicTarget && e.z > 0)
          .sort((a, b) => a.musicTarget!.time - b.musicTarget!.time)[0];
        const lane = target?.lane ?? snap.player.lane;
        return lane > snap.player.lane ? ['laneLeft'] : lane < snap.player.lane ? ['laneRight'] : [];
      },
    });
    return { sim, time };
  }

  it('emits a delicate beat accent on precise pickups', () => {
    // Ровные биты каждые 0.5 с: подборы неизбежны, часть — точно в окно.
    const cues: MusicCue[] = [];
    for (let t = 3; t < 30; t += 0.5) cues.push(cue(t));
    const { sim, time } = makeSim(cues, true);
    let beats = 0;
    let pulseSeen = 0;
    for (let frame = 0; frame < 30 * 60; frame++) {
      time.value = frame / 60;
      sim.fixedUpdate(1 / 60);
      pulseSeen = Math.max(pulseSeen, sim.getSnapshot().beatHitPulse);
      for (const event of sim.sfxEvents.drain()) {
        if (event.id === 'beat') {
          beats += 1;
          expect(event.strength).toBeGreaterThan(0.2);
        }
      }
    }
    expect(beats).toBeGreaterThan(0);
    expect(pulseSeen).toBe(1);
  });

  it('places a ramp flight between beats with a strong landing', () => {
    // Слабая доля на 8.0 с, сильная фраза на 11.0 с (полёт 3 с).
    const cues: MusicCue[] = [
      cue(8.0, { strength: 0.3 }),
      cue(9.0, { strength: 0.4 }),
      cue(10.0, { strength: 0.4 }),
      cue(11.0, { strength: 0.95, phrase: true }),
      cue(12.0, { strength: 0.4 }),
    ];
    for (let t = 13; t < 30; t += 0.5) cues.push(cue(t));
    const { sim, time } = makeSim(cues, false);
    let maxRamps = 0;
    let maxAirCoins = 0;
    let airTimes: number[] = [];
    let sawRampFlight = false;
    for (let frame = 0; frame < 14 * 60; frame++) {
      time.value = frame / 60;
      sim.fixedUpdate(1 / 60);
      sim.sfxEvents.drain();
      const snap = sim.getSnapshot();
      maxRamps = Math.max(maxRamps, snap.ramps.length);
      if (snap.player.airState === 'airborne' && snap.player.airSource === 'ramp') {
        sawRampFlight = true;
      }
      const airCoins = snap.coins.filter((c) => c.airTargetTime !== undefined && c.musicTarget);
      maxAirCoins = Math.max(maxAirCoins, airCoins.length);
      if (airCoins.length > 0) {
        airTimes = airCoins.map((c) => c.musicTarget!.time).sort((a, b) => a - b);
      }
    }
    // Рампа из воздушной связки (базовые рампы выключены конфигом).
    expect(maxRamps).toBeGreaterThan(0);
    expect(maxAirCoins).toBeGreaterThan(0);
    // Монеты полёта привязаны к промежуточным битам.
    expect(airTimes[0]).toBeGreaterThan(8.0);
    expect(airTimes.at(-1)!).toBeLessThan(11.0);
    // Полёт завершился посадкой (статичный игрок увороты не делает,
    // честность обхода покрыта сертификацией и musicLookahead-тестами).
    expect(sawRampFlight).toBe(true);
    expect(sim.getSnapshot().player.mode).toBe('car');
  });

  it('quantizes train roof coins to beats on spawn', () => {
    const cues: MusicCue[] = [];
    for (let t = 3; t < 30; t += 0.5) cues.push(cue(t));
    const cfg = structuredClone(game) as GameConfig;
    cfg.horse.firstHorseGuaranteedSeconds = 10000;
    cfg.ramp.startDelaySeconds = 0;
    cfg.train.chance = 1;
    const emptyLevelgen: LevelgenConfig = {
      ...(structuredClone(levelgenRaw) as LevelgenConfig),
      segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
      redWallProbability: 0,
      rampProbability: 0,
      earlyRampProbability: 0,
      nitroWallProbability: 0,
      laneFlow: [0, 0, 0, 0],
    };
    const time = { value: 0 };
    let sim: GameSim;
    sim = new GameSim({
      game: cfg,
      levelgen: emptyLevelgen,
      seed: 4242,
      musicPlanningEnabled: true,
      gameplayRules: 'classic',
      director: new ActiveDirector(directorRaw as DirectorConfig),
      nowMs: () => time.value * 1000,
      getTrackTime: () => time.value,
      getTrackDuration: () => 180,
      getMusic: () => {
        const forecast = fallbackForecast(time.value, 24, 120, 1);
        forecast.source = 'decoded';
        forecast.cues = cues
          .filter((c) => c.time >= time.value - 0.12)
          .map((c, i) => ({ ...c, id: 600 + i }));
        forecast.availableUntil = 180;
        return { ...makeMusic({ energy: 0.6, audioTime: time.value }), forecast };
      },
      consumeInput: (): PlayerAction[] => [],
    });
    const lane = sim.getSnapshot().player.lane;
    sim.getSnapshot().ramps.push({ id: 9501, lane, z: 0.5 });
    sim.fixedUpdate(1 / 60);
    const snap = sim.getSnapshot();
    expect(snap.trains.length).toBe(1);
    const roofCoins = snap.coins.filter((c) => c.trainId !== undefined);
    expect(roofCoins.length).toBeGreaterThan(0);
    const stamped = roofCoins.filter((c) => c.musicTarget);
    // Монеты крыши легли на сетку битов.
    expect(stamped.length).toBeGreaterThan(0);
    for (const coin of stamped) {
      expect(
        cues.some((c) => Math.abs(c.time - coin.musicTarget!.time) < 1e-9),
      ).toBe(true);
    }
  });
});
