import * as THREE from 'three';

interface FadeBinding {
  material: THREE.Material & { opacity: number };
  baseOpacity: number;
}

interface SatelliteRig {
  group: THREE.Group;
  panelPivot: THREE.Group;
  phase: number;
}

export interface OrbitalSceneryRig {
  root: THREE.Group;
  moon: THREE.Group;
  planet: THREE.Group;
  satellites: SatelliteRig[];
  comet: THREE.Group;
  cometCore: THREE.Mesh;
  station: THREE.Group;
  stationRing: THREE.Mesh;
  fadeBindings: FadeBinding[];
  flightElapsed: number;
  previousBlend: number;
}

export interface OrbitalSceneryUpdate {
  dt: number;
  blend: number;
  cameraX: number;
  cameraY: number;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SPHERE = new THREE.SphereGeometry(0.5, 14, 10);
const CONE = new THREE.ConeGeometry(0.5, 1, 10);

export function createOrbitalScenery(): OrbitalSceneryRig {
  const root = new THREE.Group();
  root.name = 'orbital-scenery';
  root.userData.sceneryKind = 'orbital';
  const fadeBindings: FadeBinding[] = [];
  const materials = createOrbitalMaterials(fadeBindings);

  const stars = createStars(materials.stars);
  stars.userData.sceneryKind = 'starfield';
  root.add(stars);

  const moon = createMoon(materials);
  moon.position.set(-12.5, 8.5, 50);
  root.add(moon);

  const planet = createPlanet(materials);
  planet.position.set(18, -27, 62);
  root.add(planet);

  const satellites = [
    createSatellite(materials, 0),
    createSatellite(materials, 1),
  ];
  for (const satellite of satellites) root.add(satellite.group);

  const cometRig = createComet(materials);
  root.add(cometRig.group);

  const stationRig = createStation(materials);
  stationRig.group.position.set(-10.5, 8.2, 47);
  root.add(stationRig.group);

  const rig: OrbitalSceneryRig = {
    root,
    moon,
    planet,
    satellites,
    comet: cometRig.group,
    cometCore: cometRig.core,
    station: stationRig.group,
    stationRing: stationRig.ring,
    fadeBindings,
    flightElapsed: 0,
    previousBlend: 0,
  };
  resetOrbitalScenery(rig);
  return rig;
}

export function updateOrbitalScenery(
  rig: OrbitalSceneryRig,
  update: OrbitalSceneryUpdate,
): void {
  const blend = clamp01(update.blend);
  if (blend > 0.03 && rig.previousBlend <= 0.03) {
    rig.flightElapsed = 0;
  }
  rig.previousBlend = blend;
  rig.root.visible = blend > 0.005;
  for (const binding of rig.fadeBindings) {
    binding.material.opacity = binding.baseOpacity * blend;
  }
  if (!rig.root.visible) {
    rig.comet.visible = false;
    return;
  }

  rig.flightElapsed += Math.max(0, update.dt);
  rig.root.position.x = update.cameraX * 0.12;
  rig.root.position.y = update.cameraY * 0.34;
  rig.moon.rotation.y += update.dt * 0.018;
  rig.planet.rotation.y -= update.dt * 0.006;
  rig.stationRing.rotation.z += update.dt * 0.12;
  rig.station.rotation.y += update.dt * 0.025;

  for (let index = 0; index < rig.satellites.length; index++) {
    const satellite = rig.satellites[index];
    const time = rig.flightElapsed + satellite.phase;
    satellite.group.position.set(
      index === 0
        ? 8.5 + Math.sin(time * 0.34) * 2.4
        : -5.5 + Math.sin(time * 0.27 + 1.4) * 3.1,
      index === 0
        ? 6.2 + Math.sin(time * 0.48) * 0.65
        : 11.2 + Math.cos(time * 0.37) * 0.8,
      index === 0 ? 32 : 39,
    );
    satellite.group.rotation.y += update.dt * (index === 0 ? 0.42 : -0.29);
    satellite.group.rotation.z =
      Math.sin(time * 0.42) * (index === 0 ? 0.16 : 0.1);
    satellite.panelPivot.rotation.x +=
      update.dt * (index === 0 ? 0.18 : -0.13);
  }

  const cometStart = 1.4;
  const cometDuration = 2.4;
  const cometProgress =
    (rig.flightElapsed - cometStart) / cometDuration;
  rig.comet.visible =
    cometProgress >= 0 &&
    cometProgress <= 1 &&
    blend > 0.18;
  if (rig.comet.visible) {
    rig.comet.position.set(
      24 - cometProgress * 45,
      14.5 - cometProgress * 7.5,
      35 + cometProgress * 5,
    );
    rig.comet.rotation.z = -0.17;
    rig.cometCore.rotation.x += update.dt * 4.2;
    rig.cometCore.rotation.y += update.dt * 5.1;
  }
}

export function resetOrbitalScenery(rig: OrbitalSceneryRig): void {
  rig.flightElapsed = 0;
  rig.previousBlend = 0;
  rig.root.position.set(0, 0, 0);
  rig.root.visible = false;
  rig.comet.visible = false;
}

function createOrbitalMaterials(fadeBindings: FadeBinding[]) {
  const basic = (
    color: number,
    baseOpacity: number,
    blending: THREE.Blending = THREE.NormalBlending,
  ): THREE.MeshBasicMaterial => {
    const result = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending,
      fog: true,
    });
    fadeBindings.push({ material: result, baseOpacity });
    return result;
  };
  const stars = new THREE.PointsMaterial({
    color: 0xbfc9df,
    size: 0.12,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    fog: true,
  });
  fadeBindings.push({ material: stars, baseOpacity: 0.34 });
  return {
    stars,
    moon: basic(0xaeb3bd, 0.72),
    moonDark: basic(0x6f7480, 0.38),
    planet: basic(0x182c50, 0.58),
    atmosphere: basic(0x3a7caa, 0.24, THREE.AdditiveBlending),
    metal: basic(0x7b8494, 0.72),
    dark: basic(0x252b36, 0.78),
    solar: basic(0x28548a, 0.64),
    solarLine: basic(0x6aa1c4, 0.42, THREE.AdditiveBlending),
    stationLight: basic(0x7cc5d6, 0.35, THREE.AdditiveBlending),
    comet: basic(0x8d939f, 0.76),
    cometGlow: basic(0x7dbbd0, 0.34, THREE.AdditiveBlending),
  };
}

