import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCityScenery,
  resetCityScenery,
  updateCityScenery,
} from '../../src/render/CityScenery';

describe('city scenery', () => {
  it('builds a sparse recognizable skyline with overpasses and aircraft', () => {
    const rig = createCityScenery(3.84);
    expect(rig.buildings).toHaveLength(12);
    expect(rig.landmarks).toHaveLength(3);
    expect(rig.overpasses).toHaveLength(2);
    expect(rig.helicopter.userData.sceneryKind).toBe('helicopter');
    expect(rig.airplane.userData.sceneryKind).toBe('airplane');
    expect(rig.buildings.every((building) => building.userData.sceneryKind === 'city-building')).toBe(true);

    let meshCount = 0;
    rig.root.traverse((child) => {
      if (child instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBeGreaterThan(80);
    expect(meshCount).toBeLessThan(240);
    expect(rig.landmarks.map((landmark) => landmark.userData.sceneryKind)).toEqual([
      'stadium',
      'parking-garage',
      'elevated-line',
    ]);
  });

  it('scrolls at layered speeds, animates rotors and freezes deterministically', () => {
    const rig = createCityScenery(3.84);
    const firstBuildingZ = rig.buildings[0].position.z;
    const rotorBefore = rig.helicopterMainRotor.rotation.y;
    updateCityScenery(rig, { dt: 0.25, scrollDistance: 5, blend: 1 });
    expect(rig.buildings[0].position.z).toBeLessThan(firstBuildingZ);
    expect(rig.helicopterMainRotor.rotation.y).toBeGreaterThan(rotorBefore);
    expect(rig.helicopter.visible).toBe(true);
    expect(rig.elevatedTrain.position.z).toBeGreaterThan(-7);

    const frozenZ = rig.buildings[0].position.z;
    const frozenRotor = rig.helicopterMainRotor.rotation.y;
    updateCityScenery(rig, { dt: 0, scrollDistance: 0, blend: 1 });
    expect(rig.buildings[0].position.z).toBe(frozenZ);
    expect(rig.helicopterMainRotor.rotation.y).toBe(frozenRotor);

    updateCityScenery(rig, { dt: 0, scrollDistance: 0, blend: 0 });
    expect(rig.root.visible).toBe(false);
    expect(rig.helicopter.visible).toBe(false);
  });

  it('keeps opaque building shells while burying the city underground', () => {
    const rig = createCityScenery(3.84);
    updateCityScenery(rig, { dt: 0, scrollDistance: 0, blend: 1 });

    for (const building of rig.buildings) {
      const shell = building.children[0] as THREE.Mesh;
      const material = shell.material as THREE.MeshStandardMaterial;
      expect(material.opacity).toBe(1);
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);
    }

    updateCityScenery(rig, { dt: 0, scrollDistance: 0, blend: 0.5 });
    const movingShell = rig.buildings[0].children[0] as THREE.Mesh;
    const movingMaterial = movingShell.material as THREE.MeshStandardMaterial;
    expect(movingMaterial.opacity).toBe(1);
    expect(movingMaterial.transparent).toBe(false);
    expect(movingMaterial.depthWrite).toBe(true);
    expect(rig.root.position.y).toBe(-11);
  });

  it('keeps the skyline close to the roadside props without touching the road', () => {
    const roadEdge = 3.84;
    const rig = createCityScenery(roadEdge);
    const nearShell = rig.buildings[0].children[0] as THREE.Mesh;
    const farShell = rig.buildings[2].children[0] as THREE.Mesh;

    expect(Math.abs(nearShell.position.x) - roadEdge).toBeCloseTo(4.5);
    expect(Math.abs(farShell.position.x) - roadEdge).toBeCloseTo(8);
  });

  it('restores initial pooled positions on reset', () => {
    const rig = createCityScenery(3.84);
    updateCityScenery(rig, { dt: 2, scrollDistance: 40, blend: 1 });
    resetCityScenery(rig);
    expect(rig.elapsed).toBe(0);
    expect(rig.buildings[0].position.z).toBe(8);
    expect(rig.airplane.visible).toBe(false);
  });
});
