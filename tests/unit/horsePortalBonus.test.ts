import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createCarPortal,
  createHorsePortal,
  getCityPostcardTexture,
  getWestPostcardTexture,
  samplePortalJelly,
  updateModePortal,
} from '../../src/render/HorsePortalBonus';

const PORTAL_RADIUS = 0.35 * 3.78;

describe('mode portal bonus', () => {
  it('builds a flat circular horse portal within the scaled size', () => {
    const portal = createHorsePortal(PORTAL_RADIUS);
    updateModePortal(portal, 1.25, 0.4);
    portal.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(portal.root).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(PORTAL_RADIUS * 1.7);
    expect(size.y).toBeGreaterThan(PORTAL_RADIUS * 1.7);
    expect(size.x).toBeLessThan(PORTAL_RADIUS * 2.45);
    expect(size.y).toBeLessThan(PORTAL_RADIUS * 2.45);
    expect(size.z).toBeLessThan(PORTAL_RADIUS * 0.55);
    expect(portal.kind).toBe('horse');
    expect(portal.silhouette).not.toBeNull();
    expect(portal.silhouette!.children.length).toBeGreaterThanOrEqual(8);
    expect(portal.portalMaterial.uniforms.uTime.value).toBe(1.25);
    expect(getWestPostcardTexture()).toBeInstanceOf(THREE.Texture);
  });

  it('builds a same-size car portal with a different rim and city fill', () => {
    const horse = createHorsePortal(PORTAL_RADIUS);
    const car = createCarPortal(PORTAL_RADIUS);
    expect(car.kind).toBe('car');
    expect(car.silhouette).toBeNull();
    expect(car.radius).toBe(horse.radius);
    expect(car.rimMaterial.color.getHex()).not.toBe(horse.rimMaterial.color.getHex());
    expect(
      (car.portalMaterial.uniforms.uRimColor.value as THREE.Vector3).equals(
        horse.portalMaterial.uniforms.uRimColor.value as THREE.Vector3,
      ),
    ).toBe(false);
    expect(getCityPostcardTexture()).toBeInstanceOf(THREE.Texture);
    car.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(PORTAL_RADIUS * 2.45);
    expect(size.z).toBeLessThan(PORTAL_RADIUS * 0.55);
  });

  it('compresses along Z at contact and settles after the jelly window', () => {
    const start = samplePortalJelly(0);
    const mid = samplePortalJelly(0.2);
    const end = samplePortalJelly(1);
    expect(start.z).toBeLessThan(0.55);
    expect(start.xy).toBeGreaterThan(1.3);
    expect(start.flash).toBeGreaterThan(0.8);
    expect(mid.z).toBeGreaterThan(start.z);
    expect(end.z).toBeCloseTo(1, 2);
    expect(end.xy).toBeCloseTo(1, 2);
    expect(end.flash).toBeLessThan(0.08);
  });

  it('keeps the portal facing the runner without tumbling parts at the origin', () => {
    const portal = createHorsePortal(PORTAL_RADIUS);
    expect(portal.root.rotation.y).toBe(0);
    expect(portal.sparks.length).toBeGreaterThan(8);
    expect(portal.radius).toBeCloseTo(PORTAL_RADIUS);
  });
});
