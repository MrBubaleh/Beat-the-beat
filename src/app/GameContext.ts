export class GameContext {
  private readonly registry = new Map<string | symbol, unknown>();

  provide<T>(key: string | symbol, value: T): void {
    if (this.registry.has(key)) {
      throw new Error(`GameContext: '${String(key)}' is already provided`);
    }
    this.registry.set(key, value);
  }

  get<T>(key: string | symbol): T {
    const value = this.registry.get(key);
    if (value === undefined) {
      throw new Error(`GameContext: missing '${String(key)}'`);
    }
    return value as T;
  }

  has(key: string | symbol): boolean {
    return this.registry.has(key);
  }
}
