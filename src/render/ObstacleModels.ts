import * as THREE from 'three';
import type { ObstacleVisualVariant } from './obstacleVisualVariants';

export interface ObstacleModelDimensions {
  width: number;
  height: number;
  depth: number;
  clearance: number;
}

export interface ObstacleModelMaterials {
  tint: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  slideWood: THREE.MeshStandardMaterial;
  canvas: THREE.MeshStandardMaterial;
  hay: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
}

export const MICRO_NITRO_CANISTER_SPIN_RATE = 0.042;
export const MICRO_NITRO_CANISTER_TILT_X = 0.14;
export const MICRO_NITRO_CANISTER_TILT_Z = 0.05;
export const MICRO_NITRO_CANISTER_FILL = 0.85;
export const MICRO_NITRO_CANISTER_VISUAL_SCALE = 1.3;

export interface ObstacleModelInstance {
  root: THREE.Group;
  tintMeshes: THREE.Mesh[];
  lightMeshes: THREE.Mesh[];
  rearLightMeshes: THREE.Mesh[];
  wheels: THREE.Group[];
  baseMaterials: Array<{ mesh: THREE.Mesh; material: THREE.Material }>;
}

export interface ObstacleTintOutline {
  lines: THREE.LineSegments[];
  material: THREE.LineBasicMaterial;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const CONE = new THREE.ConeGeometry(0.5, 1, 9);
const SPHERE = new THREE.SphereGeometry(0.5, 10, 7);
const TORUS = new THREE.TorusGeometry(0.5, 0.11, 6, 12);

export function createObstacleModelMaterials(): ObstacleModelMaterials {
  return {
    tint: new THREE.MeshStandardMaterial({
      color: 0xcc3344,
      emissive: 0x330a0a,
      metalness: 0.34,
      roughness: 0.44,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.68, metalness: 0.28 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x1b3344,
      emissive: 0x071820,
      emissiveIntensity: 0.55,
      roughness: 0.18,
      metalness: 0.22,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.48, metalness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.96 }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xd5dce0,
      emissive: 0x1c2830,
      emissiveIntensity: 0.42,
      roughness: 0.26,
      metalness: 0.82,
    }),
    wood: new THREE.MeshStandardMaterial({ color: 0x855028, emissive: 0x1e0c03, roughness: 0.9 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x472716, emissive: 0x100602, roughness: 0.94 }),
    slideWood: new THREE.MeshStandardMaterial({ color: 0xd4b84a, emissive: 0x4a3208, roughness: 0.88 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x9b7550, emissive: 0x211307, roughness: 0.98 }),
    hay: new THREE.MeshStandardMaterial({ color: 0xd3a63d, emissive: 0x3a2205, roughness: 0.98 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x976b51, emissive: 0x24110a, roughness: 1 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xc8b990, emissive: 0x211b0c, roughness: 0.9 }),
    paint: new THREE.MeshStandardMaterial({ color: 0x4f6060, roughness: 0.88, metalness: 0.08 }),
  };
}

export function buildObstacleModel(
  variant: ObstacleVisualVariant,
  dimensions: ObstacleModelDimensions,
  materials: ObstacleModelMaterials,
): ObstacleModelInstance {
  const instance: ObstacleModelInstance = {
    root: new THREE.Group(),
    tintMeshes: [],
    lightMeshes: [],
    rearLightMeshes: [],
    wheels: [],
    baseMaterials: [],
  };
  switch (variant) {
    case 'road-cones': buildCones(instance, dimensions, materials); break;
    case 'road-barrels': buildBarrels(instance, dimensions, materials); break;
    case 'road-tires': buildTires(instance, dimensions, materials); break;
    case 'road-barricade': buildRoadBarricade(instance, dimensions, materials); break;
    case 'nitro-canister': buildNitroCanister(instance, dimensions, materials); break;
    case 'bicycle': buildBicycle(instance, dimensions, materials); break;
    case 'motor-scooter': buildMotorScooter(instance, dimensions, materials); break;
    case 'kick-scooter': buildKickScooter(instance, dimensions, materials); break;
    case 'quad-bike': buildQuadBike(instance, dimensions, materials); break;
    case 'cargo-trike': buildCargoTrike(instance, dimensions, materials); break;
    case 'sedan':
    case 'hatchback':
    case 'pickup':
    case 'coupe':
    case 'wagon': buildPassengerCar(instance, dimensions, materials, variant); break;
    case 'box-truck':
    case 'city-bus':
    case 'coach':
    case 'dump-truck':
    case 'semi': buildHeavyVehicle(instance, dimensions, materials, variant); break;
    case 'split-fence': buildFence(instance, dimensions, materials); break;
    case 'crate-stack': buildCrates(instance, dimensions, materials); break;
    case 'hay-bales': buildHay(instance, dimensions, materials); break;
    case 'water-trough': buildTrough(instance, dimensions, materials); break;
    case 'fallen-log': buildLog(instance, dimensions, materials); break;
    case 'ranch-gate': buildOverheadFrame(instance, dimensions, materials, 'ranch'); break;
    case 'saloon-awning': buildOverheadFrame(instance, dimensions, materials, 'saloon'); break;
    case 'mine-frame': buildOverheadFrame(instance, dimensions, materials, 'mine'); break;
    case 'rock-arch': buildRockArch(instance, dimensions, materials); break;
    case 'station-frame': buildOverheadFrame(instance, dimensions, materials, 'station'); break;
    case 'stagecoach': buildStagecoach(instance, dimensions, materials); break;
    case 'cargo-wagon': buildCargoWagon(instance, dimensions, materials); break;
    case 'bison': buildBison(instance, dimensions, materials); break;
    case 'mine-cart': buildMineCart(instance, dimensions, materials); break;
    case 'frontier-barricade': buildFrontierBarricade(instance, dimensions, materials); break;
    case 'boulder': buildBoulder(instance, dimensions, materials); break;
  }
  instance.root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      instance.baseMaterials.push({ mesh: child, material: child.material });
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  return instance;
}

