import { describe, expect, it } from 'vitest';
import { ConfigStore } from '@core/config/ConfigStore';
import gameRaw from '../../configs/game.default.json';
import directorRaw from '../../configs/director.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import audioRaw from '../../configs/audio.default.json';
import debugRaw from '../../configs/debug.default.json';

const defaults = {
  game: gameRaw,
  director: directorRaw,
  levelgen: levelgenRaw,
  audio: audioRaw,
  debug: debugRaw,
};

describe('ConfigStore', () => {
  it('parses all default configs', () => {
    const store = new ConfigStore(defaults);
    expect(store.get('game').speeds.base).toBe(10);
    expect(store.get('game').musicScenes).toEqual({
      minArrivalSeconds: 2.4,
      maxArrivalSeconds: 4,
      cooldownSeconds: 6,
      cueEnergyRiseThreshold: 0.08,
      echoChance: 0,
      echoCooldownSeconds: 0,
      echoMinRemainingSeconds: 1.2,
      echoEnergyThreshold: 0.25,
      echoMinArrivalSeconds: 0.6,
      echoMaxArrivalSeconds: 1.15,
    });
    expect(store.get('director').phases.calm.minDurationSeconds).toBe(2);
    expect(store.get('director').music.speedFloor).toBe(1);
    expect(store.get('levelgen').fairness.microLeadMinGapZScale).toBe(1.75);
    expect(store.get('levelgen').fairness.routeGuideShare).toBe(0.72);
    expect(store.get('game').ramp.startDelaySeconds).toBe(10);
    expect(store.get('game').ramp.cooldownSeconds).toBe(10);
    expect(store.get('game').ramp.retainedSpeedDecaySeconds).toBe(6);
    expect(store.get('game').horse.flightTimeSeconds).toBe(0.9);
    expect(store.get('game').horse.maxSpeedBoost).toBe(0.6);
    expect(store.get('game').horse.carBonusMinSeconds).toBe(10);
    expect(store.get('game').horse.carBonusGuaranteedSeconds).toBe(17);
    expect(store.get('game').horse.lateSongSwitchMinSeconds).toBe(8);
    expect(store.get('game').horse.lateSongSwitchStartProgress).toBe(0.45);
    expect(store.get('game').horse.lateSongSwitchMaxSeconds).toBe(11);
    expect(store.get('game').horse.lateSongHorseRampTrainChanceMultiplier).toBe(0.46);
    expect(store.get('game').horse.roadHorsePickupChance).toBe(0.35);
    expect(store.get('game').horse.lateSongRoadHorsePickupChance).toBe(0.75);
    expect(store.get('game').horse.carJumpPickupChance).toBe(0.82);
    expect(store.get('game').rocket.fuelSeconds).toBe(3.92);
    expect(store.get('game').rocket.launchSeconds).toBe(3);
    expect(store.get('game').rocket.speedBoost).toBe(3);
    expect(store.get('game').rocket.maxPickupsPerSong).toBe(2);
    expect(store.get('game').rocket.rampPickupChance).toBe(0.5);
    expect(store.get('game').rocket.coinSpacingSeconds).toBe(0.07);
    expect(store.get('game').rocket.coinEndBufferSeconds).toBe(0.22);
    expect(store.get('levelgen').rampProbability).toBe(0.025);
    expect(store.get('levelgen').redWallProbability).toBe(0.18);
    expect(store.get('levelgen').earlyRampProbability).toBe(0);
    expect(store.get('levelgen').densityRange[0]).toBe(0.28);
    expect(store.get('levelgen').baseDensity).toBe(0.36);
    expect(store.get('levelgen').nitroChargeLanes).toEqual([1, 2]);
    expect(store.get('levelgen').tallProbability).toBe(0.36);
    expect(store.get('levelgen').twoObstacleBias).toBe(0.5);
    expect(store.get('levelgen').horse.slideGroupProbability).toBe(0.25);
    expect(store.get('levelgen').horse.restChunkProbability).toBe(0.05);
    expect(store.get('levelgen').horse.dodgeOnlyProbability).toBe(0.34);
    expect(store.get('levelgen').horse.dodgeOnlyMaxGapChunks).toBe(3);
    expect(store.get('levelgen').nitroCoinFrequencyMultiplier).toBe(0.35);
    expect(store.get('levelgen').longRunDifficulty.maxDensityBonus).toBe(0.052);
    expect(store.get('levelgen').longRunDifficulty.maxMultiObstacleBiasBonus).toBe(0.026);
    expect(store.get('audio').fftSize).toBe(512);
    expect(store.get('debug').prototypeMode).toBe(false);
  });

  it('applies a valid update and returns true', () => {
    const store = new ConfigStore(defaults);
    const applied = store.apply('game', {
      ...gameRaw,
      speeds: { ...gameRaw.speeds, base: 12 },
    });
    expect(applied).toBe(true);
    expect(store.get('game').speeds.base).toBe(12);
  });

  it('rejects an invalid update and keeps the previous value', () => {
    const store = new ConfigStore(defaults);
    const applied = store.apply('game', {
      ...gameRaw,
      speeds: { ...gameRaw.speeds, base: -5 },
    });
    expect(applied).toBe(false);
    expect(store.get('game').speeds.base).toBe(10);
  });

  it('falls back to a safe config when a startup config is invalid', () => {
    const store = new ConfigStore({
      game: { ...gameRaw, camera: { ...gameRaw.camera, fov: -1 } },
    });
    expect(store.get('game').camera.fov).toBeGreaterThan(0);
    expect(store.bootErrors).toHaveLength(1);
    expect(store.bootErrors[0].key).toBe('game');
    expect(store.bootErrors[0].issues.length).toBeGreaterThan(0);
  });

  it('keeps valid keys when another key is invalid', () => {
    const store = new ConfigStore({
      game: { ...gameRaw, camera: { ...gameRaw.camera, fov: -1 } },
      debug: { ...debugRaw, prototypeMode: true },
    });
    expect(store.get('debug').prototypeMode).toBe(true);
    expect(store.get('game').camera.fov).toBeGreaterThan(0);
    expect(store.bootErrors).toHaveLength(1);
  });

  it('throws when requesting a config that was never loaded', () => {
    const store = new ConfigStore();
    expect(() => store.get('game')).toThrow();
  });
});
