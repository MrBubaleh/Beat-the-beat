import * as THREE from 'three';
import type { ObstacleModelMaterials } from './ObstacleModels';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);

export function createFrontierTownScenery(
  length: number,
  roadEdge: number,
  materials: ObstacleModelMaterials,
): THREE.Group {
  const root = new THREE.Group();
  const spacing = 11;
  const sectionCount = Math.max(3, Math.floor(length / spacing));
  addTownGate(root, 1.5, roadEdge, materials, false);
  addTownGate(root, Math.max(4, length - 2), roadEdge, materials, true);
  for (let index = 0; index < sectionCount; index++) {
    const z = 6 + index * spacing;
    if (z > length - 5) break;
    addFacade(root, -1, z, roadEdge, materials, index);
    addFacade(root, 1, z + spacing * 0.42, roadEdge, materials, index + 3);
  }
  return root;
}

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.scale.set(...scale);
  result.rotation.set(...rotation);
  parent.add(result);
  return result;
}

function addTownGate(
  root: THREE.Group,
  z: number,
  roadEdge: number,
  materials: ObstacleModelMaterials,
  exit: boolean,
): void {
  const gate = new THREE.Group();
  gate.position.z = z;
  for (const side of [-1, 1]) {
    mesh(gate, BOX, materials.woodDark, [side * (roadEdge + 0.95), 2.4, 0], [0.32, 4.8, 0.38], [0, 0, side * 0.025]);
    mesh(gate, BOX, materials.rock, [side * (roadEdge + 0.95), 0.22, 0], [0.72, 0.44, 0.75]);
  }
  mesh(gate, BOX, materials.wood, [0, 4.72, 0], [roadEdge * 2 + 2.2, 0.36, 0.42], [0, 0, exit ? -0.025 : 0.025]);
  mesh(gate, BOX, materials.canvas, [0, 4.23, -0.26], [3.8, 0.72, 0.15]);
  for (const x of [-1.45, -0.72, 0, 0.72, 1.45]) {
    mesh(gate, BOX, materials.paint, [x, 4.23, -0.35], [0.12, 0.38, 0.035]);
  }
  root.add(gate);
}

function addFacade(
  root: THREE.Group,
  side: -1 | 1,
  z: number,
  roadEdge: number,
  materials: ObstacleModelMaterials,
  variant: number,
): void {
  const facade = new THREE.Group();
  const height = 3.3 + (variant % 3) * 0.42;
  const depth = 5.2 + (variant % 2) * 1.15;
  const frontX = side * (roadEdge + 1.7);
  const bodyX = side * (roadEdge + 3.15);
  mesh(facade, BOX, variant % 2 === 0 ? materials.wood : materials.woodDark, [bodyX, height * 0.5, z], [3.2, height, depth]);
  mesh(facade, BOX, materials.woodDark, [bodyX - side * 0.15, height + 0.18, z], [3.65, 0.24, depth * 1.06], [0, 0, side * 0.035]);
  const porchY = 2.25 + (variant % 2) * 0.18;
  mesh(facade, BOX, materials.canvas, [frontX, porchY, z], [1.7, 0.16, depth * 0.94], [0, 0, side * 0.06]);
  for (const postZ of [-depth * 0.38, depth * 0.38]) {
    mesh(facade, BOX, materials.woodDark, [frontX - side * 0.55, porchY * 0.5, z + postZ], [0.13, porchY, 0.13]);
  }
  const doorZ = z + (variant % 2 === 0 ? -depth * 0.18 : depth * 0.18);
  mesh(facade, BOX, materials.dark, [frontX - side * 0.18, 1.05, doorZ], [0.08, 1.9, 0.86]);
  for (const windowZ of [-depth * 0.3, depth * 0.3]) {
    mesh(facade, BOX, materials.glass, [frontX - side * 0.2, 1.65, z + windowZ], [0.08, 0.72, 0.72]);
    mesh(facade, BOX, materials.paint, [frontX - side * 0.27, 1.65, z + windowZ], [0.025, 0.78, 0.1]);
  }
  mesh(facade, BOX, materials.canvas, [frontX - side * 0.28, height - 0.48, z], [0.16, 0.72, 2.15]);
  for (const signZ of [-0.72, 0, 0.72]) {
    mesh(facade, BOX, materials.paint, [frontX - side * 0.37, height - 0.48, z + signZ], [0.035, 0.11, 0.38]);
  }
  if (variant % 3 === 0) {
    for (let index = 0; index < 2; index++) {
      mesh(facade, BOX, materials.wood, [side * (roadEdge + 0.82), 0.34 + index * 0.3, z + depth * 0.22], [0.62 - index * 0.08, 0.62 - index * 0.08, 0.62 - index * 0.08], [0, side * (0.12 + index * 0.08), 0]);
    }
  } else if (variant % 3 === 1) {
    mesh(facade, CYLINDER, materials.metal, [side * (roadEdge + 0.84), 0.48, z - depth * 0.18], [0.58, 0.96, 0.58]);
    mesh(facade, BOX, materials.paint, [side * (roadEdge + 0.84), 0.46, z - depth * 0.48], [0.65, 0.08, 0.035]);
  }
  root.add(facade);
}