export function createObstacleTintOutline(
  model: ObstacleModelInstance,
  color = 0x72ffad,
): ObstacleTintOutline {
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = model.tintMeshes.map((mesh) => {
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      material,
    );
    line.scale.setScalar(1.018);
    line.renderOrder = 13;
    line.visible = false;
    mesh.add(line);
    return line;
  });
  return { lines, material };
}

export function disposeObstacleTintOutline(outline: ObstacleTintOutline): void {
  for (const line of outline.lines) {
    line.removeFromParent();
    line.geometry.dispose();
  }
  outline.material.dispose();
}

export function resolveObstacleModelDimensions(
  variant: ObstacleVisualVariant,
  collisionDimensions: ObstacleModelDimensions,
): ObstacleModelDimensions {
  const visualDimensions: Partial<Record<ObstacleVisualVariant, [number, number, number]>> = {
    'road-cones': [1.02, 0.92, 0.86],
    'road-barrels': [1.05, 1.02, 0.9],
    'road-tires': [0.98, 0.85, 0.85],
    'road-barricade': [1.3, 0.9, 0.58],
    'quad-bike': [1.12, 1, 1.6],
    'cargo-trike': [1.06, 1.1, 1.62],
  };
  const override = visualDimensions[variant];
  if (!override) return collisionDimensions;
  return {
    width: override[0],
    height: override[1],
    depth: override[2],
    clearance: collisionDimensions.clearance,
  };
}

function addPart(
  instance: ObstacleModelInstance,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  tint = false,
  parent: THREE.Object3D = instance.root,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  if (tint) instance.tintMeshes.push(mesh);
  return mesh;
}

function addBox(
  instance: ObstacleModelInstance,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  tint = false,
  parent?: THREE.Object3D,
): THREE.Mesh {
  return addPart(instance, BOX, material, position, scale, rotation, tint, parent);
}

function addLightDisc(
  instance: ObstacleModelInstance,
  material: THREE.Material,
  position: [number, number, number],
  radius: number,
  depth: number,
): THREE.Mesh {
  const mesh = addPart(
    instance,
    CYLINDER,
    material,
    position,
    [radius, depth, radius],
    [Math.PI / 2, 0, 0],
  );
  instance.lightMeshes.push(mesh);
  return mesh;
}

function addRearLightBox(
  instance: ObstacleModelInstance,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
): THREE.Mesh {
  const mesh = addBox(instance, material, position, scale);
  instance.rearLightMeshes.push(mesh);
  return mesh;
}

function addWheel(
  instance: ObstacleModelInstance,
  materials: ObstacleModelMaterials,
  x: number,
  y: number,
  z: number,
  radius: number,
  width: number,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const tire = addPart(
    instance,
    CYLINDER,
    materials.rubber,
    [0, 0, 0],
    [radius * 2, width, radius * 2],
    [0, 0, Math.PI / 2],
    false,
    pivot,
  );
  tire.userData.wheelTire = true;
  addPart(
    instance,
    CYLINDER,
    materials.chrome,
    [0, 0, 0],
    [radius * 0.78, width * 1.05, radius * 0.78],
    [0, 0, Math.PI / 2],
    false,
    pivot,
  );
  instance.root.add(pivot);
  instance.wheels.push(pivot);
  return pivot;
}

function addWheelArch(
  instance: ObstacleModelInstance,
  materials: ObstacleModelMaterials,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): void {
  addBox(instance, materials.dark, [x, y, z], [width, height, depth]);
}

function addBelt(
  instance: ObstacleModelInstance,
  materials: ObstacleModelMaterials,
  y: number,
  width: number,
  depth: number,
  thickness: number,
): void {
  addBox(instance, materials.chrome, [0, y, 0], [width, thickness, depth]);
}

function buildCones(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const coneH = d.height * 0.78;
  for (const [x, z, s] of [[-0.26, -0.18, 0.92], [0.24, 0.14, 1], [0.03, 0.3, 0.74]] as const) {
    addBox(i, m.dark, [x * d.width, 0.035, z * d.depth], [d.width * 0.25 * s, 0.07, d.depth * 0.22 * s]);
    addPart(i, CONE, m.tint, [x * d.width, coneH * 0.5 + 0.07, z * d.depth], [d.width * 0.18 * s, coneH, d.width * 0.18 * s], [0, 0, 0], true);
    addBox(i, m.chrome, [x * d.width, coneH * 0.43, z * d.depth], [d.width * 0.19 * s, coneH * 0.1, d.width * 0.19 * s]);
  }
}

