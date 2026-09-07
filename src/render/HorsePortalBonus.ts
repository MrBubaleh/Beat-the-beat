import * as THREE from 'three';

const SPARK_COUNT = 28;
const SPRAY_COUNT = 10;
const BOX = new THREE.BoxGeometry(1, 1, 1);

const PORTAL_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PORTAL_FRAGMENT = `
uniform sampler2D uMap;
uniform float uTime;
uniform float uPulse;
uniform vec3 uRimColor;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 0.995) discard;
  float angle = atan(p.y, p.x);
  float heat = sin(p.y * 20.0 + uTime * 4.4) * 0.014 * smoothstep(0.1, 0.95, r);
  float swirl = sin(r * 13.0 - uTime * 2.8) * 0.022 * smoothstep(0.2, 1.0, r);
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 uv = clamp(vUv + dir * swirl + vec2(heat, heat * 0.4), 0.02, 0.98);
  vec3 scene = texture2D(uMap, uv).rgb;
  scene *= 1.0 + uPulse * 0.1;
  float rim = smoothstep(0.7, 0.985, r);
  vec3 color = mix(scene, uRimColor, rim * (0.5 + uPulse * 0.28));
  float vignette = smoothstep(1.0, 0.32, r);
  color *= 0.84 + vignette * 0.2;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const PORTAL_JELLY_SECONDS = 0.24;

export function samplePortalJelly(progress: number): {
  xy: number;
  z: number;
  flash: number;
} {
  const p = Math.max(0, Math.min(1, progress));
  const compress = Math.exp(-p * 7) * (1 - p);
  const z = 1 - 0.58 * compress + 0.16 * Math.sin(Math.PI * p) * (1 - p);
  const xy = 1 + (1 - z) * 0.85;
  const flash = Math.exp(-p * 5.5) * (1 - p * 0.35);
  return { xy, z, flash };
}

export type ModePortalKind = 'horse' | 'car';

export interface ModePortalInstance {
  root: THREE.Group;
  kind: ModePortalKind;
  portalMaterial: THREE.ShaderMaterial;
  rimMaterial: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  sparkGroup: THREE.Group;
  sparks: THREE.Mesh[];
  sprays: THREE.Mesh[];
  radius: number;
}

export type HorsePortalInstance = ModePortalInstance;

interface PortalTheme {
  rim: number;
  glow: number;
  spark: number;
  spray: number;
  inner: number;
  rimMix: [number, number, number];
}

const HORSE_THEME: PortalTheme = {
  rim: 0x45bfff,
  glow: 0x7ee7ff,
  spark: 0x9bebff,
  spray: 0xc8f6ff,
  inner: 0x0a2a44,
  rimMix: [0.27, 0.75, 1.0],
};

const CAR_THEME: PortalTheme = {
  rim: 0x55d7ff,
  glow: 0xff7eb8,
  spark: 0xc4f4ff,
  spray: 0xf0b8de,
  inner: 0x071018,
  rimMix: [0.33, 0.84, 1.0],
};

let westTexture: THREE.Texture | null = null;
let cityTexture: THREE.Texture | null = null;

export function createHorsePortal(radius: number): ModePortalInstance {
  return createModePortal(radius, 'horse');
}

export function createCarPortal(radius: number): ModePortalInstance {
  return createModePortal(radius, 'car');
}

export function createModePortal(
  radius: number,
  kind: ModePortalKind,
): ModePortalInstance {
  const theme = kind === 'car' ? CAR_THEME : HORSE_THEME;
  const root = new THREE.Group();
  const map = kind === 'car' ? getCityPostcardTexture() : getWestPostcardTexture();
  const portalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uRimColor: { value: new THREE.Vector3(...theme.rimMix) },
    },
    vertexShader: PORTAL_VERTEX,
    fragmentShader: PORTAL_FRAGMENT,
    toneMapped: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), portalMaterial);
  root.add(disc);

  const rimMaterial = new THREE.MeshBasicMaterial({
    color: theme.rim,
    transparent: true,
    opacity: 0.96,
  });
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.975, radius * 0.048, 8, 48),
    rimMaterial,
  );
  root.add(rim);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: theme.glow,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.99, radius * 0.07, 6, 40),
    glowMaterial,
  );
  glow.position.z = 0.01;
  root.add(glow);

  const innerEdge = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.93, radius * 0.012, 6, 40),
    new THREE.MeshBasicMaterial({ color: theme.inner }),
  );
  innerEdge.position.z = 0.008;
  root.add(innerEdge);

  const sparkGroup = new THREE.Group();
  sparkGroup.position.z = 0.03;
  root.add(sparkGroup);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: theme.spark,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const spark = new THREE.Mesh(BOX, sparkMat);
    spark.scale.set(radius * 0.16, radius * 0.024, radius * 0.014);
    sparks.push(spark);
    sparkGroup.add(spark);
  }
  const sprayMat = new THREE.MeshBasicMaterial({
    color: theme.spray,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprays: THREE.Mesh[] = [];
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const spray = new THREE.Mesh(BOX, sprayMat);
    spray.scale.set(radius * 0.26, radius * 0.014, radius * 0.01);
    sprays.push(spray);
    sparkGroup.add(spray);
  }

  return {
    root,
    kind,
    portalMaterial,
    rimMaterial,
    glowMaterial,
    sparkGroup,
    sparks,
    sprays,
    radius,
  };
}

export function updateHorsePortal(
  instance: ModePortalInstance,
  time: number,
  pulse: number,
): void {
  updateModePortal(instance, time, pulse);
}

export function updateModePortal(
  instance: ModePortalInstance,
  time: number,
  pulse: number,
): void {
  instance.portalMaterial.uniforms.uTime.value = time;
  instance.portalMaterial.uniforms.uPulse.value = pulse;
  instance.rimMaterial.opacity = 0.88 + pulse * 0.12;
  instance.glowMaterial.opacity = 0.34 + pulse * 0.22;
  instance.sparkGroup.rotation.z = -time * 2.35;
  const r = instance.radius;
  for (let i = 0; i < instance.sparks.length; i++) {
    const angle = (i / instance.sparks.length) * Math.PI * 2;
    const wobble = 1 + Math.sin(time * 9.2 + i * 1.7) * 0.07;
    instance.sparks[i].position.set(Math.cos(angle) * r * wobble, Math.sin(angle) * r * wobble, 0);
    instance.sparks[i].rotation.z = angle + Math.PI / 2;
    instance.sparks[i].scale.x = r * (0.12 + 0.07 * (0.5 + 0.5 * Math.sin(time * 11 + i)));
  }
  for (let i = 0; i < instance.sprays.length; i++) {
    const cycle = (time * 1.8 + i * 0.37) % 1;
    const angle = (i / instance.sprays.length) * Math.PI * 2 + time * 0.4;
    const reach = r * (1 + cycle * 0.06);
    instance.sprays[i].position.set(Math.cos(angle) * reach, Math.sin(angle) * reach, 0);
    instance.sprays[i].rotation.z = angle + Math.PI / 2;
    instance.sprays[i].scale.x = r * (0.2 + cycle * 0.22);
  }
}

export function getWestPostcardTexture(): THREE.Texture {
  if (westTexture) return westTexture;
  westTexture = makePostcardTexture('#f0b060', drawWestPostcard);
  return westTexture;
}

export function getCityPostcardTexture(): THREE.Texture {
  if (cityTexture) return cityTexture;
  cityTexture = makePostcardTexture('#16324a', drawCityPostcard);
  return cityTexture;
}

function makePostcardTexture(
  fallbackRgb: string,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.Texture {
  if (typeof document === 'undefined') {
    const rgb = fallbackRgb === '#16324a' ? [22, 50, 74] : [240, 176, 96];
    const data = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
    const texture = new THREE.DataTexture(data, 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function drawWestPostcard(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size;
  const sky = ctx.createLinearGradient(0, 0, 0, s * 0.62);
  sky.addColorStop(0, '#6aa7c8');
  sky.addColorStop(0.55, '#f0c98a');
  sky.addColorStop(1, '#e08a45');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, s, s);

  ctx.fillStyle = '#ffe7a8';
  ctx.beginPath();
  ctx.arc(s * 0.72, s * 0.34, s * 0.07, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c46a38';
  fillMesa(ctx, s * 0.18, s * 0.5, s * 0.22, s * 0.12);
  fillMesa(ctx, s * 0.78, s * 0.48, s * 0.2, s * 0.14);
  ctx.fillStyle = '#a85a30';
  fillMesa(ctx, s * 0.5, s * 0.52, s * 0.16, s * 0.09);

  const ground = ctx.createLinearGradient(0, s * 0.54, 0, s);
  ground.addColorStop(0, '#d9a45a');
  ground.addColorStop(1, '#8a5a2c');
  ctx.fillStyle = ground;
  ctx.fillRect(0, s * 0.54, s, s * 0.46);

  ctx.fillStyle = '#c9a06a';
  ctx.beginPath();
  ctx.moveTo(s * 0.46, s * 0.58);
  ctx.lineTo(s * 0.54, s * 0.58);
  ctx.lineTo(s * 0.72, s);
  ctx.lineTo(s * 0.28, s);
  ctx.closePath();
  ctx.fill();

  drawSaloon(ctx, s, 0.18, 0.58, 0.14, 0.22, '#8b4f24');
  drawSaloon(ctx, s, 0.3, 0.56, 0.12, 0.2, '#6e3b18');
  drawSaloon(ctx, s, 0.41, 0.55, 0.1, 0.17, '#a05a28');
  drawSaloon(ctx, s, 0.52, 0.555, 0.11, 0.19, '#7a431c');
  drawSaloon(ctx, s, 0.64, 0.57, 0.13, 0.21, '#92501f');
  drawSaloon(ctx, s, 0.76, 0.59, 0.12, 0.18, '#6a3614');

  drawCactus(ctx, s * 0.12, s * 0.78, s * 0.09);
  drawCactus(ctx, s * 0.88, s * 0.82, s * 0.08);
}

export function drawCityPostcard(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size;
  const sky = ctx.createLinearGradient(0, 0, 0, s * 0.62);
  sky.addColorStop(0, '#07111c');
  sky.addColorStop(0.45, '#12304a');
  sky.addColorStop(1, '#1d4a62');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, s, s);

  ctx.fillStyle = '#dfe9f4';
  ctx.beginPath();
  ctx.arc(s * 0.78, s * 0.18, s * 0.045, 0, Math.PI * 2);
  ctx.fill();

  const towers: Array<[number, number, number, string]> = [
    [0.08, 0.38, 0.12, '#2a3544'],
    [0.18, 0.46, 0.1, '#323e4e'],
    [0.28, 0.34, 0.11, '#263240'],
    [0.4, 0.52, 0.13, '#354556'],
    [0.52, 0.3, 0.1, '#2c3948'],
    [0.62, 0.44, 0.12, '#314050'],
    [0.74, 0.36, 0.11, '#283644'],
    [0.84, 0.48, 0.1, '#334455'],
  ];
  for (const [nx, nh, nw, color] of towers) {
    drawTower(ctx, s, nx, 0.64, nw, nh, color);
  }

  const ground = ctx.createLinearGradient(0, s * 0.62, 0, s);
  ground.addColorStop(0, '#1a242e');
  ground.addColorStop(1, '#0e141b');
  ctx.fillStyle = ground;
  ctx.fillRect(0, s * 0.62, s, s * 0.38);

  ctx.fillStyle = '#2c3640';
  ctx.beginPath();
  ctx.moveTo(s * 0.44, s * 0.64);
  ctx.lineTo(s * 0.56, s * 0.64);
  ctx.lineTo(s * 0.78, s);
  ctx.lineTo(s * 0.22, s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d8c46a';
  ctx.lineWidth = s * 0.008;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.66);
  ctx.lineTo(s * 0.5, s);
  ctx.stroke();

  ctx.fillStyle = '#3a91a5';
  ctx.fillRect(s * 0.2, s * 0.7, s * 0.035, s * 0.16);
  ctx.fillStyle = '#9a4f78';
  ctx.fillRect(s * 0.76, s * 0.68, s * 0.04, s * 0.18);
}

function fillMesa(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, y);
  ctx.lineTo(x - w * 0.38, y - h);
  ctx.lineTo(x + w * 0.34, y - h);
  ctx.lineTo(x + w * 0.5, y);
  ctx.closePath();
  ctx.fill();
}

function drawSaloon(
  ctx: CanvasRenderingContext2D,
  size: number,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  color: string,
): void {
  const x = nx * size;
  const y = ny * size;
  const w = nw * size;
  const h = nh * size;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - h, w, h);
  ctx.fillStyle = '#c9a15a';
  ctx.fillRect(x - w * 0.06, y - h, w * 1.12, h * 0.12);
  ctx.fillStyle = '#3a2414';
  const windowW = w * 0.16;
  const windowH = h * 0.18;
  ctx.fillRect(x + w * 0.18, y - h * 0.62, windowW, windowH);
  ctx.fillRect(x + w * 0.62, y - h * 0.62, windowW, windowH);
  ctx.fillStyle = '#2a1810';
  ctx.fillRect(x + w * 0.38, y - h * 0.38, w * 0.24, h * 0.38);
}

function drawTower(
  ctx: CanvasRenderingContext2D,
  size: number,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  color: string,
): void {
  const x = nx * size;
  const y = ny * size;
  const w = nw * size;
  const h = nh * size;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - h, w, h);
  ctx.fillStyle = '#d4a06a';
  const cols = 3;
  const rows = 6;
  const cellW = w * 0.16;
  const cellH = h * 0.08;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col + Math.floor(nx * 10)) % 3 === 0) continue;
      ctx.fillRect(
        x + w * 0.14 + col * w * 0.26,
        y - h * 0.88 + row * h * 0.13,
        cellW,
        cellH,
      );
    }
  }
  ctx.fillStyle = '#3a91a5';
  ctx.fillRect(x + w * 0.35, y - h - h * 0.08, w * 0.3, h * 0.08);
}

function drawCactus(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.fillStyle = '#3d6b38';
  ctx.fillRect(x - h * 0.12, y - h, h * 0.24, h);
  ctx.fillRect(x - h * 0.42, y - h * 0.62, h * 0.32, h * 0.14);
  ctx.fillRect(x - h * 0.42, y - h * 0.86, h * 0.14, h * 0.28);
  ctx.fillRect(x + h * 0.1, y - h * 0.5, h * 0.28, h * 0.12);
  ctx.fillRect(x + h * 0.24, y - h * 0.7, h * 0.12, h * 0.24);
}

export interface PortalSwallowInstance {
  root: THREE.Group;
  disc: THREE.Mesh;
  ring: THREE.Mesh;
  discMaterial: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
}

export function createPortalSwallow(): PortalSwallowInstance {
  const root = new THREE.Group();
  const discMaterial = new THREE.MeshBasicMaterial({
    color: 0x45bfff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), discMaterial);
  root.add(disc);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ee7ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 8, 40), ringMaterial);
  ring.position.z = 0.04;
  root.add(ring);
  root.visible = false;
  return { root, disc, ring, discMaterial, ringMaterial };
}

export function updatePortalSwallow(
  instance: PortalSwallowInstance,
  progress: number,
  kind: ModePortalKind,
  radius: number,
): void {
  if (progress >= 1) {
    instance.root.visible = false;
    instance.discMaterial.opacity = 0;
    instance.ringMaterial.opacity = 0;
    return;
  }
  const theme = kind === 'car' ? CAR_THEME : HORSE_THEME;
  const jelly = samplePortalJelly(progress);
  instance.root.visible = true;
  instance.root.rotation.y = Math.PI;
  instance.discMaterial.color.setHex(theme.rim);
  instance.ringMaterial.color.setHex(theme.glow);
  instance.discMaterial.opacity = jelly.flash * 0.72;
  instance.ringMaterial.opacity = jelly.flash * 0.95;
  const discScale = radius * (1 + progress * 0.55);
  instance.disc.scale.set(discScale, discScale, 1 + progress * 10);
  const ringScale = radius * (0.98 + progress * 1.15);
  instance.ring.scale.set(ringScale, ringScale, 1);
  instance.root.position.z = -progress * 1.6;
}
