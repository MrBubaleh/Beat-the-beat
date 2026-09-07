import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { videoStaticPlugin } from './vite.videoStatic';

const aliases = {
  '@core': path.resolve(__dirname, 'src/core'),
  '@audio': path.resolve(__dirname, 'src/audio'),
  '@input': path.resolve(__dirname, 'src/input'),
  '@render': path.resolve(__dirname, 'src/render'),
  '@app': path.resolve(__dirname, 'src/app'),
  '@ui': path.resolve(__dirname, 'src/ui'),
};

const CONFIG_DIR = path.resolve(__dirname, 'configs');

function configHotReload(): Plugin {
  const isConfigFile = (file: string): boolean =>
    file.endsWith('.json') && file.startsWith(CONFIG_DIR + path.sep);

  return {
    name: 'config-hot-reload',
    configureServer(server) {
      const handle = (file: string): void => {
        if (!isConfigFile(file)) return;
        const key = path.basename(file, '.json').replace(/\.default$/, '');
        void (async () => {
          let raw: unknown;
          try {
            raw = JSON.parse(await readFile(file, 'utf-8'));
          } catch {
            raw = null;
          }
          server.ws.send({ type: 'custom', event: 'config:update', data: { key, raw } });
        })();
      };
      server.watcher.on('change', handle);
      server.watcher.on('add', handle);
    },
  };
}

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  server: {
    open: true,
  },
  plugins: [configHotReload(), videoStaticPlugin()],
});
