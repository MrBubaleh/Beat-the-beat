import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { PlayerAction } from '@core/gameplay/actions';
import { GameSim } from '@core/gameplay/GameSim';
import { NITRO_DRY_COOLDOWN_SECONDS, NITRO_DRY_PULSE_SECONDS } from '@core/gameplay/nitro';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { SfxDirector } from '@core/sfx/SfxDirector';
import { sfxFallback } from '@core/sfx/defaults';
import type { SfxEvent, SfxState } from '@core/sfx/types';
import { emptyMusic } from './musicHelpers';

const game = gameRaw as GameConfig;
const levelgen = levelgenRaw as LevelgenConfig;
const directorCfg = directorRaw as DirectorConfig;

const dryGame: GameConfig = {
  ...game,
  nitro: {
    ...game.nitro,
    gainPerChargeLaneSecond: 0,
    gainPerDodge: 0,
    gainPerCoin: 0,
    gainPerSmash: 0,
    gainPerNearMiss: 0,
  },
};
const emptyLevelgen: LevelgenConfig = {
  ...levelgen,
  segmentWeights: { obstacle: 0, coins: 0, bonus: 0, empty: 1 },
  rampProbability: 0,
  redWallProbability: 0,
};

function makeSim(): { sim: GameSim; setInput: (a: PlayerAction[]) => void } {
  const director = new PassthroughDirector(directorCfg);
  let input: PlayerAction[] = [];
  const sim = new GameSim({
    game: dryGame,
    levelgen: emptyLevelgen,
    director,
    consumeInput: () => input,
    nowMs: () => 0,
    getMusic: () => emptyMusic(),
    seed: 42,
  });
  return { sim, setInput: (a) => (input = a) };
}

function pressNitro(sim: GameSim, setInput: (a: PlayerAction[]) => void): void {
  setInput(['nitro']);
  sim.fixedUpdate(1 / 60);
  setInput([]);
}

describe('nitro dry-fire', () => {
  it('gives feedback without acceleration or gameplay change on empty nitro', () => {
    const { sim, setInput } = makeSim();
    sim.sfxEvents.drain();
    pressNitro(sim, setInput);
    const snap = sim.getSnapshot();
    expect(snap.player.mode).toBe('car');
    expect(snap.player.isAbilityActive).toBe(false);
    expect(snap.player.nitroCharge).toBe(0);
    expect(snap.player.gameOver).toBe(false);
    expect(snap.nitroDryPulse).toBeGreaterThan(0);
    expect(snap.nitroDryPulse).toBeLessThanOrEqual(NITRO_DRY_PULSE_SECONDS);
    expect(sim.sfxEvents.drain().some((e) => e.id === 'nitroDry')).toBe(true);
  });

  it('cooldown suppresses repeated dry sounds and visuals', () => {
    const { sim, setInput } = makeSim();
    sim.sfxEvents.drain();
    pressNitro(sim, setInput);
    expect(sim.sfxEvents.drain().some((e) => e.id === 'nitroDry')).toBe(true);
    pressNitro(sim, setInput);
    expect(sim.sfxEvents.drain().some((e) => e.id === 'nitroDry')).toBe(false);
    const frames = Math.ceil(NITRO_DRY_COOLDOWN_SECONDS * 60) + 5;
    for (let i = 0; i < frames; i++) sim.fixedUpdate(1 / 60);
    sim.sfxEvents.drain();
    pressNitro(sim, setInput);
    expect(sim.sfxEvents.drain().some((e) => e.id === 'nitroDry')).toBe(true);
  });

  it('pulse fades out on its own', () => {
    const { sim, setInput } = makeSim();
    pressNitro(sim, setInput);
    expect(sim.getSnapshot().nitroDryPulse).toBeGreaterThan(0);
    const frames = Math.ceil(NITRO_DRY_PULSE_SECONDS * 60) + 5;
    for (let i = 0; i < frames; i++) sim.fixedUpdate(1 / 60);
    expect(sim.getSnapshot().nitroDryPulse).toBe(0);
  });

  it('ready nitro activates with no dry feedback', () => {
    const { sim, setInput } = makeSim();
    sim.getSnapshot().player.nitroCharge = dryGame.nitro.maxFill;
    sim.sfxEvents.drain();
    pressNitro(sim, setInput);
    const snap = sim.getSnapshot();
    expect(snap.player.isAbilityActive).toBe(true);
    expect(snap.nitroDryPulse).toBe(0);
    expect(sim.sfxEvents.drain().some((e) => e.id === 'nitroDry')).toBe(false);
  });

  it('restart clears the dry pulse and cooldown', () => {
    const { sim, setInput } = makeSim();
    pressNitro(sim, setInput);
    expect(sim.getSnapshot().nitroDryPulse).toBeGreaterThan(0);
    sim.restart();
    expect(sim.getSnapshot().nitroDryPulse).toBe(0);
  });
});

describe('nitroDry sfx wiring', () => {
  it('director turns a dry event into a quiet voice through the generic path', () => {
    const director = new SfxDirector(sfxFallback);
    const state: SfxState = {
      gameTime: 0, mode: 'car', speed: 22, lane: 2, laneX: 0, y: 0,
      airState: 'grounded', nitroActive: false, nitroReady: false, sliding: false,
      rocketPhase: 'none', combo: 0, gameOver: false, damageState: 'normal',
    };
    const event: SfxEvent = {
      id: 'nitroDry', run: 1, sequence: 1, gameTime: 0, mode: 'car',
      speed: 22, pan: 0, strength: 0.6, count: 1,
    };
    const commands = director.tick([event], { state, phase: 'running', tutorialScale: 1 }, 0);
    const voice = commands
      .filter((c) => c.type === 'start')
      .map((c) => (c.type === 'start' ? c.voice : null))
      .find((v) => v?.event === 'nitroDry');
    expect(voice).toBeDefined();
    expect(voice?.gain).toBeLessThan(0.3);
  });

  it('rocket turbo stays below music with a long smooth tail', () => {
    expect(sfxFallback.rocketSample.gain).toBe(0.9);
    expect(sfxFallback.rocketSample.fadeInMs).toBe(0);
    expect(sfxFallback.rocketSample.fadeOutMs).toBe(1900);
  });
});