function buildBarrels(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  for (const [x, z, s] of [[-0.2, -0.08, 0.9], [0.2, 0.1, 1]] as const) {
    addPart(i, CYLINDER, m.tint, [x * d.width, d.height * 0.47, z * d.depth], [d.width * 0.32 * s, d.height * 0.9, d.width * 0.32 * s], [0, 0, 0], true);
    for (const y of [0.18, 0.47, 0.76]) {
      addPart(i, CYLINDER, m.metal, [x * d.width, d.height * y, z * d.depth], [d.width * 0.35 * s, d.height * 0.045, d.width * 0.35 * s]);
    }
  }
}

function buildTires(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const radius = Math.min(d.width * 0.25, d.height * 0.34);
  for (let n = 0; n < 3; n++) {
    addPart(i, TORUS, m.rubber, [(n - 1) * radius * 0.72, radius + n * radius * 0.16, (n % 2) * d.depth * 0.1], [radius, radius, radius], [Math.PI / 2, 0, n * 0.35]);
  }
  addBox(i, m.tint, [0, d.height * 0.18, -d.depth * 0.28], [d.width * 0.62, d.height * 0.1, d.depth * 0.08], [0, 0, 0], true);
}

function buildRoadBarricade(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  addBox(i, m.tint, [0, d.height * 0.58, 0], [d.width * 0.9, d.height * 0.24, d.depth * 0.18], [0, 0, 0], true);
  for (const x of [-0.34, 0.34]) {
    addBox(i, m.metal, [x * d.width, d.height * 0.3, 0], [d.width * 0.07, d.height * 0.55, d.depth * 0.08]);
    addBox(i, m.dark, [x * d.width, 0.05, 0], [d.width * 0.24, 0.1, d.depth * 0.28]);
  }
  for (const x of [-0.28, 0, 0.28]) {
    addBox(i, m.chrome, [x * d.width, d.height * 0.58, -d.depth * 0.1], [d.width * 0.12, d.height * 0.25, d.depth * 0.02], [0, 0, -0.45]);
  }
}

function addBikeWheel(i: ObstacleModelInstance, m: ObstacleModelMaterials, z: number, radius: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(0, radius, z);
  addPart(i, TORUS, m.rubber, [0, 0, 0], [radius, radius, radius], [0, Math.PI / 2, 0], false, pivot);
  for (const a of [0, Math.PI / 2]) {
    addBox(i, m.chrome, [0, 0, 0], [0.018, radius * 1.65, 0.018], [a, 0, 0], false, pivot);
  }
  i.root.add(pivot);
  i.wheels.push(pivot);
  return pivot;
}

function buildBicycle(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const r = Math.min(d.height * 0.3, d.depth * 0.22);
  addBikeWheel(i, m, -d.depth * 0.3, r);
  addBikeWheel(i, m, d.depth * 0.3, r);
  addBox(i, m.tint, [0, r * 1.35, 0], [d.width * 0.08, r * 0.08, d.depth * 0.55], [0.25, 0, 0], true);
  addBox(i, m.tint, [0, r * 1.55, -d.depth * 0.12], [d.width * 0.07, r * 0.72, d.depth * 0.05], [-0.45, 0, 0], true);
  addBox(i, m.dark, [0, r * 2.02, -d.depth * 0.08], [d.width * 0.22, d.height * 0.07, d.depth * 0.09]);
  addBox(i, m.chrome, [0, r * 1.9, d.depth * 0.23], [d.width * 0.42, d.height * 0.045, d.depth * 0.04]);
}

function buildMotorScooter(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const r = Math.min(d.height * 0.24, d.depth * 0.18);
  addBikeWheel(i, m, -d.depth * 0.3, r);
  addBikeWheel(i, m, d.depth * 0.3, r);
  addBox(i, m.tint, [0, r * 1.25, -d.depth * 0.04], [d.width * 0.46, d.height * 0.34, d.depth * 0.48], [0.08, 0, 0], true);
  addBox(i, m.dark, [0, r * 1.72, -d.depth * 0.12], [d.width * 0.38, d.height * 0.08, d.depth * 0.24]);
  addBox(i, m.chrome, [0, r * 1.72, d.depth * 0.18], [d.width * 0.08, d.height * 0.55, d.depth * 0.05], [-0.2, 0, 0]);
  addBox(i, m.tint, [0, r * 2.05, d.depth * 0.21], [d.width * 0.44, d.height * 0.055, d.depth * 0.05], [0, 0, 0], true);
}

function buildKickScooter(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const r = Math.min(d.height * 0.16, d.depth * 0.12);
  addBikeWheel(i, m, -d.depth * 0.28, r);
  addBikeWheel(i, m, d.depth * 0.28, r);
  addBox(i, m.tint, [0, r * 1.05, 0], [d.width * 0.36, d.height * 0.08, d.depth * 0.58], [0, 0, 0], true);
  addBox(i, m.chrome, [0, d.height * 0.48, d.depth * 0.24], [d.width * 0.07, d.height * 0.72, d.depth * 0.05], [-0.08, 0, 0]);
  addBox(i, m.tint, [0, d.height * 0.82, d.depth * 0.21], [d.width * 0.48, d.height * 0.055, d.depth * 0.05], [0, 0, 0], true);
}

