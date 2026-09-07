import * as THREE from 'three';

const HORIZON_VIDEO_VERTEX = `
uniform float uCurve;
uniform float uDome;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 transformed = position;
  float nx = (uv.x - 0.5) * 2.0;
  float ny = (uv.y - 0.5) * 2.0;
  transformed.z += nx * nx * uCurve + ny * ny * uDome;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const HORIZON_VIDEO_FRAGMENT = `
uniform sampler2D map;
uniform float opacity;
uniform float uGrade;
varying vec2 vUv;

void main() {
  vec4 color = texture2D(map, vUv);
  float edgeX = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float edgeY = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
  float alpha = edgeX * edgeY * opacity;
  if (alpha < 0.01) discard;
  vec3 graded = color.rgb;
  graded = mix(graded, graded * vec3(1.08, 1.0, 0.9), clamp(uGrade, 0.0, 1.0) * 0.42);
  graded *= 1.0 + clamp(uGrade, 0.0, 1.0) * 0.14;
  gl_FragColor = vec4(graded, alpha);
}
`;

export const HORIZON_VIDEO_Z = 86;
export const HORIZON_VIDEO_Y = 17;
export const HORIZON_VIDEO_CAR_JUMP_Y_BOOST = 6;
export const HORIZON_VIDEO_NITRO_SCALE = 1.86;
export const HORIZON_VIDEO_NITRO_Y_BOOST = 17;
export const HORIZON_VIDEO_NITRO_CURVE_BOOST = 11.5;
export const HORIZON_VIDEO_NITRO_DOME_BOOST = 7;
export const HORIZON_VIDEO_SPEED_SCALE = 1.26;
export const HORIZON_VIDEO_SPEED_Y_BOOST = 5.5;
export const HORIZON_VIDEO_SPEED_CURVE_BOOST = 4.2;
export const HORIZON_VIDEO_SPEED_DOME_BOOST = 2.4;
export const HORIZON_VIDEO_SPEED_START = 0.5;
export const HORIZON_VIDEO_SPEED_END = 0.94;
export const HORIZON_VIDEO_WIDTH = 52;
export const HORIZON_VIDEO_HEIGHT = 22.1;
export const HORIZON_VIDEO_CURVE = 3.8;

export function createHorizonVideoMaterial(
  texture: THREE.VideoTexture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: 0.92 },
      uCurve: { value: HORIZON_VIDEO_CURVE },
      uDome: { value: 0 },
      uGrade: { value: 0 },
    },
    vertexShader: HORIZON_VIDEO_VERTEX,
    fragmentShader: HORIZON_VIDEO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createHorizonVideoMesh(texture: THREE.VideoTexture): THREE.Mesh {
  const material = createHorizonVideoMaterial(texture);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(HORIZON_VIDEO_WIDTH, HORIZON_VIDEO_HEIGHT, 24, 10),
    material,
  );
  mesh.position.set(0, HORIZON_VIDEO_Y, HORIZON_VIDEO_Z);
  mesh.rotation.y = Math.PI;
  mesh.renderOrder = -20;
  mesh.frustumCulled = false;
  return mesh;
}

export function disposeHorizonVideoMesh(mesh: THREE.Mesh): void {
  const material = mesh.material;
  if (material instanceof THREE.ShaderMaterial) {
    const map = material.uniforms.map?.value;
    if (map instanceof THREE.VideoTexture) map.dispose();
    material.dispose();
  }
  mesh.geometry.dispose();
}
