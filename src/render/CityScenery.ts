import * as THREE from 'three';

interface ScrollItem {
  group: THREE.Group;
  initialZ: number;
  speedScale: number;
  span: number;
}

interface FadeBinding {
  material: THREE.Material & { opacity: number };
  baseOpacity: number;
  solid: boolean;
}

export interface CitySceneryRig {
  root: THREE.Group;
  buildings: THREE.Group[];
  landmarks: THREE.Group[];
  overpasses: THREE.Group[];
  elevatedTrain: THREE.Group;
  helicopter: THREE.Group;
  helicopterMainRotor: THREE.Group;
  helicopterTailRotor: THREE.Group;
  airplane: THREE.Group;
  elapsed: number;
  scrollItems: ScrollItem[];
  fadeBindings: FadeBinding[];
}

export interface CitySceneryUpdate {
  dt: number;
  scrollDistance: number;
  blend: number;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SPHERE = new THREE.SphereGeometry(0.5, 10, 7);
const CITY_SPAN = 144;
const CITY_REAR_THRESHOLD = -24;
const CITY_BUILDING_ROAD_OFFSET = 4.5;
const CITY_BUILDING_DEPTH_STEP = 1.75;
const CITY_HIDE_DEPTH = 22;

export function createCityScenery(roadEdge: number): CitySceneryRig {
  const root = new THREE.Group();
  root.name = 'city-scenery';
  root.userData.sceneryKind = 'city';
  const fadeBindings: FadeBinding[] = [];
  const materials = createCityMaterials(fadeBindings);
  const buildings: THREE.Group[] = [];
  const landmarks: THREE.Group[] = [];
  const overpasses: THREE.Group[] = [];
  const scrollItems: ScrollItem[] = [];

  for (let index = 0; index < 12; index++) {
    const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const z = 8 + index * 11.6;
    const building = createBuilding(side, index, roadEdge, materials);
    building.position.z = z;
    buildings.push(building);
    root.add(building);
    scrollItems.push({
      group: building,
      initialZ: z,
      speedScale: index % 3 === 0 ? 0.34 : 0.46,
      span: CITY_SPAN,
    });
  }

  const stadium = createStadium(roadEdge, materials);
  stadium.position.z = 58;
  landmarks.push(stadium);
  root.add(stadium);
  scrollItems.push({
    group: stadium,
    initialZ: 58,
    speedScale: 0.3,
    span: CITY_SPAN,
  });

  const parking = createParkingGarage(roadEdge, materials);
  parking.position.z = 91;
  landmarks.push(parking);
  root.add(parking);
  scrollItems.push({
    group: parking,
    initialZ: 91,
    speedScale: 0.44,
    span: CITY_SPAN,
  });

  const elevatedLine = createElevatedLine(roadEdge, materials);
  elevatedLine.group.position.z = 124;
  landmarks.push(elevatedLine.group);
  root.add(elevatedLine.group);
  scrollItems.push({
    group: elevatedLine.group,
    initialZ: 124,
    speedScale: 0.58,
    span: CITY_SPAN,
  });

  for (const [index, z] of [34, 108].entries()) {
    const overpass = createPedestrianOverpass(roadEdge, materials, index);
    overpass.position.z = z;
    overpasses.push(overpass);
    root.add(overpass);
    scrollItems.push({
      group: overpass,
      initialZ: z,
      speedScale: 1,
      span: CITY_SPAN,
    });
  }

  const helicopterRig = createHelicopter(materials);
  root.add(helicopterRig.group);
  const airplane = createAirplane(materials);
  root.add(airplane);

  const rig: CitySceneryRig = {
    root,
    buildings,
    landmarks,
    overpasses,
    elevatedTrain: elevatedLine.train,
    helicopter: helicopterRig.group,
    helicopterMainRotor: helicopterRig.mainRotor,
    helicopterTailRotor: helicopterRig.tailRotor,
    airplane,
    elapsed: 0,
    scrollItems,
    fadeBindings,
  };
  resetCityScenery(rig);
  return rig;
}

export function updateCityScenery(
  rig: CitySceneryRig,
  update: CitySceneryUpdate,
): void {
  const blend = clamp01(update.blend);
  rig.root.position.y = -CITY_HIDE_DEPTH * (1 - blend);
  rig.root.visible = blend > 0.005;
  for (const binding of rig.fadeBindings) {
    binding.material.opacity = binding.baseOpacity;
    const transparent = !binding.solid;
    if (binding.material.transparent !== transparent) {
      binding.material.transparent = transparent;
      binding.material.needsUpdate = true;
    }
    binding.material.depthWrite = binding.solid;
  }
  if (!rig.root.visible) {
    rig.helicopter.visible = false;
    rig.airplane.visible = false;
    return;
  }

  rig.elapsed += Math.max(0, update.dt);
  for (const item of rig.scrollItems) {
    item.group.position.z -= update.scrollDistance * item.speedScale;
    while (item.group.position.z < CITY_REAR_THRESHOLD) {
      item.group.position.z += item.span;
    }
  }

  rig.helicopterMainRotor.rotation.y += update.dt * 26;
  rig.helicopterTailRotor.rotation.z += update.dt * 31;
  rig.elevatedTrain.position.z =
    -7 + positiveModulo(rig.elapsed * 3.8, 14);
  const helicopterCycle = positiveModulo(rig.elapsed + 4, 23);
  const helicopterDuration = 6.2;
  rig.helicopter.visible = helicopterCycle < helicopterDuration && blend > 0.08;
  if (rig.helicopter.visible) {
    const progress = helicopterCycle / helicopterDuration;
    rig.helicopter.position.set(
      -23 + progress * 46,
      10.8 + Math.sin(progress * Math.PI) * 1.15,
      24 + Math.sin(progress * Math.PI * 2) * 2.5,
    );
    rig.helicopter.rotation.set(0, 0, -0.11);
  }

  const airplaneCycle = positiveModulo(rig.elapsed + 17, 37);
  const airplaneDuration = 4.8;
  rig.airplane.visible = airplaneCycle < airplaneDuration && blend > 0.1;
  if (rig.airplane.visible) {
    const progress = airplaneCycle / airplaneDuration;
    rig.airplane.position.set(
      28 - progress * 56,
      17.5 + Math.sin(progress * Math.PI) * 0.7,
      42 - progress * 6,
    );
    rig.airplane.rotation.set(0.03, Math.PI, 0.055);
  }
}

export function resetCityScenery(rig: CitySceneryRig): void {
  rig.elapsed = 0;
  for (const item of rig.scrollItems) {
    item.group.position.z = item.initialZ;
  }
  rig.helicopter.visible = false;
  rig.airplane.visible = false;
  rig.elevatedTrain.position.z = -7;
  rig.root.position.y = 0;
  rig.root.visible = true;
}

function createCityMaterials(fadeBindings: FadeBinding[]) {
  const material = (
    color: number,
    emissive: number,
    baseOpacity: number,
    metalness = 0.08,
    solid = false,
  ): THREE.MeshStandardMaterial => {
    const result = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: emissive === 0 ? 0 : 0.75,
      roughness: 0.78,
      metalness,
      transparent: !solid,
      opacity: baseOpacity,
      depthWrite: solid,
    });
    fadeBindings.push({ material: result, baseOpacity, solid });
    return result;
  };
  return {
    concrete: material(0x30363e, 0x05080c, 1, 0.18, true),
    concreteAlt: material(0x3e4350, 0x080a10, 1, 0.16, true),
    buildingGlass: material(0x263d50, 0x0d2638, 1, 0.28, true),
    glass: material(0x263d50, 0x0d2638, 0.62, 0.28),
    windowWarm: material(0xa06e42, 0x4a2914, 0.56),
    neonCyan: material(0x3a91a5, 0x126879, 0.48, 0.12),
    neonPink: material(0x9a4f78, 0x5f2045, 0.4, 0.08),
    roadMetal: material(0x505965, 0x0b1016, 1, 0.42, true),
    aircraft: material(0x596574, 0x0c1219, 1, 0.32, true),
    aircraftGlass: material(0x34566d, 0x10394f, 0.58, 0.24),
    dark: material(0x1d2229, 0x030507, 1, 0.24, true),
  };
}