function buildQuadBike(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const wheelR = Math.min(d.height * 0.24, d.width * 0.18);
  for (const x of [-0.43, 0.43]) {
    for (const z of [-0.31, 0.31]) {
      addWheel(i, m, x * d.width, wheelR, z * d.depth, wheelR, d.width * 0.12);
    }
  }
  addBox(i, m.tint, [0, d.height * 0.38, 0], [d.width * 0.72, d.height * 0.34, d.depth * 0.58], [0, 0, 0], true);
  addBox(i, m.tint, [0, d.height * 0.52, d.depth * 0.27], [d.width * 0.6, d.height * 0.26, d.depth * 0.26], [-0.08, 0, 0], true);
  addBox(i, m.dark, [0, d.height * 0.61, -d.depth * 0.13], [d.width * 0.46, d.height * 0.11, d.depth * 0.32]);
  addBox(i, m.chrome, [0, d.height * 0.69, d.depth * 0.24], [d.width * 0.72, d.height * 0.045, d.depth * 0.045]);
  addBox(i, m.dark, [0, d.height * 0.25, d.depth * 0.42], [d.width * 0.88, d.height * 0.07, d.depth * 0.08]);
  addBox(i, m.dark, [0, d.height * 0.25, -d.depth * 0.42], [d.width * 0.88, d.height * 0.07, d.depth * 0.08]);
}

function buildCargoTrike(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const r = Math.min(d.height * 0.2, d.depth * 0.14);
  addBikeWheel(i, m, d.depth * 0.32, r);
  for (const x of [-0.26, 0.26]) addWheel(i, m, x * d.width, r, -d.depth * 0.25, r, d.width * 0.08);
  addBox(i, m.tint, [0, r * 1.25, -d.depth * 0.2], [d.width * 0.72, d.height * 0.38, d.depth * 0.42], [0, 0, 0], true);
  addBox(i, m.wood, [0, r * 1.43, -d.depth * 0.2], [d.width * 0.58, d.height * 0.28, d.depth * 0.32]);
  addBox(i, m.chrome, [0, d.height * 0.63, d.depth * 0.18], [d.width * 0.07, d.height * 0.58, d.depth * 0.05], [-0.15, 0, 0]);
}

function buildPassengerCar(
  i: ObstacleModelInstance,
  d: ObstacleModelDimensions,
  m: ObstacleModelMaterials,
  style: 'sedan' | 'hatchback' | 'pickup' | 'coupe' | 'wagon',
): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  const coupe = style === 'coupe';
  const hatch = style === 'hatchback';
  const pickup = style === 'pickup';
  const wagon = style === 'wagon';
  const bodyDepth = coupe ? z * 0.9 : z * 0.94;
  addBox(i, m.dark, [0, h * 0.1, 0], [w * 0.86, h * 0.14, bodyDepth * 0.96]);
  addBox(i, m.tint, [0, h * 0.32, coupe ? z * 0.02 : 0], [w * 0.9, h * 0.34, bodyDepth], [0, 0, 0], true);
  addBox(
    i,
    m.tint,
    [0, h * 0.4, z * (pickup ? 0.3 : 0.26)],
    [w * 0.86, h * 0.14, z * 0.28],
    [-0.2, 0, 0],
    true,
  );
  const cabDepth = pickup ? z * 0.36 : wagon ? z * 0.62 : hatch ? z * 0.48 : coupe ? z * 0.42 : z * 0.5;
  const cabZ = pickup ? z * 0.16 : hatch ? -z * 0.06 : wagon ? -z * 0.03 : coupe ? -z * 0.08 : 0;
  addBox(
    i,
    m.tint,
    [0, h * 0.64, cabZ],
    [w * 0.7, h * (coupe ? 0.3 : 0.4), cabDepth],
    [coupe ? -0.12 : hatch ? -0.05 : 0, 0, 0],
    true,
  );
  addBox(
    i,
    m.glass,
    [0, h * 0.66, cabZ + cabDepth * 0.05],
    [w * 0.62, h * 0.26, cabDepth * 0.78],
    [coupe ? -0.1 : 0, 0, 0],
  );
  addBox(i, m.glass, [0, h * 0.55, cabZ + cabDepth * 0.4], [w * 0.58, h * 0.2, z * 0.035], [-0.4, 0, 0]);
  if (pickup) {
    addBox(i, m.dark, [0, h * 0.48, -z * 0.28], [w * 0.78, h * 0.16, z * 0.36]);
    addBox(i, m.metal, [0, h * 0.4, -z * 0.28], [w * 0.68, h * 0.08, z * 0.3]);
    addBox(i, m.tint, [0, h * 0.42, -z * 0.46], [w * 0.82, h * 0.22, z * 0.06], [0, 0, 0], true);
  }
  if (wagon) {
    addBox(i, m.tint, [0, h * 0.62, -z * 0.28], [w * 0.68, h * 0.3, z * 0.28], [0, 0, 0], true);
  }
  addBelt(i, m, h * 0.36, w * 0.92, bodyDepth * 0.62, h * 0.03);
  addBox(i, m.chrome, [0, h * 0.3, z * 0.49], [w * 0.68, h * 0.08, z * 0.035]);
  addBox(i, m.dark, [0, h * 0.18, z * 0.5], [w * 0.8, h * 0.09, z * 0.05]);
  addBox(i, m.dark, [0, h * 0.2, -z * 0.5], [w * 0.82, h * 0.1, z * 0.05]);
  addBox(i, m.chrome, [0, h * 0.39, z * 0.502], [w * 0.26, h * 0.032, z * 0.02]);
  for (const x of [-0.3, 0.3]) {
    addLightDisc(i, m.dark, [x * w, h * 0.39, z * 0.505], w * 0.09, z * 0.028);
    addRearLightBox(i, m.dark, [x * w, h * 0.34, -z * 0.505], [w * 0.2, h * 0.1, z * 0.028]);
  }
  const wheelR = Math.min(h * 0.2, w * 0.14);
  for (const x of [-0.46, 0.46]) {
    for (const wz of [-0.32, 0.32]) {
      addWheel(i, m, x * w, wheelR, wz * z, wheelR, w * 0.08);
      addWheelArch(i, m, x * w, wheelR * 1.35, wz * z, w * 0.16, wheelR * 0.55, wheelR * 1.15);
    }
  }
}

