import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createHorseFirstPersonView,
  updateHorseFirstPersonView,
} from '../../src/render/HorseFirstPersonView';

describe('horse first-person view', () => {
  function createRig() {
    const head = new THREE.Group();
    head.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.25, 0.45),
        new THREE.MeshBasicMaterial(),
      ),
    );
    return createHorseFirstPersonView(
      head,
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    );
  }

  it('builds a connected head, neck, mane and withers silhouette', () => {
    const rig = createRig();
    expect(rig.root.userData.sceneryKind).toBe('horse-fps-bust');
    expect(rig.head.userData.horseFpsPart).toBe('head');
    expect(rig.neck.userData.horseFpsPart).toBe('neck');
    expect(rig.mane.userData.horseFpsPart).toBe('mane');
    expect(rig.withers.userData.horseFpsPart).toBe('withers');
    expect(rig.neck.position.y).toBeLessThan(rig.head.position.y);
    expect(rig.withers.position.z).toBeLessThan(rig.head.position.z);
  });

  it('moves the entire bust as one camera-local rig', () => {
    const rig = createRig();
    updateHorseFirstPersonView(rig, {
      visible: true,
      gaitPhase: 0.8,
      speedNorm: 0.7,
      turnBlend: 0.6,
      slideBlend: 0,
      slideBank: 0,
      boostShake: 0,
      landingSquat: 0,
      landingSquatHeadY: 0,
    });
    expect(rig.root.visible).toBe(true);
    expect(rig.root.position.y).toBeGreaterThan(-0.55);
    expect(rig.root.position.z).toBeGreaterThan(-0.95);
    expect(rig.root.rotation.y).toBeLessThan(Math.PI);

    updateHorseFirstPersonView(rig, {
      visible: false,
      gaitPhase: 0,
      speedNorm: 0,
      turnBlend: 0,
      slideBlend: 0,
      slideBank: 0,
      boostShake: 0,
      landingSquat: 0,
      landingSquatHeadY: 0,
    });
    expect(rig.root.visible).toBe(false);
  });
});
