import sfxRaw from '../../../configs/sfx.default.json';
import { ConfigStore } from './ConfigStore';
import type { ConfigKey } from './schemas';
import gameRaw from '../../../configs/game.default.json';
import directorRaw from '../../../configs/director.default.json';
import levelgenRaw from '../../../configs/levelgen.default.json';
import audioRaw from '../../../configs/audio.default.json';
import debugRaw from '../../../configs/debug.default.json';

export function createConfigStore(): ConfigStore {
  return new ConfigStore({
    sfx: sfxRaw,
    game: gameRaw,
    director: directorRaw,
    levelgen: levelgenRaw,
    audio: audioRaw,
    debug: debugRaw,
  });
}

const CONFIG_MODULES: Array<[ConfigKey, string]> = [
  ['sfx', '../../../configs/sfx.default.json'],
  ['game', '../../../configs/game.default.json'],
  ['director', '../../../configs/director.default.json'],
  ['levelgen', '../../../configs/levelgen.default.json'],
  ['audio', '../../../configs/audio.default.json'],
  ['debug', '../../../configs/debug.default.json'],
];

if (import.meta.hot) {
  import.meta.hot.accept(
    CONFIG_MODULES.map(([, spec]) => spec),
    () => {},
  );
}