type OrbitalMaterials = ReturnType<typeof createOrbitalMaterials>;

function createStars(material: THREE.PointsMaterial): THREE.Points {
  const positions: number[] = [];
  for (let index = 0; index < 64; index++) {
    const x = ((index * 37) % 89) / 89;
    const y = ((index * 53 + 11) % 97) / 97;
    const z = ((index * 29 + 7) % 83) / 83;
    positions.push(
      -28 + x * 56,
      3 + y * 24,
      28 + z * 44,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return new THREE.Points(geometry, material);
}

function createMoon(materials: OrbitalMaterials): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'moon';
  addPart(group, SPHERE, materials.moon, [0, 0, 0], [7.6, 7.6, 7.6]);
  for (const [x, y, scale] of [
    [-1.25, 0.9, 0.72],
    [0.85, 1.25, 0.48],
    [1.35, -0.75, 0.6],
    [-0.55, -1.35, 0.38],
  ] as const) {
    addPart(
      group,
      SPHERE,
      materials.moonDark,
      [x, y, -3.56],
      [scale * 1.3, scale, 0.18],
    );
  }
  return group;
}

function createPlanet(materials: OrbitalMaterials): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'planet-limb';
  addPart(group, SPHERE, materials.planet, [0, 0, 0], [64, 64, 64]);
  addPart(group, SPHERE, materials.atmosphere, [0, 0, -0.2], [66, 66, 66]);
  return group;
}

function createSatellite(
  materials: OrbitalMaterials,
  index: number,
): SatelliteRig {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'satellite';
  const scale = index === 0 ? 1 : 0.72;
  group.scale.setScalar(scale);
  addBox(group, materials.metal, [0, 0, 0], [1.3, 0.9, 1.05]);
  addBox(group, materials.dark, [0, 0.58, 0], [0.82, 0.26, 0.82]);
  addPart(group, CONE, materials.metal, [0, 1.02, 0], [0.72, 0.42, 0.72], [0, 0, Math.PI]);
  addPart(group, CYLINDER, materials.dark, [0, -0.68, 0], [0.18, 0.7, 0.18]);

  const panelPivot = new THREE.Group();
  for (const side of [-1, 1]) {
    addBox(panelPivot, materials.dark, [side * 0.98, 0, 0], [0.68, 0.08, 0.12]);
    addBox(panelPivot, materials.solar, [side * 2.25, 0, 0], [1.85, 0.12, 1.35]);
    for (const z of [-0.42, 0, 0.42]) {
      addBox(panelPivot, materials.solarLine, [side * 2.25, -0.08, z], [1.72, 0.03, 0.04]);
    }
  }
  group.add(panelPivot);
  return { group, panelPivot, phase: index * 3.7 };
}

function createComet(materials: OrbitalMaterials): {
  group: THREE.Group;
  core: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'comet';
  const core = addPart(
    group,
    new THREE.DodecahedronGeometry(0.68, 0),
    materials.comet,
    [0, 0, 0],
    [1.2, 0.86, 0.92],
  );
  for (const [offsetY, scale] of [[0, 1], [0.28, 0.72], [-0.24, 0.62]] as const) {
    addPart(
      group,
      CONE,
      materials.cometGlow,
      [2.1 * scale, offsetY, 0],
      [0.72 * scale, 4.2 * scale, 0.72 * scale],
      [0, 0, -Math.PI / 2],
    );
  }
  return { group, core };
}

function createStation(materials: OrbitalMaterials): {
  group: THREE.Group;
  ring: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.userData.sceneryKind = 'orbital-station';
  const ring = addPart(
    group,
    new THREE.TorusGeometry(2.1, 0.18, 8, 24),
    materials.metal,
    [0, 0, 0],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
  );
  addPart(group, CYLINDER, materials.dark, [0, 0, 0], [0.72, 3.4, 0.72], [Math.PI / 2, 0, 0]);
  addPart(group, SPHERE, materials.stationLight, [0, 0, 0], [1.1, 1.1, 1.1]);
  for (const side of [-1, 1]) {
    addBox(group, materials.solar, [side * 3.6, 0, 0], [2.4, 0.12, 1.35]);
    addBox(group, materials.dark, [side * 2.2, 0, 0], [0.92, 0.12, 0.12]);
  }
  group.scale.setScalar(0.82);
  return { group, ring };
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
