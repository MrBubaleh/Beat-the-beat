import levelgenDefault from '../../../configs/levelgen.default.json';
import type { LevelgenConfig } from './schemas';
import { levelgenConfigSchema } from './schemas';
import { deepMerge } from './deepMerge';

export const LEVELGEN_PRESET_STORAGE_KEY = 'levelgen-preset-id';

export const LEVELGEN_PRESET_IDS = [
  'production',
  'structured-traffic',
  'ox-alpha',
  'grok-traffic',
  'gpt-5-traffic',
  'curated-traffic',
  'ultimate-traffic',
  'mega-traffic',
  'horse-traffic',
] as const;

export type LevelgenPresetId = (typeof LEVELGEN_PRESET_IDS)[number];

export const DEFAULT_LEVELGEN_PRESET_ID: LevelgenPresetId = 'mega-traffic';

export type LevelgenPresetAudience = 'player' | 'dev';

export const PLAYER_DIFFICULTY_PRESET_IDS = [
  'grok-traffic',
  'mega-traffic',
  'ultimate-traffic',
] as const;

export type PlayerDifficultyPresetId = (typeof PLAYER_DIFFICULTY_PRESET_IDS)[number];

export interface LevelgenPresetBranches {
  shared: Partial<LevelgenConfig>;
  car: {
    balance: Partial<LevelgenConfig>;
    phases: Partial<LevelgenConfig>;
  };
  horse: {
    balance: Partial<LevelgenConfig>;
    phases: Partial<LevelgenConfig>;
  };
}

export interface LevelgenPresetMeta {
  id: LevelgenPresetId;
  label: string;
  description: string;
  audience: LevelgenPresetAudience;
  playerLabel?: string;
  branches: LevelgenPresetBranches;
  overrideLayers: readonly Partial<LevelgenConfig>[];
}

type LevelgenPresetDefinition = Omit<
  LevelgenPresetMeta,
  'branches' | 'overrideLayers'
>;

const PRESET_LAYER_MODULES = import.meta.glob<Partial<LevelgenConfig>>(
  '../../../configs/levelgen/presets/*/*.json',
  { eager: true, import: 'default' },
);

function loadPresetLayer(
  id: LevelgenPresetId,
  filename: string,
): Partial<LevelgenConfig> {
  const path = `../../../configs/levelgen/presets/${id}/${filename}`;
  const layer = PRESET_LAYER_MODULES[path];
  if (!layer) throw new Error(`[levelgen-preset] missing layer '${path}'`);
  return layer;
}

function definePreset(definition: LevelgenPresetDefinition): LevelgenPresetMeta {
  const branches: LevelgenPresetBranches = {
    shared: loadPresetLayer(definition.id, 'shared-balance.json'),
    car: {
      balance: loadPresetLayer(definition.id, 'car-balance.json'),
      phases: loadPresetLayer(definition.id, 'car-phases.json'),
    },
    horse: {
      balance: loadPresetLayer(definition.id, 'horse-balance.json'),
      phases: loadPresetLayer(definition.id, 'horse-phases.json'),
    },
  };
  return {
    ...definition,
    branches,
    overrideLayers: [
      branches.shared,
      branches.car.balance,
      branches.horse.balance,
      branches.car.phases,
      branches.horse.phases,
    ],
  };
}