function addHeavyVehicleLights(
  instance: ObstacleModelInstance,
  d: ObstacleModelDimensions,
  m: ObstacleModelMaterials,
  frontY: number,
  rearY: number,
): void {
  for (const x of [-0.32, 0.32]) {
    addLightDisc(
      instance,
      m.dark,
      [x * d.width, frontY, d.depth * 0.505],
      d.width * 0.11,
      d.depth * 0.03,
    );
    addRearLightBox(
      instance,
      m.dark,
      [x * d.width, rearY, -d.depth * 0.505],
      [d.width * 0.22, d.height * 0.12, d.depth * 0.028],
    );
  }
}

function buildHeavyVehicle(
  i: ObstacleModelInstance,
  d: ObstacleModelDimensions,
  m: ObstacleModelMaterials,
  style: 'box-truck' | 'city-bus' | 'coach' | 'dump-truck' | 'semi',
): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  const wheelR = Math.min(h * 0.13, w * 0.15);
  if (style === 'city-bus' || style === 'coach') {
    addBox(i, m.dark, [0, h * 0.12, 0], [w * 0.92, h * 0.16, z * 0.96]);
    addBox(i, m.tint, [0, h * 0.52, 0], [w * 0.94, h * 0.78, z * 0.96], [0, 0, 0], true);
    addBox(i, m.tint, [0, h * 0.48, z * 0.42], [w * 0.9, h * 0.52, z * 0.18], [-0.08, 0, 0], true);
    addBox(i, m.glass, [0, h * 0.7, z * 0.06], [w * 0.86, h * 0.22, z * 0.78]);
    addBox(i, m.glass, [0, h * 0.62, z * 0.5], [w * 0.72, h * 0.28, z * 0.04], [-0.12, 0, 0]);
    addBelt(i, m, h * 0.38, w * 0.96, z * 0.7, h * 0.04);
    addBox(i, m.chrome, [0, h * 0.24, z * 0.5], [w * 0.7, h * 0.08, z * 0.04]);
    addBox(i, m.dark, [0, h * 0.16, z * 0.5], [w * 0.86, h * 0.1, z * 0.05]);
    if (style === 'coach') {
      addBox(i, m.dark, [0, h * 0.94, z * 0.08], [w * 0.7, h * 0.06, z * 0.72]);
      addBox(i, m.metal, [0, h * 0.92, z * 0.42], [w * 0.5, h * 0.08, z * 0.18]);
    }
    for (const wz of [-0.34, 0.34]) {
      for (const x of [-0.49, 0.49]) addWheel(i, m, x * w, wheelR, wz * z, wheelR, w * 0.07);
    }
    addHeavyVehicleLights(i, d, m, h * 0.42, h * 0.36);
    return;
  }
  addBox(i, m.dark, [0, h * 0.1, 0], [w * 0.88, h * 0.14, z * 0.92]);
  addBox(i, m.tint, [0, h * 0.44, z * 0.34], [w * 0.88, h * 0.7, z * 0.28], [0, 0, 0], true);
  addBox(i, m.tint, [0, h * 0.52, z * 0.44], [w * 0.8, h * 0.36, z * 0.12], [-0.16, 0, 0], true);
  addBox(i, m.glass, [0, h * 0.6, z * 0.485], [w * 0.74, h * 0.24, z * 0.035]);
  addBox(i, m.chrome, [0, h * 0.32, z * 0.5], [w * 0.62, h * 0.1, z * 0.04]);
  addBox(i, m.dark, [0, h * 0.16, z * 0.5], [w * 0.86, h * 0.12, z * 0.06]);
  if (style === 'dump-truck') {
    addBox(i, m.metal, [0, h * 0.54, -z * 0.18], [w * 0.92, h * 0.52, z * 0.56], [-0.06, 0, 0]);
    addBox(i, m.tint, [0, h * 0.78, -z * 0.18], [w * 0.98, h * 0.1, z * 0.6], [0, 0, 0], true);
  } else {
    addBox(
      i,
      style === 'semi' ? m.metal : m.tint,
      [0, h * 0.56, -z * 0.16],
      [w * 0.94, h * 0.72, z * 0.6],
      [0, 0, 0],
      style !== 'semi',
    );
    if (style === 'box-truck') {
      for (const x of [-0.32, 0, 0.32]) {
        addBox(i, m.chrome, [x * w, h * 0.56, -z * 0.46], [w * 0.03, h * 0.52, z * 0.015]);
      }
    }
    if (style === 'semi') {
      addBox(i, m.tint, [0, h * 0.22, -z * 0.16], [w * 0.96, h * 0.08, z * 0.62], [0, 0, 0], true);
    }
  }
  addBelt(i, m, h * 0.28, w * 0.9, z * 0.22, h * 0.035);
  for (const wz of [-0.36, 0.34]) {
    for (const x of [-0.49, 0.49]) addWheel(i, m, x * w, wheelR, wz * z, wheelR, w * 0.075);
  }
  addHeavyVehicleLights(i, d, m, h * 0.4, h * 0.34);
}

