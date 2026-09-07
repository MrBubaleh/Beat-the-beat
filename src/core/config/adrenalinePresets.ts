import defaultOverrides from '../../../configs/adrenaline/presets/default.json';
import highRiskOverrides from '../../../configs/adrenaline/presets/high-risk.json';
import oxAlphaOverrides from '../../../configs/adrenaline/presets/ox-alpha.json';
import grokPressureOverrides from '../../../configs/adrenaline/presets/grok-pressure.json';
import gpt5RedlineOverrides from '../../../configs/adrenaline/presets/gpt-5-redline.json';
import {
  adrenalineConfigSchema,
  type AdrenalineConfig,
  type GameConfig,
} from './schemas';
import { deepMerge } from './deepMerge';

export const ADRENALINE_PRESET_STORAGE_KEY = 'adrenaline-preset-id';

export const ADRENALINE_PRESET_IDS = [
  'default',
  'high-risk',
  'ox-alpha',
  'grok-pressure',
  'gpt-5-redline',
] as const;

export type AdrenalinePresetId = (typeof ADRENALINE_PRESET_IDS)[number];

export const DEFAULT_ADRENALINE_PRESET_ID: AdrenalinePresetId = 'default';

export const PLAYER_ADRENALINE_PRESET_ID: AdrenalinePresetId = 'default';

export interface AdrenalinePresetMeta {
  id: AdrenalinePresetId;
  label: string;
  description: string;
  overrideLayers: readonly Partial<AdrenalineConfig>[];
}

export const ADRENALINE_PRESETS: readonly AdrenalinePresetMeta[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Базовый баланс из game.default.json → adrenaline',
    overrideLayers: [defaultOverrides as Partial<AdrenalineConfig>],
  },
  {
    id: 'high-risk',
    label: 'High Risk',
    description: 'Быстрее дренаж, жёстче удар, слабее монеты — пример экспериментального пресета',
    overrideLayers: [highRiskOverrides as Partial<AdrenalineConfig>],
  },
  {
    id: 'ox-alpha',
    label: 'Ox Alpha',
    description: 'Медленное удушье: спокойный фон, но простой в полосе душит — двигайся или тай',
    overrideLayers: [oxAlphaOverrides as Partial<AdrenalineConfig>],
  },
  {
    id: 'grok-pressure',
    label: 'Grok Pressure',
    description: 'Жёсткий дренаж и idle: выживаешь темпом — smash, near miss и монеты кормят, удар как default',
    overrideLayers: [grokPressureOverrides as Partial<AdrenalineConfig>],
  },
  {
    id: 'gpt-5-redline',
    label: 'GPT-5 Redline',
    description: 'Управляемая красная зона: давление растёт, а активная игра возвращает контроль',
    overrideLayers: [gpt5RedlineOverrides as Partial<AdrenalineConfig>],
  },
];

const PRESET_BY_ID = new Map(ADRENALINE_PRESETS.map((preset) => [preset.id, preset]));

export function isAdrenalinePresetId(value: string): value is AdrenalinePresetId {
  return PRESET_BY_ID.has(value as AdrenalinePresetId);
}

export function getAdrenalinePresetMeta(id: AdrenalinePresetId): AdrenalinePresetMeta {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) throw new Error(`[adrenaline-preset] unknown preset '${id}'`);
  return preset;
}

export function loadStoredAdrenalinePresetId(): AdrenalinePresetId {
  try {
    const stored = localStorage.getItem(ADRENALINE_PRESET_STORAGE_KEY);
    if (stored && isAdrenalinePresetId(stored)) return stored;
  } catch {
    // localStorage may be unavailable in tests
  }
  return DEFAULT_ADRENALINE_PRESET_ID;
}

export function resolveBootAdrenalinePresetId(devUi: boolean): AdrenalinePresetId {
  if (devUi) return loadStoredAdrenalinePresetId();
  return PLAYER_ADRENALINE_PRESET_ID;
}

export function storeAdrenalinePresetId(id: AdrenalinePresetId): void {
  try {
    localStorage.setItem(ADRENALINE_PRESET_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function mergeAdrenalineOverrideLayers(
  base: AdrenalineConfig,
  layers: readonly Partial<AdrenalineConfig>[],
): AdrenalineConfig {
  let merged = base as Record<string, unknown>;
  for (const layer of layers) {
    merged = deepMerge(merged, layer as Record<string, unknown>);
  }
  return merged as AdrenalineConfig;
}

export function resolveAdrenalinePreset(
  presetId: AdrenalinePresetId,
  baseGame: GameConfig,
): AdrenalineConfig {
  const preset = getAdrenalinePresetMeta(presetId);
  const merged = mergeAdrenalineOverrideLayers(baseGame.adrenaline, preset.overrideLayers);
  const parsed = adrenalineConfigSchema.safeParse(merged);
  if (!parsed.success) {
    console.error(
      `[adrenaline-preset] invalid merge for '${presetId}', using base:`,
      parsed.error.issues,
    );
    return baseGame.adrenaline;
  }
  return parsed.data;
}

export function resolveGameWithAdrenalinePreset(
  presetId: AdrenalinePresetId,
  baseGame: GameConfig,
): GameConfig {
  return {
    ...baseGame,
    adrenaline: resolveAdrenalinePreset(presetId, baseGame),
  };
}
