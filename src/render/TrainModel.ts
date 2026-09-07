import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

export const TRAIN_NOSE_LENGTH = 5.5;
export const TRAIN_CAR_LENGTH = 5.6;
export const TRAIN_CAR_MIN = 3.8;
export const TRAIN_CAR_MAX = 7.4;
export const TRAIN_MAX_CARS = 18;
export const TRAIN_NOSE_MIN = 3.4;

export interface TrainLayout {
  noseLength: number;
  carCount: number;
  carLength: number;
}

export interface TrainModelMaterials {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
}

export interface TrainDetailMaterials {
  glass: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
}

export interface TrainModelInstance {
  root: THREE.Group;
  frontNose: THREE.Group;
  rearNose: THREE.Group;
  cars: THREE.Group[];
  width: number;
  height: number;
  length: number;
}

export function createTrainDetailMaterials(): TrainDetailMaterials {
  return {
    glass: new THREE.MeshStandardMaterial({
      color: 0x1a2a38,
      emissive: 0x071018,
      emissiveIntensity: 0.4,
      roughness: 0.22,
      metalness: 0.18,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x14161c,
      roughness: 0.86,
      metalness: 0.28,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0xfff2c8,
      emissive: 0xffd27a,
      emissiveIntensity: 2.4,
      roughness: 0.35,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x6a7078,
      roughness: 0.48,
      metalness: 0.58,
    }),
  };
}

export function planTrainLayout(length: number): TrainLayout {
  const safeLength = Math.max(length, TRAIN_NOSE_MIN * 2);
  let noseLength = TRAIN_NOSE_LENGTH;
  let inner = safeLength - 2 * noseLength;
  if (inner < TRAIN_CAR_MIN) {
    noseLength = Math.max(TRAIN_NOSE_MIN, (safeLength - TRAIN_CAR_MIN) / 2);
    inner = safeLength - 2 * noseLength;
  }
  if (inner < TRAIN_CAR_MIN * 0.45) {
    return { noseLength: safeLength / 2, carCount: 0, carLength: 0 };
  }
  let carCount = Math.max(1, Math.round(inner / TRAIN_CAR_LENGTH));
  carCount = Math.min(TRAIN_MAX_CARS, carCount);
  while (carCount > 1 && inner / carCount < TRAIN_CAR_MIN) carCount -= 1;
  while (carCount < TRAIN_MAX_CARS && inner / carCount > TRAIN_CAR_MAX) carCount += 1;
  return {
    noseLength,
    carCount,
    carLength: inner / carCount,
  };
}

export function createTrainModel(
  width: number,
  height: number,
  materials: TrainModelMaterials,
): TrainModelInstance {
  const root = new THREE.Group();
  const frontNose = buildNose(width, height, materials);
  const rearNose = buildNose(width, height, materials);
  rearNose.rotation.y = Math.PI;
  root.add(frontNose, rearNose);
  const cars: THREE.Group[] = [];
  const prototype = buildCar(width, height, materials);
  cars.push(prototype);
  root.add(prototype);
  for (let i = 1; i < TRAIN_MAX_CARS; i++) {
    const car = prototype.clone();
    car.visible = false;
    cars.push(car);
    root.add(car);
  }
  return {
    root,
    frontNose,
    rearNose,
    cars,
    width,
    height,
    length: 0,
  };
}

export function layoutTrain(instance: TrainModelInstance, length: number): void {
  const layout = planTrainLayout(length);
  instance.length = length;
  const noseScaleZ = layout.noseLength / TRAIN_NOSE_LENGTH;
  instance.frontNose.position.z = length / 2 - layout.noseLength / 2;
  instance.frontNose.scale.z = noseScaleZ;
  instance.rearNose.position.z = -length / 2 + layout.noseLength / 2;
  instance.rearNose.scale.z = noseScaleZ;
  const firstCarZ = -length / 2 + layout.noseLength + layout.carLength / 2;
  for (let i = 0; i < instance.cars.length; i++) {
    const car = instance.cars[i];
    if (i >= layout.carCount) {
      car.visible = false;
      continue;
    }
    car.visible = true;
    car.position.z = firstCarZ + i * layout.carLength;
    car.scale.z = layout.carLength / TRAIN_CAR_LENGTH;
  }
}