function buildNitroCanister(
  i: ObstacleModelInstance,
  d: ObstacleModelDimensions,
  m: ObstacleModelMaterials,
): void {
  const fill = MICRO_NITRO_CANISTER_FILL;
  const h = d.height * fill;
  const diameter = d.width * fill * 0.96;
  const bodyH = h * 0.7;
  const baseLift = 0.03;

  addPart(
    i,
    CYLINDER,
    m.tint,
    [0, baseLift * 0.5, 0],
    [diameter * 1.02, baseLift, diameter * 1.02],
    [0, 0, 0],
    true,
  );
  addPart(
    i,
    CYLINDER,
    m.tint,
    [0, baseLift + bodyH * 0.5, 0],
    [diameter, bodyH, diameter],
    [0, 0, 0],
    true,
  );
  addPart(
    i,
    SPHERE,
    m.tint,
    [0, baseLift + bodyH + diameter * 0.17, 0],
    [diameter * 0.96, diameter * 0.26, diameter * 0.96],
    [0, 0, 0],
    true,
  );
  addPart(
    i,
    CYLINDER,
    m.chrome,
    [0, baseLift + bodyH + diameter * 0.29, 0],
    [diameter * 0.36, h * 0.055, diameter * 0.36],
  );
  addPart(
    i,
    CYLINDER,
    m.dark,
    [0, baseLift + bodyH + diameter * 0.39, 0],
    [diameter * 0.2, h * 0.075, diameter * 0.2],
  );
  addPart(
    i,
    CONE,
    m.dark,
    [0, baseLift + bodyH + diameter * 0.49, 0],
    [diameter * 0.14, h * 0.11, diameter * 0.14],
  );
  addBox(
    i,
    m.chrome,
    [diameter * 0.29, baseLift + bodyH * 0.48, diameter * 0.06],
    [diameter * 0.16, h * 0.11, diameter * 0.1],
  );
  addBox(
    i,
    m.dark,
    [0, baseLift + bodyH * 0.4, diameter * 0.51],
    [diameter * 1.02, h * 0.075, diameter * 0.055],
    [0, 0, 0],
    true,
  );
}

function buildFence(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  for (const x of [-0.42, 0.42]) addBox(i, m.woodDark, [x * d.width, d.height * 0.46, 0], [d.width * 0.1, d.height * 0.92, d.depth * 0.32], [0, 0, x * 0.08]);
  for (const y of [0.28, 0.62]) addBox(i, m.tint, [0, d.height * y, 0], [d.width * 0.95, d.height * 0.16, d.depth * 0.22], [0, 0.03, y === 0.28 ? -0.05 : 0.06], true);
}

function buildCrates(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const specs = [[-0.25, 0.27, 0, 0.52], [0.25, 0.27, 0.04, 0.52], [0, 0.76, -0.03, 0.48]] as const;
  for (const [x, y, z, s] of specs) {
    addBox(i, m.tint, [x * d.width, y * d.height, z * d.depth], [s * d.width, s * d.height, d.depth * 0.76], [0, x * 0.1, 0], true);
    addBox(i, m.woodDark, [x * d.width, y * d.height, z * d.depth - d.depth * 0.39], [s * d.width * 0.84, s * d.height * 0.08, d.depth * 0.03], [0, 0, 0.72]);
  }
}

function buildHay(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  for (const [x, y, s] of [[-0.24, 0.28, 0.48], [0.24, 0.28, 0.48], [0, 0.68, 0.44]] as const) {
    addBox(i, m.hay, [x * d.width, y * d.height, 0], [s * d.width, d.height * 0.46, d.depth * 0.82], [0, x * 0.08, 0]);
    addBox(i, m.woodDark, [x * d.width, y * d.height, -d.depth * 0.42], [s * d.width, d.height * 0.035, d.depth * 0.02]);
  }
}

function buildTrough(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  addBox(i, m.tint, [0, d.height * 0.28, 0], [d.width * 0.94, d.height * 0.42, d.depth * 0.72], [0, 0, 0], true);
  addBox(i, m.dark, [0, d.height * 0.42, 0], [d.width * 0.78, d.height * 0.2, d.depth * 0.56]);
  for (const x of [-0.35, 0.35]) addBox(i, m.wood, [x * d.width, d.height * 0.16, 0], [d.width * 0.1, d.height * 0.32, d.depth * 0.82], [0, 0, x * 0.05]);
}

function buildLog(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  addPart(i, CYLINDER, m.wood, [0, d.height * 0.38, 0], [d.height * 0.7, d.width * 0.98, d.height * 0.7], [0, 0, Math.PI / 2]);
  for (const x of [-0.34, 0.18]) addBox(i, m.woodDark, [x * d.width, d.height * 0.62, 0], [d.width * 0.08, d.height * 0.52, d.depth * 0.14], [0, 0, x < 0 ? -0.65 : 0.55]);
  addBox(i, m.tint, [0, d.height * 0.42, -d.depth * 0.37], [d.width * 0.5, d.height * 0.16, d.depth * 0.05], [0, 0, 0], true);
}

