import { describe, expect, it } from 'vitest';
import { isDevUiEnabled } from '../../src/app/devUi';
import {
  DEFAULT_LEVELGEN_PRESET_ID,
  PLAYER_DIFFICULTY_PRESET_IDS,
  isPlayerDifficultyPresetId,
  levelgenPresetUiLabel,
  listLevelgenPresetsForUi,
  getLevelgenPresetMeta,
} from '../../src/core/config/levelgenPresets';
import {
  DEFAULT_ADRENALINE_PRESET_ID,
  PLAYER_ADRENALINE_PRESET_ID,
  resolveBootAdrenalinePresetId,
} from '../../src/core/config/adrenalinePresets';

describe('beta contract: player difficulty and dev UI', () => {
  it('maps three player labels onto existing passable presets', () => {
    expect(PLAYER_DIFFICULTY_PRESET_IDS).toEqual([
      'grok-traffic',
      'mega-traffic',
      'ultimate-traffic',
    ]);
    expect(DEFAULT_LEVELGEN_PRESET_ID).toBe('mega-traffic');
    expect(levelgenPresetUiLabel(getLevelgenPresetMeta('grok-traffic'), false)).toBe(
      'Спокойнее',
    );
    expect(levelgenPresetUiLabel(getLevelgenPresetMeta('mega-traffic'), false)).toBe(
      'Обычный',
    );
    expect(levelgenPresetUiLabel(getLevelgenPresetMeta('ultimate-traffic'), false)).toBe(
      'Мясо',
    );
    expect(listLevelgenPresetsForUi(false).map((preset) => preset.id)).toEqual([
      ...PLAYER_DIFFICULTY_PRESET_IDS,
    ]);
    expect(listLevelgenPresetsForUi(true).length).toBeGreaterThan(3);
    expect(isPlayerDifficultyPresetId('horse-traffic')).toBe(false);
  });

  it('hides experimental adrenaline from the player boot path', () => {
    expect(PLAYER_ADRENALINE_PRESET_ID).toBe('default');
    expect(DEFAULT_ADRENALINE_PRESET_ID).toBe('default');
    expect(resolveBootAdrenalinePresetId(false)).toBe('default');
  });

  it('enables raw presets only with ?dev=1', () => {
    expect(isDevUiEnabled('')).toBe(false);
    expect(isDevUiEnabled('?dev=0')).toBe(false);
    expect(isDevUiEnabled('?dev=1')).toBe(true);
  });
});