type CityMaterials = ReturnType<typeof createCityMaterials>;

function createBuilding(
  side: -1 | 1,
  index: number,
  roadEdge: number,
  materials: CityMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'city-building';
  const variant = index % 4;
  const height = 8.5 + (index % 5) * 2.1;
  const width = 4.2 + (index % 3) * 0.8;
  const depth = 5.8 + ((index + 1) % 3) * 1.2;
  const x =
    side *
    (roadEdge +
      CITY_BUILDING_ROAD_OFFSET +
      (index % 3) * CITY_BUILDING_DEPTH_STEP);
  const bodyMaterial = index % 2 === 0 ? materials.concrete : materials.concreteAlt;

  if (variant === 0) {
    addBox(group, bodyMaterial, [x, height * 0.5, 0], [width, height, depth]);
    addBox(group, materials.buildingGlass, [x - side * width * 0.03, height * 0.78, 0], [width * 1.04, height * 0.34, depth * 0.72]);
    addBox(group, materials.neonCyan, [x - side * width * 0.52, height * 0.62, 0], [0.08, height * 0.72, depth * 0.66]);
  } else if (variant === 1) {
    addBox(group, bodyMaterial, [x, height * 0.36, 0], [width * 1.12, height * 0.72, depth]);
    addBox(group, materials.buildingGlass, [x, height * 0.78, 0.2], [width * 0.78, height * 0.56, depth * 0.72]);
    addBox(group, materials.neonPink, [x - side * width * 0.45, height * 0.78, 0.2], [0.1, height * 0.44, depth * 0.56]);
  } else if (variant === 2) {
    addBox(group, materials.buildingGlass, [x, height * 0.5, 0], [width * 0.84, height, depth * 0.86]);
    addBox(group, bodyMaterial, [x, height * 0.14, 0], [width, height * 0.28, depth]);
    addBox(group, materials.roadMetal, [x, height + 0.28, 0], [width * 0.62, 0.56, depth * 0.52]);
    addBox(group, materials.neonCyan, [x - side * width * 0.44, height * 0.52, 0], [0.07, height * 0.82, depth * 0.68]);
  } else {
    addBox(group, bodyMaterial, [x, height * 0.42, 0], [width * 1.2, height * 0.84, depth]);
    addBox(group, materials.concreteAlt, [x, height * 0.9, 0], [width * 0.82, height * 0.18, depth * 0.78]);
    addBox(group, materials.neonPink, [x - side * width * 0.62, height * 0.68, 0], [0.09, height * 0.22, depth * 0.7]);
  }

  const facadeX = x - side * width * 0.51;
  for (let row = 0; row < 4; row++) {
    const y = 1.7 + row * Math.max(1.4, (height - 2.4) / 4);
    addBox(
      group,
      row % 3 === 0 ? materials.windowWarm : materials.glass,
      [facadeX, y, 0],
      [0.07, 0.32, depth * 0.72],
    );
  }
  if (index % 3 === 0) {
    addBox(group, materials.neonCyan, [facadeX - side * 0.06, height * 0.45, depth * 0.28], [0.06, 1.8, 1.15]);
  }
  if (index % 4 === 2) {
    const antenna = addPart(group, CYLINDER, materials.roadMetal, [x, height + 1.15, 0], [0.12, 2.3, 0.12]);
    antenna.rotation.z = side * 0.025;
  }
  return group;
}

