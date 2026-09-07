import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TutorialArrows } from '@render/TutorialArrows';
import { TutorialController } from '@core/tutorial/TutorialController';
import type { TutorialIntent } from '@core/tutorial/TutorialController';
import game from '../../configs/game.default.json';

function intent(pitch: number): TutorialIntent {
  return {
    active: true, stage: 'jump', targetObstacleId: 1,
    arrowPose: { x: 2, y: 3, z: 25, pitch, yaw: 0 },
    arrowColor: 'turquoise', slowMoBlend: 0, timeScale: 1,
  };
}

describe('TutorialArrows', () => {
  it.each([
    [0, new THREE.Vector3(0, 1, 0)],
    [Math.PI, new THREE.Vector3(0, -1, 0)],
    [Math.PI / 2, new THREE.Vector3(0, 0, 1)],
  ])('orients the 3D arrow at pitch %s', (pitch, expected) => {
    const arrows = new TutorialArrows();
    arrows.update(intent(pitch), 0);
    const direction = new THREE.Vector3(0, 1, 0).applyEuler(arrows.root.rotation);
    expect(direction.distanceTo(expected)).toBeLessThan(1e-6);
    expect(arrows.root.position.x).toBe(2);
    expect(arrows.root.position.z).toBe(25);
    for (const child of arrows.root.children) expect(child.renderOrder).toBeGreaterThanOrEqual(12);
    arrows.dispose();
  });

  it('lays nitro above the road pointing forward from the camera toward the car', () => {
    const arrows = new TutorialArrows();
    const state = intent(Math.PI / 2);
    state.stage = 'nitro';
    state.arrowPose!.yaw = 0;
    state.arrowPose!.y = 0.35;
    arrows.update(state, 0);
    const direction = new THREE.Vector3(0, 1, 0).applyEuler(arrows.root.rotation);
    expect(direction.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
    const bounds = new THREE.Box3().setFromObject(arrows.root);
    expect(bounds.min.y).toBeGreaterThan(0);
    expect(bounds.max.y).toBeLessThan(0.8);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(3);
    arrows.dispose();
  });

  it('uses scene depth and moves gently along each action direction', () => {
    for (const stage of ['nitro', 'jump', 'slide'] as const) {
      const arrows = new TutorialArrows();
      const state = intent(stage === 'nitro' ? Math.PI / 2 : stage === 'slide' ? Math.PI : 0);
      state.stage = stage;
      arrows.update(state, 0);
      const start = arrows.root.position.clone();
      arrows.update(state, 0.2);
      const offset = arrows.root.position.clone().sub(start);
      expect(offset.length()).toBeGreaterThan(0.1);
      expect(offset.length()).toBeLessThan(0.23);
      expect(offset.x).toBe(0);
      if (stage === 'nitro') {
        expect(offset.y).toBe(0);
        expect(offset.z).toBeGreaterThan(0);
      } else {
        expect(offset.z).toBe(0);
        expect(Math.sign(offset.y)).toBe(stage === 'jump' ? 1 : -1);
      }
      const material = (arrows.root.children[0] as THREE.Mesh).material as THREE.Material;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(true);
      arrows.dispose();
    }
  });

  it('freezes animation at dt=0, hides on inactive intent and frees resources', () => {
    const arrows = new TutorialArrows();
    arrows.update(intent(0), 0.2);
    const position = arrows.root.position.clone();
    const scale = arrows.root.scale.clone();
    arrows.update(intent(0), 0);
    expect(arrows.root.position).toEqual(position);
    expect(arrows.root.scale).toEqual(scale);
    arrows.update(new TutorialController(game).suspend(), 0);
    expect(arrows.root.visible).toBe(false);
    const mesh = arrows.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const freeGeometry = vi.spyOn(mesh.geometry, 'dispose');
    const freeMaterial = vi.spyOn(mesh.material, 'dispose');
    arrows.dispose();
    expect(freeGeometry).toHaveBeenCalledOnce();
    expect(freeMaterial).toHaveBeenCalledOnce();
  });
});