function buildOverheadFrame(
  i: ObstacleModelInstance,
  d: ObstacleModelDimensions,
  m: ObstacleModelMaterials,
  style: 'ranch' | 'saloon' | 'mine' | 'station',
): void {
  const postMaterial = style === 'station' ? m.chrome : m.slideWood;
  const crossMaterial = style === 'saloon' ? m.canvas : style === 'station' ? m.metal : m.slideWood;
  const postW = d.width * (style === 'mine' ? 0.15 : 0.1);
  for (const x of [-0.46, 0.46]) {
    addBox(i, postMaterial, [x * d.width, d.clearance * 0.5, 0], [postW, d.clearance, d.depth * 0.72], [0, 0, x * 0.03]);
    addBox(i, m.slideWood, [x * d.width, 0.08, 0], [postW * 1.55, 0.16, d.depth * 0.86]);
  }
  const barH = Math.max(0.2, d.height - d.clearance);
  addBox(i, m.tint, [0, d.clearance + barH * 0.5, 0], [d.width * 1.04, barH, d.depth * (style === 'saloon' ? 0.9 : 0.7)], [style === 'saloon' ? 0.08 : 0, 0, style === 'mine' ? 0.025 : 0], true);
  addBox(i, crossMaterial, [0, d.clearance + barH * 0.72, d.depth * 0.08], [d.width * 0.86, barH * 0.18, d.depth * 0.72]);
  if (style === 'saloon') {
    addBox(i, m.slideWood, [0, d.height * 0.92, -d.depth * 0.34], [d.width * 0.78, barH * 0.24, d.depth * 0.08]);
    for (const x of [-0.28, 0, 0.28]) addBox(i, m.tint, [x * d.width, d.height * 0.92, -d.depth * 0.39], [d.width * 0.08, barH * 0.13, d.depth * 0.025], [0, 0, 0], true);
  } else if (style === 'ranch') {
    addPart(i, CONE, m.bone, [0, d.height * 0.98, -d.depth * 0.1], [d.width * 0.2, barH * 0.7, d.width * 0.12], [0, 0, Math.PI]);
  } else if (style === 'station') {
    addBox(i, m.tint, [0, d.height * 0.95, -d.depth * 0.36], [d.width * 0.62, barH * 0.18, d.depth * 0.06], [0, 0, 0], true);
  }
}

function buildRockArch(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  for (const x of [-0.48, 0.48]) {
    addPart(i, SPHERE, m.slideWood, [x * d.width, d.clearance * 0.44, 0], [d.width * 0.28, d.clearance * 0.86, d.depth * 0.58], [0.08, 0, x * 0.08]);
  }
  addPart(i, SPHERE, m.slideWood, [0, d.clearance + (d.height - d.clearance) * 0.5, 0], [d.width * 1.08, d.height - d.clearance, d.depth * 0.68], [0.05, 0.06, 0]);
  addBox(i, m.tint, [0, d.height * 0.86, -d.depth * 0.35], [d.width * 0.78, d.height * 0.14, d.depth * 0.045], [0, 0, 0], true);
}

function buildStagecoach(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  addBox(i, m.dark, [0, h * 0.16, 0], [w * 0.82, h * 0.12, z * 0.7]);
  addBox(i, m.tint, [0, h * 0.5, 0], [w * 0.86, h * 0.52, z * 0.68], [0, 0, 0], true);
  addBox(i, m.tint, [0, h * 0.8, -z * 0.02], [w * 0.9, h * 0.1, z * 0.74], [0, 0, 0], true);
  addBox(i, m.woodDark, [0, h * 0.86, 0], [w * 0.78, h * 0.06, z * 0.62]);
  addBox(i, m.glass, [0, h * 0.58, z * 0.35], [w * 0.5, h * 0.22, z * 0.03]);
  addBox(i, m.glass, [0, h * 0.58, -z * 0.35], [w * 0.42, h * 0.18, z * 0.03]);
  addBelt(i, m, h * 0.38, w * 0.9, z * 0.5, h * 0.035);
  addBox(i, m.chrome, [0, h * 0.28, z * 0.46], [w * 0.12, h * 0.08, z * 0.08]);
  addBox(i, m.tint, [0, h * 0.26, z * 0.48], [w * 0.1, h * 0.08, z * 0.36], [0.12, 0, 0], true);
  const r = Math.min(h * 0.22, w * 0.2);
  for (const x of [-0.48, 0.48]) {
    for (const wz of [-0.28, 0.28]) addWheel(i, m, x * w, r, wz * z, r, w * 0.055);
  }
}

function buildCargoWagon(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  addBox(i, m.dark, [0, h * 0.14, 0], [w * 0.88, h * 0.12, z * 0.78]);
  addBox(i, m.woodDark, [0, h * 0.32, 0], [w * 0.9, h * 0.28, z * 0.78]);
  addBox(i, m.tint, [0, h * 0.36, 0], [w * 0.86, h * 0.22, z * 0.74], [0, 0, 0], true);
  for (const x of [-0.4, 0.4]) {
    addBox(i, m.wood, [x * w, h * 0.55, 0], [w * 0.07, h * 0.62, z * 0.82]);
  }
  addPart(i, SPHERE, m.canvas, [0, h * 0.62, 0], [w * 0.78, h * 0.72, z * 0.7], [0, 0, 0]);
  addBox(i, m.tint, [0, h * 0.7, 0], [w * 0.42, h * 0.08, z * 0.76], [0, 0, 0], true);
  addBelt(i, m, h * 0.28, w * 0.92, z * 0.5, h * 0.03);
  addBox(i, m.tint, [0, h * 0.46, -z * 0.42], [w * 0.48, h * 0.08, z * 0.04], [0, 0, 0], true);
  const r = Math.min(h * 0.22, w * 0.2);
  for (const x of [-0.49, 0.49]) {
    for (const wz of [-0.27, 0.27]) addWheel(i, m, x * w, r, wz * z, r, w * 0.05);
  }
}

