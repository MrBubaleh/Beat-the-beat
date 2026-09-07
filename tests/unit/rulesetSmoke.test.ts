import { describe, expect, it } from 'vitest';
import gameRaw from '../../configs/game.default.json';
import levelgenRaw from '../../configs/levelgen.default.json';
import directorRaw from '../../configs/director.default.json';
import type { DirectorConfig, GameConfig, LevelgenConfig } from '@core/config/schemas';
import { GameSim } from '@core/gameplay/GameSim';
import {
  DEFAULT_GAMEPLAY_RULES_ID,
  GAMEPLAY_RULES_PRESETS,
  shouldShowAdrenalineBar,
  type GameplayRulesId,
} from '@core/gameplay/gameplayRules';
import { PassthroughDirector } from '@core/director/PassthroughDirector';
import { emptyMusic } from './musicHelpers';

const game = gameRaw as GameConfig;
const levelgen = levelgenRaw as LevelgenConfig;
const directorCfg = directorRaw as DirectorConfig;

function makeSim(rules: GameplayRulesId): GameSim {
  return new GameSim({
    game,
    levelgen,
    gameplayRules: rules,
    director: new PassthroughDirector(directorCfg),
    consumeInput: () => [],
    nowMs: () => 0,
    getSongProgress: () => 0,
    getMusic: () => emptyMusic(),
    seed: 4242,
  });
}

function groundCoins(sim: GameSim) {
  return sim.getSnapshot().coins.filter(
    (coin) =>
      coin.airPathId === undefined &&
      coin.airTargetTime === undefined &&
      coin.trainId === undefined,
  );
}

function forceGameOver(sim: GameSim, rules: GameplayRulesId): void {
  if (rules === 'adrenaline') {
    sim.playerSim.state.adrenaline = 0;
    sim.playerSim.registerHit();
    return;
  }
  for (let i = 0; i < 12 && !sim.gameOver; i++) {
    sim.playerSim.registerHit();
  }
}

describe('ruleset smoke (Classic / Adrenaline / Destroy)', () => {
  it('exposes player-facing ruleset names and Destroy as default', () => {
    expect(DEFAULT_GAMEPLAY_RULES_ID).toBe('destroy');
    expect(GAMEPLAY_RULES_PRESETS.map((preset) => preset.label)).toEqual([
      'Destroy',
      'Classic',
      'Adrenaline',
    ]);
    expect(shouldShowAdrenalineBar('destroy')).toBe(false);
    expect(shouldShowAdrenalineBar('classic')).toBe(false);
    expect(shouldShowAdrenalineBar('adrenaline')).toBe(true);
  });

  it.each(['classic', 'adrenaline'] as const)(
    '%s starts, keeps its HUD contract, switches transports, dies and restarts',
    (rules) => {
      const sim = makeSim(rules);
      const start = sim.getSnapshot();
      expect(start.gameplayRules).toBe(rules);
      expect(start.player.gameOver).toBe(false);
      expect(start.player.mode).toBe('car');
      expect(start.adrenalineMax).toBeGreaterThan(0);

      for (let i = 0; i < 600; i++) sim.fixedUpdate(1 / 60);
      const running = sim.getSnapshot();
      expect(running.obstacles.length).toBeGreaterThan(0);
      expect(running.player.mode).toBe('car');
      if (rules === 'classic') {
        expect(groundCoins(sim).length).toBeGreaterThan(0);
      }

      sim.playerSim.switchMode('horse');
      expect(sim.getSnapshot().player.mode).toBe('horse');
      sim.playerSim.switchMode('rocket');
      expect(sim.getSnapshot().player.mode).toBe('rocket');
      sim.playerSim.switchMode('car');
      expect(sim.getSnapshot().player.mode).toBe('car');

      forceGameOver(sim, rules);
      expect(sim.gameOver).toBe(true);

      sim.restart();
      const again = sim.getSnapshot();
      expect(again.player.gameOver).toBe(false);
      expect(again.gameplayRules).toBe(rules);
      expect(again.player.mode).toBe('car');
      expect(again.player.distance).toBe(0);
    },
  );
});
