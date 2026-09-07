import { describe, expect, it } from 'vitest';
import { GameSim } from '@core/gameplay/GameSim';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import type { GameConfig, LevelgenConfig, DirectorConfig } from '@core/config/schemas';
import type { GameplayRulesId } from '@core/gameplay/gameplayRules';
import game from '../../configs/game.default.json';
import levelgen from '../../configs/levelgen.default.json';
import director from '../../configs/director.default.json';
import { emptyMusic } from './musicHelpers';

function make(rules: GameplayRulesId = 'destroy') {
  const sim = new GameSim({
    game: game as GameConfig, levelgen: levelgen as LevelgenConfig,
    director: new PassthroughDirector(director as DirectorConfig),
    consumeInput: () => [], nowMs: () => 0, getMusic: emptyMusic,
    getSongProgress: () => 0, seed: 9173, gameplayRules: rules,
  });
  const snapshot = sim.getSnapshot();
  snapshot.obstacles.length = 0;
  snapshot.trains.length = 0;
  return sim;
}
const tick = (sim: GameSim) => sim.fixedUpdate(1 / 60);

describe('GameSim SFX integration', () => {
  it('distinguishes a canister from a smash and does not consume SFX on snapshot reads', () => {
    const sim = make();
    const s = sim.getSnapshot();
    s.obstacles.push({ id: 91001, kind: 'micro', lane: s.player.lane, z: 0.2 });
    tick(sim); sim.getSnapshot(); sim.getSnapshot();
    const events = sim.sfxEvents.drain();
    expect(events.filter(e => e.id === 'canister')).toHaveLength(1);
    expect(events.some(e => e.id === 'smash' || e.id === 'hit')).toBe(false);
    tick(sim);
    expect(sim.sfxEvents.drain().some(e => e.id === 'canister')).toBe(false);
  });
  it('emits one accepted collision and no repeated hit during invulnerability', () => {
    const sim = make();
    const s = sim.getSnapshot();
    s.player.nitroCharge = 0;
    s.obstacles.push({ id: 91002, kind: 'low', lane: s.player.lane, z: 0.2 });
    tick(sim);
    expect(sim.sfxEvents.drain().filter(e => e.id === 'hit')).toHaveLength(1);
    s.obstacles.push({ id: 91003, kind: 'low', lane: s.player.lane, z: 0.2 });
    tick(sim);
    expect(sim.sfxEvents.drain().filter(e => e.id === 'hit')).toHaveLength(0);
  });
  it('captures an automatically activated nitro blast and a smash without an HP hit', () => {
    const sim = make();
    const s = sim.getSnapshot();
    s.player.nitroCharge = game.nitro.maxFill;
    s.obstacles.push({ id: 91004, kind: 'low', lane: s.player.lane, z: 0.2 });
    tick(sim);
    const ids = sim.sfxEvents.drain().map(e => e.id);
    expect(ids).toContain('nitroStart');
    expect(ids).toContain('smash');
    expect(ids).not.toContain('hit');
  });
  it('does not produce a pickup for coins granted without collecting an entity', () => {
    const sim = make('classic');
    sim.playerSim.state.coins += 20;
    tick(sim);
    expect(sim.sfxEvents.drain().some(e => e.id === 'coin')).toBe(false);
    const s = sim.getSnapshot();
    s.coins.push({ id: 91005, lane: s.player.lane, z: 0.1, y: 0.75, collected: false });
    tick(sim);
    expect(sim.sfxEvents.drain().some(e => e.id === 'coin')).toBe(true);
  });
  it('emits game over without hit when adrenaline runs out', () => {
    const sim = make('adrenaline');
    sim.playerSim.state.adrenaline = 0.00001;
    tick(sim);
    const ids = sim.sfxEvents.drain().map(e => e.id);
    expect(ids).toContain('gameOver'); expect(ids).not.toContain('hit');
    tick(sim); expect(sim.sfxEvents.drain()).toEqual([]);
  });
  it('clears unconsumed events on restart', () => {
    const sim = make();
    sim.sfxEvents.emit('hit', sim.getSfxState());
    sim.restart();
    expect(sim.sfxEvents.drain()).toEqual([]);
  });
  it('SFX consumption has no influence on seeded gameplay results', () => {
    const a = make('classic'), b = make('classic');
    for (let i = 0; i < 360; i++) {
      tick(a); tick(b);
      a.sfxEvents.drain();
    }
    const sa = a.getSnapshot(), sb = b.getSnapshot();
    expect(sa.player).toEqual(sb.player);
    expect(sa.obstacles).toEqual(sb.obstacles);
    expect(sa.coins).toEqual(sb.coins);
    expect(sa.runStats).toEqual(sb.runStats);
  });
});