const LEVELGEN_PRESET_DEFINITIONS: readonly LevelgenPresetDefinition[] = [
  {
    id: 'production',
    label: 'Production',
    description: 'Текущий боевой баланс levelgen',
    audience: 'dev',
  },
  {
    id: 'structured-traffic',
    label: 'Structured Traffic',
    description: 'Фазовая дорога: потоки, переплетения, лёгкий отдых, нитро-провокация',
    audience: 'dev',
  },
  {
    id: 'ox-alpha',
    label: 'Ox Alpha',
    description: 'Независимый профиль: колонны и переплетения 50/50, частые передышки, жирный риск',
    audience: 'dev',
  },
  {
    id: 'grok-traffic',
    label: 'Grok Traffic',
    description: 'Читаемые колонны и щели, короткие густые передышки, регулярный nitro-tease',
    audience: 'player',
    playerLabel: 'Спокойнее',
  },
  {
    id: 'gpt-5-traffic',
    label: 'GPT-5 Traffic',
    description: 'Структурные волны: колонны, переплетения, живые передышки и риск-награда',
    audience: 'dev',
  },
  {
    id: 'curated-traffic',
    label: 'Curated Traffic',
    description: 'Сборка лучших настроек: колонны Grok, weave/risk Ox, волны и late-game GPT-5',
    audience: 'dev',
  },
  {
    id: 'ultimate-traffic',
    label: 'Ultimate Traffic',
    description: 'Максимум по всем акцентам: читаемые колонны и щели, живые паузы, нитро, риск и рост к концу',
    audience: 'player',
    playerLabel: 'Мясо',
  },
  {
    id: 'mega-traffic',
    label: 'Mega Traffic',
    description: 'Максимальный контраст: строгие колонны, сложные щели, лёгкие паузы, нитро и щедрый риск',
    audience: 'player',
    playerLabel: 'Обычный',
  },
  {
    id: 'horse-traffic',
    label: 'Horse Traffic',
    description: 'Профиль для коня: corridor/weave/breather/overdriveTease; машина без car-phases',
    audience: 'dev',
  },
];

export const LEVELGEN_PRESETS: readonly LevelgenPresetMeta[] =
  LEVELGEN_PRESET_DEFINITIONS.map(definePreset);

const PRESET_BY_ID = new Map(LEVELGEN_PRESETS.map((preset) => [preset.id, preset]));

export function isLevelgenPresetId(value: string): value is LevelgenPresetId {
  return PRESET_BY_ID.has(value as LevelgenPresetId);
}

export function isPlayerDifficultyPresetId(
  value: string,
): value is PlayerDifficultyPresetId {
  return (PLAYER_DIFFICULTY_PRESET_IDS as readonly string[]).includes(value);
}

export function levelgenPresetUiLabel(
  preset: LevelgenPresetMeta,
  devUi: boolean,
): string {
  if (preset.audience === 'player' && preset.playerLabel) return preset.playerLabel;
  return devUi ? `dev: ${preset.label}` : preset.label;
}

export function listLevelgenPresetsForUi(devUi: boolean): readonly LevelgenPresetMeta[] {
  if (devUi) return LEVELGEN_PRESETS;
  return PLAYER_DIFFICULTY_PRESET_IDS.map((id) => getLevelgenPresetMeta(id));
}

export function resolveBootLevelgenPresetId(devUi: boolean): LevelgenPresetId {
  const stored = loadStoredLevelgenPresetId();
  if (devUi || isPlayerDifficultyPresetId(stored)) return stored;
  return DEFAULT_LEVELGEN_PRESET_ID;
}

export function getLevelgenPresetMeta(id: LevelgenPresetId): LevelgenPresetMeta {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) throw new Error(`[levelgen-preset] unknown preset '${id}'`);
  return preset;
}

export function loadStoredLevelgenPresetId(): LevelgenPresetId {
  try {
    const stored = localStorage.getItem(LEVELGEN_PRESET_STORAGE_KEY);
    if (stored && isLevelgenPresetId(stored)) return stored;
  } catch {
    // localStorage may be unavailable in tests
  }
  return DEFAULT_LEVELGEN_PRESET_ID;
}

export function storeLevelgenPresetId(id: LevelgenPresetId): void {
  try {
    localStorage.setItem(LEVELGEN_PRESET_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function mergeLevelgenOverrideLayers(
  base: LevelgenConfig,
  layers: readonly Partial<LevelgenConfig>[],
): LevelgenConfig {
  let merged = base as Record<string, unknown>;
  for (const layer of layers) {
    merged = deepMerge(merged, layer as Record<string, unknown>);
  }
  return merged as LevelgenConfig;
}

export function resolveLevelgenPreset(
  presetId: LevelgenPresetId,
  base: LevelgenConfig = levelgenDefault as LevelgenConfig,
): LevelgenConfig {
  const preset = getLevelgenPresetMeta(presetId);
  const merged = mergeLevelgenOverrideLayers(base, preset.overrideLayers);
  const parsed = levelgenConfigSchema.safeParse(merged);
  if (!parsed.success) {
    console.error(
      `[levelgen-preset] invalid merge for '${presetId}', using base:`,
      parsed.error.issues,
    );
    return base;
  }
  return parsed.data;
}
