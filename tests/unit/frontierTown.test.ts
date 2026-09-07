import { describe, expect, it } from 'vitest';
import levelgenRaw from '../../configs/levelgen.default.json';
import type { LevelgenConfig } from '@core/config/schemas';
import { LevelGenerator } from '@core/levelgen/LevelGenerator';

const base = levelgenRaw as LevelgenConfig;

function townConfig(probability: number): LevelgenConfig {
  return {
    ...base,
    horse: {
      ...base.horse,
      frontierTownProbability: probability,
      frontierTownIntroChunks: 0,
      frontierTownMinChunks: 2,
      frontierTownMaxChunks: 2,
      frontierTownCooldownChunks: 2,
    },
  };
}

describe('Frontier Town scenery', () => {
  it('creates one non-colliding zone and themes every obstacle in its chunks', () => {
    const generator = new LevelGenerator(townConfig(1), 41);
    generator.setMode('horse');
    const first = generator.generateChunk(0);
    const second = generator.generateChunk(1);
    expect(first.sceneryZones).toEqual([
      expect.objectContaining({
        theme: 'frontierTown',
        z: base.contentStartZ,
        length: base.chunkLength * 2,
      }),
    ]);
    expect(second.sceneryZones).toEqual([]);
    expect(first.obstacles.length).toBeGreaterThan(0);
    expect(first.obstacles.every((item) => item.visualTheme === 'frontierTown')).toBe(true);
    expect(second.obstacles.every((item) => item.visualTheme === 'frontierTown')).toBe(true);
  });

  it('does not alter obstacle placement or count', () => {
    const plain = new LevelGenerator(townConfig(0), 73);
    const themed = new LevelGenerator(townConfig(1), 73);
    plain.setMode('horse');
    themed.setMode('horse');
    const stripTheme = (chunk: ReturnType<LevelGenerator['generateChunk']>) =>
      chunk.obstacles.map(({ visualTheme: _visualTheme, ...item }) => item);
    expect(stripTheme(themed.generateChunk(0))).toEqual(stripTheme(plain.generateChunk(0)));
  });
});
