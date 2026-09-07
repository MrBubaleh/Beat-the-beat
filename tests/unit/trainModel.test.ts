import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TRAIN_MAX_CARS,
  createTrainDetailMaterials,
  createTrainModel,
  layoutTrain,
  paintTrain,
  planTrainLayout,
} from '../../src/render/TrainModel';

const WIDTH = 2.1;
const HEIGHT = 2.7;

function createMaterials() {
  const details = createTrainDetailMaterials();
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x5a258f }),
    accent: new THREE.MeshStandardMaterial({ color: 0xb85cff }),
    ...details,
  };
}

function visibleSize(root: THREE.Object3D): THREE.Vector3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible) return;
    let parent: THREE.Object3D | null = child;
    while (parent) {
      if (!parent.visible) return;
      parent = parent.parent;
    }
    box.expandByObject(child);
  });
  return box.getSize(new THREE.Vector3());
}

describe('train model layout', () => {
  it('keeps cars and noses inside the train length', () => {
    for (const length of [12, 18, 31, 48, 70]) {
      const layout = planTrainLayout(length);
      const assembled = 2 * layout.noseLength + layout.carCount * layout.carLength;
      expect(assembled, `${length}`).toBeCloseTo(length, 5);
      expect(layout.carCount, `${length}`).toBeLessThanOrEqual(TRAIN_MAX_CARS);
      expect(layout.noseLength, `${length}`).toBeGreaterThan(3);
      if (layout.carCount > 0) {
        expect(layout.carLength, `${length}`).toBeGreaterThanOrEqual(3.8 - 1e-6);
      }
    }
  });

  it('builds a finite N700 silhouette within the hitbox', () => {
    const materials = createMaterials();
    const model = createTrainModel(WIDTH, HEIGHT, materials);
    for (const length of [12, 31, 70]) {
      layoutTrain(model, length);
      let meshCount = 0;
      model.root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        meshCount += 1;
        for (const value of [
          child.position.x, child.position.y, child.position.z,
          child.scale.x, child.scale.y, child.scale.z,
        ]) {
          expect(Number.isFinite(value), `${length}`).toBe(true);
        }
        expect(child.scale.x, `${length}`).toBeGreaterThan(0);
        expect(child.scale.y, `${length}`).toBeGreaterThan(0);
        expect(child.scale.z, `${length}`).toBeGreaterThan(0);
      });
      expect(meshCount).toBeGreaterThan(20);
      const size = visibleSize(model.root);
      expect(size.x, `${length}`).toBeLessThan(WIDTH * 1.08);
      expect(size.y, `${length}`).toBeLessThan(HEIGHT + 0.2);
      expect(size.z, `${length}`).toBeLessThan(length * 1.04);
      expect(size.z, `${length}`).toBeGreaterThan(length * 0.9);
    }
  });

  it('paints body and accent meshes for both color variants', () => {
    const materials = createMaterials();
    const model = createTrainModel(WIDTH, HEIGHT, materials);
    layoutTrain(model, 31);
    const altBody = new THREE.MeshStandardMaterial({ color: 0x164f80 });
    const altAccent = new THREE.MeshStandardMaterial({ color: 0x39d9ff });
    paintTrain(model, altBody, altAccent);
    let bodyCount = 0;
    let accentCount = 0;
    model.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.userData.trainPaint === 'body') {
        expect(child.material).toBe(altBody);
        bodyCount += 1;
      }
      if (child.userData.trainPaint === 'accent') {
        expect(child.material).toBe(altAccent);
        accentCount += 1;
      }
    });
    expect(bodyCount).toBeGreaterThan(8);
    expect(accentCount).toBeGreaterThan(8);
  });
});
