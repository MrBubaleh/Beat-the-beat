import { describe, expect, it } from 'vitest';
import {
  createOrbitalScenery,
  resetOrbitalScenery,
  updateOrbitalScenery,
} from '../../src/render/OrbitalScenery';

describe('orbital scenery', () => {
  it('builds immediately recognizable orbital landmarks', () => {
    const rig = createOrbitalScenery();
    expect(rig.moon.userData.sceneryKind).toBe('moon');
    expect(rig.planet.userData.sceneryKind).toBe('planet-limb');
    expect(rig.satellites).toHaveLength(2);
    expect(rig.satellites.every((satellite) => satellite.group.userData.sceneryKind === 'satellite')).toBe(true);
    expect(rig.comet.userData.sceneryKind).toBe('comet');
    expect(rig.station.userData.sceneryKind).toBe('orbital-station');
  });

  it('fades in without touching ground state and animates satellites, station and comet', () => {
    const rig = createOrbitalScenery();
    const satelliteRotation = rig.satellites[0].group.rotation.y;
    const stationRotation = rig.stationRing.rotation.z;
    updateOrbitalScenery(rig, {
      dt: 2,
      blend: 1,
      cameraX: 2,
      cameraY: 7,
    });
    expect(rig.root.visible).toBe(true);
    expect(rig.root.position.x).toBeCloseTo(0.24);
    expect(rig.root.position.y).toBeCloseTo(2.38);
    expect(rig.satellites[0].group.rotation.y).not.toBe(satelliteRotation);
    expect(rig.stationRing.rotation.z).not.toBe(stationRotation);
    expect(rig.comet.visible).toBe(true);

    let opacityMax = 0;
    for (const binding of rig.fadeBindings) {
      opacityMax = Math.max(opacityMax, binding.material.opacity);
    }
    expect(opacityMax).toBeLessThanOrEqual(0.78);
  });

  it('freezes on zero dt and resets between rocket flights', () => {
    const rig = createOrbitalScenery();
    updateOrbitalScenery(rig, {
      dt: 1.8,
      blend: 1,
      cameraX: 0,
      cameraY: 6,
    });
    const rotation = rig.cometCore.rotation.x;
    updateOrbitalScenery(rig, {
      dt: 0,
      blend: 1,
      cameraX: 0,
      cameraY: 6,
    });
    expect(rig.cometCore.rotation.x).toBe(rotation);

    resetOrbitalScenery(rig);
    expect(rig.flightElapsed).toBe(0);
    expect(rig.root.visible).toBe(false);
    expect(rig.comet.visible).toBe(false);
  });
});
