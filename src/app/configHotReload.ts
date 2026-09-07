import type { ConfigStore } from '@core/config/ConfigStore';
import type { ConfigKey } from '@core/config/schemas';

interface ConfigUpdateMessage {
  key: ConfigKey;
  raw: unknown;
}

export interface ConfigHotReloadHooks {
  onUpdate?: (key: ConfigKey, applied: boolean) => void;
}

export function installConfigHotUpdate(
  store: ConfigStore,
  hooks: ConfigHotReloadHooks = {},
): void {
  if (!import.meta.hot) return;

  import.meta.hot.on('config:update', (message: ConfigUpdateMessage) => {
    const applied = store.apply(message.key, message.raw);
    console.log(`[config] hot-reload '${message.key}': ${applied ? 'applied' : 'rejected'}`);
    hooks.onUpdate?.(message.key, applied);
  });
}