function buildBison(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  addBox(i, m.dark, [0, h * 0.12, -z * 0.04], [w * 0.7, h * 0.1, z * 0.62]);
  addPart(i, SPHERE, m.tint, [0, h * 0.46, -z * 0.06], [w * 0.84, h * 0.5, z * 0.68], [0, 0, 0], true);
  addPart(i, SPHERE, m.tint, [0, h * 0.7, z * 0.22], [w * 0.7, h * 0.42, z * 0.4], [0.08, 0, 0], true);
  addBox(i, m.tint, [0, h * 0.62, z * 0.36], [w * 0.42, h * 0.28, z * 0.28], [0.12, 0, 0], true);
  addBelt(i, m, h * 0.4, w * 0.7, z * 0.36, h * 0.04);
  for (const x of [-0.3, 0.3]) {
    for (const wz of [-0.22, 0.22]) {
      addBox(i, m.dark, [x * w, h * 0.2, wz * z], [w * 0.1, h * 0.38, z * 0.1], [x * 0.04, 0, 0]);
    }
  }
  for (const x of [-0.28, 0.28]) {
    addPart(
      i,
      CONE,
      m.bone,
      [x * w, h * 0.8, z * 0.44],
      [w * 0.1, w * 0.34, w * 0.1],
      [Math.PI / 2, 0, x < 0 ? -0.42 : 0.42],
    );
  }
  addBox(i, m.tint, [0, h * 0.62, -z * 0.38], [w * 0.68, h * 0.14, z * 0.04], [0, 0, 0], true);
}

function buildMineCart(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  addBox(i, m.dark, [0, h * 0.12, 0], [w * 0.9, h * 0.1, z * 0.78]);
  addBox(i, m.metal, [0, h * 0.36, 0], [w * 0.92, h * 0.32, z * 0.72]);
  addBox(i, m.tint, [0, h * 0.5, 0], [w * 0.88, h * 0.42, z * 0.68], [0.04, 0, 0], true);
  addPart(i, SPHERE, m.tint, [0, h * 0.68, 0], [w * 0.78, h * 0.62, z * 0.58], [0.05, 0, 0], true);
  addBelt(i, m, h * 0.32, w * 0.94, z * 0.5, h * 0.03);
  addBox(i, m.tint, [0, h * 0.66, -z * 0.36], [w * 0.78, h * 0.1, z * 0.04], [0, 0, 0], true);
  const r = Math.min(h * 0.16, w * 0.14);
  for (const x of [-0.45, 0.45]) {
    for (const wz of [-0.25, 0.25]) addWheel(i, m, x * w, r, wz * z, r, w * 0.06);
  }
  for (const x of [-0.38, 0.38]) {
    addBox(i, m.metal, [x * w, 0.06, 0], [w * 0.08, 0.1, z * 1.02]);
  }
}

function buildFrontierBarricade(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  for (const x of [-0.4, 0.4]) {
    addBox(i, m.woodDark, [x * w, h * 0.48, 0], [w * 0.12, h * 0.92, z * 0.22], [0, 0, x * 0.08]);
  }
  addBox(i, m.wood, [0, h * 0.28, 0], [w * 1.02, h * 0.16, z * 0.16], [0, 0.1, 0]);
  addBox(i, m.tint, [0, h * 0.52, 0], [w * 1.04, h * 0.18, z * 0.18], [0, -0.08, 0.04], true);
  addBox(i, m.tint, [0, h * 0.74, -z * 0.06], [w * 0.96, h * 0.16, z * 0.16], [0, 0.12, -0.05], true);
  addBelt(i, m, h * 0.52, w * 0.7, z * 0.08, h * 0.04);
  addBox(i, m.tint, [0, h * 0.72, -z * 0.18], [w * 0.5, h * 0.08, z * 0.03], [0, 0, 0], true);
}

function buildBoulder(i: ObstacleModelInstance, d: ObstacleModelDimensions, m: ObstacleModelMaterials): void {
  const h = d.height;
  const w = d.width;
  const z = d.depth;
  addPart(i, SPHERE, m.rock, [0, h * 0.46, 0], [w * 0.94, h * 0.86, z * 0.84], [0.1, 0.16, 0.04]);
  addPart(i, SPHERE, m.rock, [-w * 0.22, h * 0.7, -z * 0.16], [w * 0.46, h * 0.44, z * 0.42], [0.08, 0, -0.1]);
  addPart(i, SPHERE, m.dark, [w * 0.18, h * 0.34, z * 0.12], [w * 0.36, h * 0.32, z * 0.34], [0, 0.2, 0]);
  addBelt(i, m, h * 0.42, w * 0.55, z * 0.2, h * 0.05);
  for (const x of [-0.24, 0, 0.24]) {
    addBox(
      i,
      m.tint,
      [x * w, h * (0.56 + Math.abs(x) * 0.18), -z * 0.44],
      [w * 0.18, h * 0.18, z * 0.04],
      [0, 0, -0.18 + x * 0.45],
      true,
    );
  }
}
