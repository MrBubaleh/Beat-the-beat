import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface HorseFirstPersonViewRig {
  root: THREE.Group;
  head: THREE.Group;
  neck: THREE.Mesh;
  withers: THREE.Mesh;
  mane: THREE.Mesh;
}

export interface HorseFirstPersonViewUpdate {
  visible: boolean;
  gaitPhase: number;
  speedNorm: number;
  turnBlend: number;
  slideBlend: number;
  slideBank: number;
  boostShake: number;
  landingSquat: number;
  landingSquatHeadY: number;
}

export function createHorseFirstPersonView(
  headTemplate: THREE.Group,
  bodyMaterial: THREE.Material,
  darkMaterial: THREE.Material,
): HorseFirstPersonViewRig {
  const root = new THREE.Group();
  root.name = 'first-person-horse-view';
  root.userData.sceneryKind = 'horse-fps-bust';

  const head = headTemplate.clone(true);
  head.name = 'first-person-horse-head';
  head.userData.horseFpsPart = 'head';
  head.position.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  head.scale.setScalar(1);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.22, 0.58, 8),
    bodyMaterial,
  );
  neck.name = 'first-person-horse-neck';
  neck.userData.horseFpsPart = 'neck';
  neck.position.set(0, -0.2, -0.14);
  neck.rotation.x = 0.52;

  const withers = new THREE.Mesh(
    new RoundedBoxGeometry(0.72, 0.32, 0.72, 3, 0.1),
    bodyMaterial,
  );
  withers.name = 'first-person-horse-withers';
  withers.userData.horseFpsPart = 'withers';
  withers.position.set(0, -0.22, -0.34);
  withers.rotation.x = 0.08;
  withers.visible = false;

  const mane = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.48, 0.13),
    darkMaterial,
  );
  mane.name = 'first-person-horse-mane';
  mane.userData.horseFpsPart = 'mane';
  mane.position.set(0, -0.18, -0.2);
  mane.rotation.x = 0.52;
  mane.visible = false;

  root.add(withers, neck, mane, head);
  root.visible = false;
  root.traverse((child) => {
    child.frustumCulled = false;
  });
  return { root, head, neck, withers, mane };
}

export function updateHorseFirstPersonView(
  rig: HorseFirstPersonViewRig,
  update: HorseFirstPersonViewUpdate,
): void {
  rig.root.visible = update.visible;
  if (!update.visible) return;

  const slide = smoothstep01(update.slideBlend);
  const gaitStrength = (1 - slide) * lerp(0.45, 1, update.speedNorm);
  const gaitBob = Math.sin(update.gaitPhase * 2) * 0.012 * gaitStrength;
  const gaitNod = Math.sin(update.gaitPhase * 2 + 0.25) * 0.012 * gaitStrength;
  const boostShake = update.boostShake;
  const turboBob =
    Math.sin(update.gaitPhase * 5.4) * 0.018 * boostShake +
    Math.sin(update.gaitPhase * 8.1 + 0.6) * 0.01 * boostShake;
  const turboNod =
    Math.sin(update.gaitPhase * 6.2 + 0.35) * 0.022 * boostShake;
  const turboSway = Math.sin(update.gaitPhase * 7.4) * 0.014 * boostShake;

  const squat = smoothstep01(update.landingSquat);
  const squatHeadY = update.landingSquatHeadY * squat;

  rig.root.position.set(
    -update.turnBlend * 0.025 + turboSway,
    -0.52 - slide * 0.09 + gaitBob + turboBob + squatHeadY,
    -0.86 - slide * 0.12,
  );
  rig.root.rotation.set(
    0.045 + slide * 0.09 + turboNod * 0.35 + squat * 0.08,
    Math.PI - update.turnBlend * 0.08,
    -update.turnBlend * 0.075 + update.slideBank * 0.1 + turboSway * 0.8,
  );
  rig.root.scale.setScalar(lerp(0.94, 0.86, slide));

  rig.head.rotation.x = gaitNod - slide * 0.035 + turboNod + squat * 0.1;
  rig.head.rotation.y = update.turnBlend * 0.025 + turboSway * 0.6;
  rig.neck.rotation.x = 0.52 + gaitNod * 0.35 + turboNod * 0.55;
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
