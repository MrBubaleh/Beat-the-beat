import * as THREE from 'three';
import type { TutorialIntent } from '@core/tutorial/TutorialController';

export class TutorialArrows {
  readonly root = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissiveIntensity: 1.1,
    roughness: 0.35,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  private readonly green = new THREE.Color('#55ff70');
  private readonly turquoise = new THREE.Color('#2ec4b6');
  private readonly highlight = new THREE.Color('#dcfff4');
  private readonly geometries: THREE.BufferGeometry[];
  private time = 0;

  constructor() {
    const stem = new THREE.BoxGeometry(0.34, 0.9, 0.2);
    const head = new THREE.ConeGeometry(0.52, 0.5, 4);
    head.scale(1, 1, 0.4);
    this.geometries = [stem, head];
    for (const geometry of this.geometries) {
      const position = geometry.getAttribute('position');
      const colors = new Float32Array(position.count * 3);
      geometry.computeBoundingBox();
      const min = geometry.boundingBox!.min.y;
      const span = geometry.boundingBox!.max.y - min;
      for (let i = 0; i < position.count; i++) {
        const shade = 0.45 + 0.55 * (position.getY(i) - min) / span;
        colors.set([shade, shade, shade], i * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const stemMesh = new THREE.Mesh(stem, this.material);
    stemMesh.position.y = -0.15;
    const headMesh = new THREE.Mesh(head, this.material);
    headMesh.position.y = 0.55;
    stemMesh.renderOrder = headMesh.renderOrder = this.root.renderOrder = 14;
    this.root.add(stemMesh, headMesh);
    this.root.visible = false;
  }

  update(intent: TutorialIntent | null, dt: number): void {
    this.time += dt;
    this.root.visible = Boolean(intent?.active && intent.arrowPose);
    if (!intent?.active || !intent.arrowPose) return;
    const pose = intent.arrowPose;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const shimmer = 0.5 + 0.5 * Math.sin(this.time * 3.5);
    const travel = Math.sin(this.time * 4) * 0.22;
    this.root.position.set(
      pose.x,
      pose.y + (intent.stage === 'nitro' ? 0 : intent.stage === 'slide' ? -travel : travel),
      pose.z + (intent.stage === 'nitro' ? travel : 0),
    );
    this.root.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    const scale = 1.15 + pulse * 0.15;
    this.root.scale.set(scale, scale * (intent.stage === 'nitro' ? 2.2 : 1), scale);
    const base = intent.arrowColor === 'green' ? this.green : this.turquoise;
    this.material.color.copy(base).lerp(this.highlight, shimmer * 0.3);
    this.material.emissive.copy(base);
    this.material.emissiveIntensity = 0.7 + pulse * 0.6;
  }

  reset(): void {
    this.root.visible = false;
    this.time = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}