function createPedestrianOverpass(
  roadEdge: number,
  materials: CityMaterials,
  variant: number,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'pedestrian-overpass';
  const clearance = 5.35 + variant * 0.2;
  const span = roadEdge * 2 + 5.2;
  for (const side of [-1, 1]) {
    const x = side * (roadEdge + 1.85);
    addBox(group, materials.roadMetal, [x, clearance * 0.5, 0], [0.28, clearance, 0.4]);
    for (let step = 0; step < 4; step++) {
      addBox(
        group,
        materials.concreteAlt,
        [x + side * (0.45 + step * 0.42), 0.45 + step * 0.58, 0],
        [0.82, 0.18, 1.25],
      );
    }
  }
  addBox(group, materials.glass, [0, clearance, 0], [span, 1.05, 1.35]);
  addBox(group, materials.roadMetal, [0, clearance - 0.62, 0], [span * 1.03, 0.14, 1.52]);
  addBox(group, variant === 0 ? materials.neonCyan : materials.neonPink, [0, clearance + 0.02, -0.72], [span * 0.72, 0.12, 0.06]);
  return group;
}

function createStadium(
  roadEdge: number,
  materials: CityMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'stadium';
  const x = roadEdge + 15.5;
  addPart(
    group,
    new THREE.CylinderGeometry(1, 1.12, 1, 18),
    materials.concreteAlt,
    [x, 1.45, 0],
    [6.6, 2.9, 5.2],
  );
  addPart(
    group,
    new THREE.TorusGeometry(1, 0.08, 6, 24),
    materials.neonCyan,
    [x, 3.05, 0],
    [5.7, 4.4, 5.7],
    [Math.PI / 2, 0, 0],
  );
  addBox(group, materials.dark, [x, 2.78, 0], [7.8, 0.18, 5.8]);
  for (const z of [-2.6, 2.6]) {
    for (const side of [-1, 1]) {
      const poleX = x + side * 4.6;
      addPart(group, CYLINDER, materials.roadMetal, [poleX, 4.1, z], [0.12, 5.6, 0.12]);
      addBox(group, materials.windowWarm, [poleX, 6.9, z], [0.72, 0.26, 0.28]);
    }
  }
  return group;
}