export function paintTrain(
  instance: TrainModelInstance,
  body: THREE.MeshStandardMaterial,
  accent: THREE.MeshStandardMaterial,
): void {
  instance.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.userData.trainPaint === 'body') child.material = body;
    if (child.userData.trainPaint === 'accent') child.material = accent;
  });
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  paint?: 'body' | 'accent',
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  if (paint) mesh.userData.trainPaint = paint;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function buildNose(
  width: number,
  height: number,
  materials: TrainModelMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const L = TRAIN_NOSE_LENGTH;
  const w = width;
  const h = height;
  const cab = L * 0.44;
  const zCab = -L / 2 + cab / 2;
  const taperStart = -L / 2 + cab;
  const tip = L / 2;

  addBox(group, materials.body, [0, h * 0.51, zCab], [w * 0.97, h * 0.86, cab * 0.98], [0, 0, 0], 'body');
  addBox(group, materials.accent, [0, h - 0.045, zCab], [w * 0.8, 0.09, cab * 0.92], [0, 0, 0], 'accent');
  addBox(group, materials.dark, [0, 0.075, zCab], [w * 0.9, 0.15, cab]);
  addBox(group, materials.accent, [0, h * 0.37, zCab], [w * 0.995, 0.1, cab * 0.94], [0, 0, 0], 'accent');
  for (const x of [-1, 1]) {
    addBox(group, materials.glass, [x * w * 0.485, h * 0.63, zCab + cab * 0.04], [0.05, h * 0.2, cab * 0.62]);
    addBox(group, materials.dark, [x * w * 0.49, h * 0.48, zCab - cab * 0.18], [0.04, h * 0.42, 0.38]);
  }
  addBox(group, materials.metal, [0, h * 0.22, zCab - cab * 0.22], [w * 0.42, 0.08, 0.55]);
  addBogie(group, materials, zCab - cab * 0.08, w, h);

  addTaperStep(group, materials, w, taperStart, taperStart + 0.82, h * 0.7, w * 0.9, 0.1);
  addTaperStep(group, materials, w, taperStart + 0.82, taperStart + 1.48, h * 0.5, w * 0.76, 0.1);
  addTaperStep(group, materials, w, taperStart + 1.48, taperStart + 2.02, h * 0.3, w * 0.56, 0.1);
  addTaperStep(group, materials, w, taperStart + 2.02, taperStart + 2.42, h * 0.16, w * 0.38, 0.12);
  addBox(
    group,
    materials.accent,
    [0, h * 0.72, taperStart + 0.46],
    [w * 0.62, 0.07, 0.88],
    [0, 0, 0],
    'accent',
  );

  addBox(
    group,
    materials.body,
    [0, h * 0.26, (taperStart + 1.05 + tip - 0.35) / 2],
    [w * 0.86, h * 0.16, tip - 0.35 - (taperStart + 1.05)],
    [0, 0, 0],
    'body',
  );
  addBox(
    group,
    materials.body,
    [0, h * 0.24, tip - 0.28],
    [w * 0.58, h * 0.13, 0.52],
    [0, 0, 0],
    'body',
  );
  addBox(
    group,
    materials.accent,
    [0, h * 0.335, tip - 0.42],
    [w * 0.72, 0.04, 1.15],
    [0, 0, 0],
    'accent',
  );
  addBox(group, materials.dark, [0, 0.08, (taperStart + 1.2 + tip - 0.45) / 2], [w * 0.7, 0.12, tip - 0.45 - (taperStart + 1.2)]);
  addBox(group, materials.dark, [0, h * 0.17, tip - 0.08], [w * 0.36, 0.08, 0.16]);

  addBox(
    group,
    materials.dark,
    [0, h * 0.68, taperStart + 0.18],
    [w * 0.78, h * 0.28, 0.12],
    [-0.62, 0, 0],
  );
  addBox(
    group,
    materials.glass,
    [0, h * 0.66, taperStart + 0.28],
    [w * 0.64, h * 0.22, 0.08],
    [-0.62, 0, 0],
  );
  for (const x of [-1, 1]) {
    addBox(group, materials.glass, [x * w * 0.4, h * 0.58, taperStart + 0.55], [0.06, h * 0.16, 0.7], [0, 0, 0]);
  }

  for (const x of [-1, 1]) {
    addCylinder(
      group,
      materials.light,
      [x * w * 0.29, h * 0.27, taperStart + 1.42],
      [0.22, 0.12, 0.22],
      [Math.PI / 2, 0, 0],
    );
    addBox(group, materials.light, [x * w * 0.22, h * 0.42, taperStart + 0.82], [0.1, 0.08, 0.08]);
  }
  addBox(group, materials.light, [0, h * 0.3, tip - 0.06], [0.18, 0.06, 0.08]);

  addBox(group, materials.accent, [0, h * 0.37, taperStart + 0.7], [w * 0.88, 0.08, 1.15], [0, 0, 0], 'accent');
  return group;
}

