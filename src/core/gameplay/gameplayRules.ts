export const GAMEPLAY_RULES_IDS = ['destroy', 'classic', 'adrenaline'] as const;

export type GameplayRulesId = (typeof GAMEPLAY_RULES_IDS)[number];

export const GAMEPLAY_RULES_STORAGE_KEY = 'gameplay-rules-id-v2';

export const DEFAULT_GAMEPLAY_RULES_ID: GameplayRulesId = 'destroy';

export interface GameplayRulesMeta {
  id: GameplayRulesId;
  label: string;
  description: string;
}

export const GAMEPLAY_RULES_PRESETS: readonly GameplayRulesMeta[] = [
  {
    id: 'destroy',
    label: 'Destroy',
    description: 'Ломай мелкие, копи нитро, дави средние; HP скрыт',
  },
  {
    id: 'classic',
    label: 'Classic',
    description: 'Три удара, без пассивного дренажа',
  },
  {
    id: 'adrenaline',
    label: 'Adrenaline',
    description: 'Шкала адреналина: дренаж, smash и риск держат в живых',
  },
];

export function shouldShowAdrenalineBar(rules: GameplayRulesId): boolean {
  return rules === 'adrenaline';
}

const PRESET_BY_ID = new Map(GAMEPLAY_RULES_PRESETS.map((preset) => [preset.id, preset]));

export function isGameplayRulesId(value: string): value is GameplayRulesId {
  return PRESET_BY_ID.has(value as GameplayRulesId);
}

export function loadStoredGameplayRulesId(): GameplayRulesId {
  try {
    const stored = localStorage.getItem(GAMEPLAY_RULES_STORAGE_KEY);
    if (stored && isGameplayRulesId(stored)) return stored;
  } catch {
    // ignore
  }
  return DEFAULT_GAMEPLAY_RULES_ID;
}

export function storeGameplayRulesId(id: GameplayRulesId): void {
  try {
    localStorage.setItem(GAMEPLAY_RULES_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}
