import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildObstacleModel,
  createObstacleTintOutline,
  createObstacleModelMaterials,
  resolveObstacleModelDimensions,
} from '../../src/render/ObstacleModels';
import type { ObstacleVisualVariant } from '../../src/render/obstacleVisualVariants';

const variants: ObstacleVisualVariant[] = [
  'road-cones', 'road-barrels', 'road-tires', 'road-barricade', 'nitro-canister',
  'bicycle', 'motor-scooter', 'kick-scooter', 'quad-bike', 'cargo-trike',
  'sedan', 'hatchback', 'pickup', 'coupe', 'wagon',
  'box-truck', 'city-bus', 'coach', 'dump-truck', 'semi',
  'split-fence', 'crate-stack', 'hay-bales', 'water-trough', 'fallen-log',
  'ranch-gate', 'saloon-awning', 'mine-frame', 'rock-arch', 'station-frame',
  'stagecoach', 'cargo-wagon', 'bison', 'mine-cart', 'frontier-barricade', 'boulder',
];

describe('obstacle model geometry', () => {
  it('constructs every variant with finite transforms and bounded silhouettes', () => {
    const materials = createObstacleModelMaterials();
    for (const variant of variants) {
      const model = buildObstacleModel(
        variant,
        { width: 1.9, height: 2.8, depth: 4.8, clearance: 1.45 },
        materials,
      );
      let meshCount = 0;
      model.root.traverse((item) => {
        if (!(item instanceof THREE.Mesh)) return;
        meshCount += 1;
        for (const value of [
          item.position.x, item.position.y, item.position.z,
          item.scale.x, item.scale.y, item.scale.z,
        ]) {
          expect(Number.isFinite(value), variant).toBe(true);
        }
        expect(item.scale.x, variant).toBeGreaterThan(0);
        expect(item.scale.y, variant).toBeGreaterThan(0);
        expect(item.scale.z, variant).toBeGreaterThan(0);
      });
      expect(meshCount, variant).toBeGreaterThan(0);
      model.root.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
      expect(size.x, variant).toBeLessThan(5.5);
      expect(size.y, variant).toBeLessThan(6.5);
      expect(size.z, variant).toBeLessThan(8.5);
    }
  });

  it('provides rolling parts for every road vehicle family', () => {
    const materials = createObstacleModelMaterials();
    for (const variant of [
      'bicycle', 'motor-scooter', 'kick-scooter', 'quad-bike', 'cargo-trike',
      'sedan', 'hatchback', 'pickup', 'coupe', 'wagon',
      'box-truck', 'city-bus', 'coach', 'dump-truck', 'semi',
    ] as const) {
      const model = buildObstacleModel(
        variant,
        { width: 1.9, height: 2.8, depth: 4.8, clearance: 0 },
        materials,
      );
      expect(model.wheels.length, variant).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses readable variant-specific visuals for micro props without changing collision data', () => {
    const collision = { width: 0.408, height: 0.72, depth: 0.882, clearance: 0 };
    expect(resolveObstacleModelDimensions('road-barricade', collision)).toEqual({
      width: 1.3,
      height: 0.9,
      depth: 0.58,
      clearance: 0,
    });
    expect(resolveObstacleModelDimensions('quad-bike', collision).depth).toBeGreaterThan(1.4);
    expect(resolveObstacleModelDimensions('cargo-trike', collision).width).toBeGreaterThan(0.9);
    expect(collision).toEqual({ width: 0.408, height: 0.72, depth: 0.882, clearance: 0 });
  });

  it('builds a readable nitro canister micro silhouette', () => {
    const model = buildObstacleModel(
      'nitro-canister',
      { width: 0.41, height: 0.72, depth: 0.88, clearance: 0 },
      createObstacleModelMaterials(),
    );
    expect(model.tintMeshes.length).toBeGreaterThanOrEqual(4);
    model.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(0.55);
    expect(size.y).toBeLessThan(0.68);
    expect(size.x).toBeGreaterThan(0.3);
  });

  it('adds round front and rectangular rear lamps to every medium car silhouette', () => {
    const model = buildObstacleModel(
      'sedan',
      { width: 1.2, height: 1.1, depth: 2.32, clearance: 0 },
      createObstacleModelMaterials(),
    );
    expect(model.lightMeshes).toHaveLength(2);
    expect(model.rearLightMeshes).toHaveLength(2);
    expect(model.lightMeshes.every((lamp) => lamp.geometry.type === 'CylinderGeometry')).toBe(
      true,
    );
    expect(model.rearLightMeshes.every((lamp) => lamp.geometry.type === 'BoxGeometry')).toBe(
      true,
    );
    expect(model.lightMeshes.filter((lamp) => lamp.position.z > 0)).toHaveLength(2);
    expect(model.rearLightMeshes.filter((lamp) => lamp.position.z < 0)).toHaveLength(2);
  });

  it('builds an optional outline from the actual tinted car geometry', () => {
    const model = buildObstacleModel(
      'sedan',
      { width: 1.2, height: 1.1, depth: 2.32, clearance: 0 },
      createObstacleModelMaterials(),
    );
    const outline = createObstacleTintOutline(model);
    expect(outline.lines).toHaveLength(model.tintMeshes.length);
    expect(outline.lines.every((line) => line.parent instanceof THREE.Mesh)).toBe(true);
    expect(outline.lines.every((line) => line.visible === false)).toBe(true);
  });

  it('keeps the cargo wagon canopy inside a single-lane silhouette', () => {
    const model = buildObstacleModel(
      'cargo-wagon',
      { width: 1.5, height: 2.05, depth: 5.1, clearance: 0 },
      createObstacleModelMaterials(),
    );
    model.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(1.9);
    expect(size.y).toBeGreaterThan(1.9);
  });

  it('gives horse crates a full readable low silhouette and tall carts a red upper mass', () => {
    const materials = createObstacleModelMaterials();
    const crates = buildObstacleModel(
      'crate-stack',
      { width: 1.2, height: 1.1, depth: 2.32, clearance: 0 },
      materials,
    );
    crates.root.updateMatrixWorld(true);
    const crateSize = new THREE.Box3().setFromObject(crates.root).getSize(new THREE.Vector3());
    expect(crateSize.x).toBeGreaterThan(1.1);
    expect(crateSize.y).toBeGreaterThan(1);
    expect(crates.tintMeshes.length).toBeGreaterThanOrEqual(3);

    const mineCart = buildObstacleModel(
      'mine-cart',
      { width: 1.5, height: 2.05, depth: 5.1, clearance: 0 },
      materials,
    );
    mineCart.root.updateMatrixWorld(true);
    const redMass = new THREE.Box3();
    for (const mesh of mineCart.tintMeshes) redMass.expandByObject(mesh);
    expect(redMass.getSize(new THREE.Vector3()).y).toBeGreaterThan(1.4);
  });
});
