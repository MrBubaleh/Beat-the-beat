import type { z } from 'zod';
import type { ConfigKey, Configs } from './schemas';
import { configSchemas } from './schemas';
import { configFallbacks } from './fallbacks';

export interface ConfigBootError {
  key: ConfigKey;
  issues: z.ZodIssue[];
}

export class ConfigStore {
  private readonly values = new Map<ConfigKey, unknown>();
  readonly bootErrors: ConfigBootError[] = [];

  constructor(initial: Partial<Record<ConfigKey, unknown>> = {}) {
    for (const key of Object.keys(configSchemas) as ConfigKey[]) {
      const raw = initial[key];
      if (raw !== undefined) {
        this.load(key, raw);
      }
    }
  }

  get<K extends ConfigKey>(key: K): Configs[K] {
    const value = this.values.get(key);
    if (value === undefined) {
      throw new Error(`[config] '${key}' is not loaded`);
    }
    return value as Configs[K];
  }

  has(key: ConfigKey): boolean {
    return this.values.has(key);
  }

  apply(key: ConfigKey, raw: unknown): boolean {
    const result = this.safeParse(key, raw);
    if (result.success) {
      this.values.set(key, result.data);
      return true;
    }
    console.error(`[config] invalid '${key}', keeping previous value:`, result.error.issues);
    return false;
  }

  private load(key: ConfigKey, raw: unknown): void {
    const result = this.safeParse(key, raw);
    if (result.success) {
      this.values.set(key, result.data);
      return;
    }
    this.bootErrors.push({ key, issues: result.error.issues });
    console.error(`[config] invalid '${key}', using fallback:`, result.error.issues);
    this.values.set(key, configFallbacks[key]);
  }

  private safeParse<K extends ConfigKey>(
    key: K,
    raw: unknown,
  ): z.SafeParseReturnType<unknown, Configs[K]> {
    return configSchemas[key].safeParse(raw) as z.SafeParseReturnType<unknown, Configs[K]>;
  }
}