function createParkingGarage(
  roadEdge: number,
  materials: CityMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'parking-garage';
  const x = -(roadEdge + 10.8);
  for (let level = 0; level < 4; level++) {
    const y = 0.2 + level * 1.25;
    addBox(group, materials.concreteAlt, [x, y, 0], [7.4, 0.22, 6.2]);
    for (const side of [-1, 1]) {
      addBox(group, materials.roadMetal, [x + side * 3.2, y + 0.58, 0], [0.2, 1.12, 5.5]);
    }
    addBox(group, materials.windowWarm, [x + 3.76, y + 0.56, 0], [0.08, 0.16, 4.6]);
  }
  addBox(group, materials.neonPink, [x + 3.9, 2.55, -1.7], [0.1, 1.7, 1.3]);
  return group;
}

function createElevatedLine(
  roadEdge: number,
  materials: CityMaterials,
): { group: THREE.Group; train: THREE.Group } {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'elevated-line';
  const x = roadEdge + 8.6;
  addBox(group, materials.roadMetal, [x, 5.1, 0], [2.5, 0.32, 20]);
  for (const z of [-7, 0, 7]) {
    addBox(group, materials.concreteAlt, [x, 2.5, z], [0.48, 5, 0.58]);
  }
  const train = new THREE.Group();
  train.userData.sceneryKind = 'elevated-train';
  for (const z of [-1.75, 1.75]) {
    addBox(train, materials.aircraft, [x, 5.82, z], [1.9, 1.18, 3.2]);
    addBox(train, materials.glass, [x - 0.98, 5.92, z], [0.06, 0.52, 2.35]);
    addBox(train, materials.neonCyan, [x - 1.02, 5.55, z], [0.04, 0.08, 2.5]);
  }
  group.add(train);
  return { group, train };
}

function createHelicopter(materials: CityMaterials): {
  group: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
} {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'helicopter';
  addPart(group, SPHERE, materials.aircraft, [0, 0, 0], [2.4, 1.15, 1.1]);
  addPart(group, SPHERE, materials.aircraftGlass, [0.78, 0.08, 0], [0.86, 0.72, 0.92]);
  addBox(group, materials.aircraft, [-1.45, 0.08, 0], [2.5, 0.24, 0.28], [0, 0, 0.08]);
  addBox(group, materials.aircraft, [-2.55, 0.32, 0], [0.16, 0.9, 0.75]);
  addBox(group, materials.dark, [-0.1, -0.72, 0], [1.8, 0.08, 1.35]);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 0.78, 0);
  addBox(mainRotor, materials.dark, [0, 0, 0], [6.2, 0.055, 0.12]);
  addBox(mainRotor, materials.dark, [0, 0, 0], [0.12, 0.055, 6.2]);
  group.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(-2.65, 0.28, 0.42);
  addBox(tailRotor, materials.dark, [0, 0, 0], [0.08, 1.2, 0.08]);
  addBox(tailRotor, materials.dark, [0, 0, 0], [0.08, 0.08, 1.2]);
  group.add(tailRotor);
  return { group, mainRotor, tailRotor };
}

function createAirplane(materials: CityMaterials): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'airplane';
  addPart(group, CYLINDER, materials.aircraft, [0, 0, 0], [0.52, 4.6, 0.52], [0, 0, -Math.PI / 2]);
  addPart(group, SPHERE, materials.aircraftGlass, [2.2, 0, 0], [0.72, 0.5, 0.5]);
  addBox(group, materials.aircraft, [0.15, 0, 0], [1.25, 0.12, 5.3]);
  addBox(group, materials.aircraft, [-1.65, 0.22, 0], [1.25, 0.1, 2.15]);
  addBox(group, materials.aircraft, [-1.82, 0.58, 0], [0.52, 1.05, 0.12], [0, 0, -0.2]);
  return group;
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  return addPart(parent, BOX, material, position, scale, rotation);
}

function addPart(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