function addTaperStep(
  group: THREE.Group,
  materials: TrainModelMaterials,
  width: number,
  z0: number,
  z1: number,
  stepHeight: number,
  stepWidth: number,
  yBottom: number,
): void {
  const depth = z1 - z0;
  addBox(
    group,
    materials.body,
    [0, yBottom + stepHeight / 2, (z0 + z1) / 2],
    [stepWidth, stepHeight, depth * 0.98],
    [0, 0, 0],
    'body',
  );
  addBox(
    group,
    materials.accent,
    [0, yBottom + stepHeight - 0.03, (z0 + z1) / 2],
    [Math.min(stepWidth * 0.78, width * 0.7), 0.06, depth * 0.9],
    [0, 0, 0],
    'accent',
  );
}

function buildCar(
  width: number,
  height: number,
  materials: TrainModelMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const L = TRAIN_CAR_LENGTH;
  const w = width;
  const h = height;
  addBox(group, materials.body, [0, h * 0.51, 0], [w * 0.97, h * 0.86, L * 0.94], [0, 0, 0], 'body');
  addBox(group, materials.accent, [0, h - 0.045, 0], [w * 0.8, 0.09, L * 0.9], [0, 0, 0], 'accent');
  addBox(group, materials.dark, [0, 0.075, 0], [w * 0.9, 0.15, L * 0.94]);
  addBox(group, materials.accent, [0, h * 0.37, 0], [w * 0.995, 0.1, L * 0.88], [0, 0, 0], 'accent');
  for (const x of [-1, 1]) {
    addBox(group, materials.glass, [x * w * 0.485, h * 0.63, 0], [0.05, h * 0.2, L * 0.72]);
    addBox(group, materials.dark, [x * w * 0.49, h * 0.5, -L * 0.18], [0.04, h * 0.38, 0.42]);
    addBox(group, materials.dark, [x * w * 0.49, h * 0.5, L * 0.18], [0.04, h * 0.38, 0.42]);
  }
  addBox(group, materials.dark, [0, h * 0.48, L * 0.48], [w * 0.72, h * 0.7, 0.1]);
  addBox(group, materials.dark, [0, h * 0.48, -L * 0.48], [w * 0.72, h * 0.7, 0.1]);
  addBox(group, materials.metal, [0, h * 0.22, L * 0.5], [w * 0.28, 0.12, 0.12]);
  addBox(group, materials.metal, [0, h * 0.22, -L * 0.5], [w * 0.28, 0.12, 0.12]);
  addBogie(group, materials, -L * 0.28, w, h);
  addBogie(group, materials, L * 0.28, w, h);
  return group;
}

function addBogie(
  parent: THREE.Object3D,
  materials: TrainModelMaterials,
  z: number,
  width: number,
  height: number,
): void {
  addBox(parent, materials.dark, [0, 0.11, z], [width * 0.72, 0.12, 0.7]);
  for (const x of [-1, 1]) {
    addCylinder(
      parent,
      materials.dark,
      [x * width * 0.38, 0.09, z - 0.18],
      [0.22, height * 0.06, 0.22],
      [0, 0, Math.PI / 2],
    );
    addCylinder(
      parent,
      materials.dark,
      [x * width * 0.38, 0.09, z + 0.18],
      [0.22, height * 0.06, 0.22],
      [0, 0, Math.PI / 2],
    );
  }
}
