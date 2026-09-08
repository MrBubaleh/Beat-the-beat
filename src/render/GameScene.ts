import * as THREE from 'three';
import { TutorialArrows } from './TutorialArrows';
import type { TutorialIntent } from '@core/tutorial/TutorialController';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameConfig, LevelgenConfig } from '@core/config/schemas';
import type { GameSnapshot } from '@core/gameplay/GameSim';
import type { ObstacleEntity } from '@core/levelgen/types';
import { MODE_PROFILES } from '@core/modes/types';
import type { PlayerMode, PlayerShape } from '@core/modes/types';
import type { DamageState } from '@core/gameplay/health';
import type { AirState } from '@core/gameplay/air';
import type { RocketPhase } from '@core/gameplay/rocket';
import { easeOutBack, easeOutCubic } from '@core/gameplay/rocket';
import { NITRO_DRY_PULSE_SECONDS } from '@core/gameplay/nitro';
import { levelIntroCameraBlend } from '@core/gameplay/levelIntro';
import {
  clampPresentationOffset,
  createDodgePresentationState,
  createTurnMomentumState,
  pushDodgeImpulses,
  resetDodgePresentation,
  resetTurnMomentum,
  resolvePresentationScale,
  sampleDodgeOffset,
  turnBankScale,
  turnJellyScale,
  turnPullbackZ,
  updateTurnMomentum,
  type DodgePresentationState,
  type TurnMomentumState,
} from '@core/camera/cameraPresentation';
import { createFxSwitches } from '@app/fxSwitches';
import type { FxSwitches } from '@app/fxSwitches';
import {
  createVisualLabSettings,
  FIRST_PERSON_CAMERA_BLEND_SECONDS,
  FIRST_PERSON_CAMERA_FOV,
  FIRST_PERSON_HORSE_EXIT_BLEND_SECONDS,
  FIRST_PERSON_HORSE_OVERDRIVE_CAM_Y,
  FIRST_PERSON_HORSE_OVERDRIVE_DIP_SECONDS,
  FIRST_PERSON_HORSE_OVERDRIVE_FOV_BOOST,
  FIRST_PERSON_HORSE_OVERDRIVE_GAIT_RATE_BOOST,
  FIRST_PERSON_HORSE_BLUE_GAIT_SHAKE_MUL,
  FIRST_PERSON_HORSE_OVERDRIVE_MODEL_PITCH,
  FIRST_PERSON_HORSE_OVERDRIVE_MODEL_Y,
  HORSE_COIN_FRAGMENT_SCALE,
  getCameraPresetOffsets,
  type CameraPresetId,
  type VisualLabSettings,
} from '@app/visualLab';
import {
  createHorizonVideoMesh,
  disposeHorizonVideoMesh,
  HORIZON_VIDEO_CAR_JUMP_Y_BOOST,
  HORIZON_VIDEO_CURVE,
  HORIZON_VIDEO_NITRO_CURVE_BOOST,
  HORIZON_VIDEO_NITRO_DOME_BOOST,
  HORIZON_VIDEO_NITRO_SCALE,
  HORIZON_VIDEO_NITRO_Y_BOOST,
  HORIZON_VIDEO_SPEED_CURVE_BOOST,
  HORIZON_VIDEO_SPEED_DOME_BOOST,
  HORIZON_VIDEO_SPEED_END,
  HORIZON_VIDEO_SPEED_SCALE,
  HORIZON_VIDEO_SPEED_START,
  HORIZON_VIDEO_SPEED_Y_BOOST,
  HORIZON_VIDEO_Y,
} from './horizonVideoMaterial';
import {
  obstacleFootprint,
  obstacleGroundBodyScale,
} from '@core/gameplay/obstacleFootprint';
import { adrenalineBarVisualPercent } from '@ui/adrenalineBarVisual';
import {
  buildObstacleModel,
  createObstacleTintOutline,
  createObstacleModelMaterials,
  disposeObstacleTintOutline,
  MICRO_NITRO_CANISTER_SPIN_RATE,
  MICRO_NITRO_CANISTER_TILT_X,
  MICRO_NITRO_CANISTER_TILT_Z,
  MICRO_NITRO_CANISTER_VISUAL_SCALE,
  resolveObstacleModelDimensions,
  type ObstacleModelInstance,
  type ObstacleTintOutline,
  type ObstacleModelMaterials,
} from './ObstacleModels';
import { resolveObstacleVisual, shouldReverseRoadObstacle } from './obstacleVisualVariants';
import {
  createTrainDetailMaterials,
  createTrainModel,
  layoutTrain,
  paintTrain,
  type TrainDetailMaterials,
  type TrainModelInstance,
} from './TrainModel';
import {
  createCarPortal,
  createHorsePortal,
  createPortalSwallow,
  PORTAL_JELLY_SECONDS,
  samplePortalJelly,
  updateModePortal,
  updatePortalSwallow,
  type ModePortalInstance,
  type ModePortalKind,
  type PortalSwallowInstance,
} from './HorsePortalBonus';
import { createFrontierTownScenery } from './FrontierTownScenery';
import {
  createCityScenery,
  resetCityScenery,
  updateCityScenery,
  type CitySceneryRig,
} from './CityScenery';
import {
  createOrbitalScenery,
  resetOrbitalScenery,
  updateOrbitalScenery,
  type OrbitalSceneryRig,
} from './OrbitalScenery';
import {
  createHorseFirstPersonView,
  updateHorseFirstPersonView,
  type HorseFirstPersonViewRig,
} from './HorseFirstPersonView';
import { resolveEnvironmentGroundTransition } from './environmentGroundTransition';

export interface GameSceneOptions {
  fov: number;
  positionY: number;
  positionZ: number;
  lookY: number;
  positionYFollow: number;
  lookYFollow: number;
}

interface Fragment {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
  opacityScale: number;
  active: boolean;
  vacuum: boolean;
  vacuumHoming: number;
  vacuumAge: number;
}

interface SideDecorMaterials {
  carMetal: THREE.MeshStandardMaterial;
  carDark: THREE.MeshStandardMaterial;
  carSign: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  cactus: THREE.MeshStandardMaterial;
  earth: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
}

interface HorseLegRig {
  hip: THREE.Group;
  knee: THREE.Group;
  phase: number;
  front: boolean;
}

interface HorseModelRig {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  legs: HorseLegRig[];
}

interface CloudLayerItem {
  group: THREE.Group;
  speedScale: number;
  span: number;
  screenYOffset: number;
}

const DASH_COUNT = 8;
const DASH_SPACING = 6;
const DASH_SPAN = DASH_COUNT * DASH_SPACING;
const ROCKET_RAIL_DASH_COUNT = 10;
const ROCKET_RAIL_DASH_SPACING = 5;
const ROCKET_RAIL_DASH_SPAN = ROCKET_RAIL_DASH_COUNT * ROCKET_RAIL_DASH_SPACING;
const CRUMBLE_DURATION = 0.4;
const CRUMBLE_TILT = 0.7;
const SHAKE_STRENGTH = 0.12;
const SHAKE_DECAY = 8;
const HEAL_DECAY = 2;
const OBJ_BASE_EMISSIVE = 1;
const EDGE_GLOW_MAX = 0.8;
const COMBO_EDGE_GLOW = 0.5;
const BLUR_ACTIVATION = 0.12;
const FRAGMENT_COUNT = 120;
const FRAGMENT_GRAVITY = 14;
const FRAGMENT_MIN = 8;
const FRAGMENT_SMASH_POWER = 3;
const GREEN_SMASH_FRAGMENT_SCALE_MUL = 0.42;
const GREEN_SMASH_FRAGMENT_OPACITY_MUL = 0.66;
const COIN_VISUAL_SCALE = 0.88;
const GREEN_VACUUM_FRAGMENT_SCALE_MIN = 0.22;
const GREEN_VACUUM_FRAGMENT_SCALE_MAX = 0.36;
const VACUUM_BEHIND_Z = -0.12;
const VACUUM_BURST_SECONDS = 0.26;
const VACUUM_HOMING_FALLBACK = 0.44;
const VACUUM_HOMING_RAMP = 0.5;
const VACUUM_LIFE_MIN = 1.7;
const VACUUM_LIFE_MAX = 2.2;
const VACUUM_COLLECT_RADIUS = 0.58;
const LOW_CHUNK_GAP_RATIO = 0.15;
const LOW_CHUNK_SPREAD_RATIO = 0.03;
const LOW_CHUNK_TILT = 0.07;
const LOW_CHUNK_REVEAL_DURATION = 0.38;
const CONTACT_SHADOW_FADE_DISTANCE = 2.6;
const CONTACT_SHADOW_Y_OFFSET = 0.01;
const CONTACT_SHADOW_AO_MAX = 0.52;
const CONTACT_SHADOW_SIZE_SCALE = 1.22;
const FOG_CLASSIC_NEAR = 20;
const FOG_CLASSIC_FAR = 95;
const GROUND_PLANE_WIDTH = 72;
const CAR_SPEED_FOV_NORM = 0.234;
const CAR_SPEED_PULLBACK_Z = 2.125;
const HORSE_JUMP_TURN_BANK = 0.34;
const HORSE_GROUND_TURN_BANK = 0.12;
const LOW_PRESET_NITRO_CAM_Y = 1.15;
const LOW_PRESET_NITRO_LOOK_Y = 0.22;
const LOW_PRESET_HORSE_ACCEL_CAM_Y = 1.1;
const LOW_PRESET_HORSE_ACCEL_LOOK_Y = 0.2;
const LOW_PRESET_ROCKET_CAM_Y = 0.82;
const LOW_PRESET_ROCKET_LOOK_Y = 0.16;
const LOW_PRESET_TRAIN_CAM_Y = 1.15;
const LOW_PRESET_TRAIN_LOOK_Y = 0.22;
const LOW_PRESET_HORSE_BASE_CAM_Y = 0.32;
const LOW_PRESET_HORSE_BASE_LOOK_Y = 0.1;
const LOW_PRESET_SLIDE_CAM_Y = -0.98;
const LOW_PRESET_SLIDE_LOOK_Y = -0.28;
const HORSE_OVERHEAD_ARCH_HEIGHT_MUL = 1.25;
const HORSE_DODGE_TALL_VISUAL_HEIGHT_MUL = 1.25;
const HORSE_OVERHEAD_CLEARANCE_MUL = 1.3;
const JUMP_CAM_LIFT_Y = 0.95;
const JUMP_CAM_LOOK_Y = 0.22;
const JUMP_CAM_HEIGHT_FOLLOW = 0.26;
const JUMP_CAM_HORSE_MUL = 1.48;
const JUMP_CAM_RAMP_LIFT_MUL = 1.54;
const JUMP_CAM_RAMP_HEIGHT_FOLLOW = 0.48;
const JUMP_CAM_ROCKET_MUL = 0.62;
const LOW_PRESET_JUMP_CAM_MUL = 1.28;
const LANDING_CAM_BOUNCE_BASE = 0.1;
const LANDING_CAM_BOUNCE_CAR_MUL = 1.55;
const LANDING_CAM_BOUNCE_CAR_RAMP_MUL = 2.12;
const CAM_X_FOLLOW_RATE = 4.85;
const CAM_X_JELLY_SPRING = 38;
const CAM_X_JELLY_DAMP = 8.4;
const CAM_X_JELLY_SCALE = 0.145;
const SIDE_DECOR_SPACING = 10;
const SIDE_DECOR_COUNT = 12;
const SIDE_DECOR_SPAN = SIDE_DECOR_SPACING * SIDE_DECOR_COUNT;
const SIDE_DECOR_HIDE_DEPTH = 5.5;
const SIDE_DECOR_GUARD_LENGTH = 7.4;
const CLOUD_FAR_SPEED_SCALE = 0.03;
const CLOUD_NEAR_SPEED_SCALE = 0.07;
const CLOUD_FAR_SPAN = 150;
const CLOUD_NEAR_SPAN = 132;
const HORSE_CAMERA_BACK_OFFSET = 0.3;
const FIRST_PERSON_CAR_POSITION = new THREE.Vector3(0, 0.78, -0.12);
const FIRST_PERSON_CAR_LOOK = new THREE.Vector3(0, 0.58, 8.5);

export class GameScene {
  private readonly tutorialArrows = new TutorialArrows();
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly opts: GameSceneOptions;
  private readonly handleResize: () => void;
  private readonly playerMesh: THREE.Mesh;
  private playerHidden = false;
  private readonly playerChargeLight: THREE.PointLight;
  private readonly horseBlasterMesh: THREE.Group;
  private readonly obstacleMeshes = new Map<number, THREE.Group>();
  private readonly obstacleMeshPool: THREE.Group[] = [];
  private readonly frontierTownMeshes = new Map<number, THREE.Group>();
  private readonly coinMeshes: THREE.Mesh[] = [];
  private readonly bonusMeshes: THREE.Mesh[] = [];
  private readonly horsePortalBonuses: ModePortalInstance[] = [];
  private readonly carPortalBonuses: ModePortalInstance[] = [];
  private readonly portalSwallow: PortalSwallowInstance;
  private portalJellyT = -1;
  private portalJellyKind: ModePortalKind = 'horse';
  private portalJellyFlash = 0;
  private readonly rampMeshes: THREE.Group[] = [];
  private readonly trainMeshes: THREE.Group[] = [];
  private readonly dashMeshes: THREE.Mesh[] = [];
  private readonly carSideDecorGroups: THREE.Group[] = [];
  private readonly horseSideDecorGroups: THREE.Group[] = [];
  private readonly cloudLayers: CloudLayerItem[] = [];
  private readonly cityScenery: CitySceneryRig;
  private readonly orbitalScenery: OrbitalSceneryRig;
  private readonly rocketRailDashMeshes: THREE.Mesh[][] = [[], [], [], []];
  private readonly rocketRailMaterial: THREE.MeshBasicMaterial;
  private readonly lanePositions: number[];
  private readonly laneFlow: readonly number[];
  private readonly roadEdge: number;
  private readonly overheadWidth: number;
  private readonly overheadDepth: number;
  private readonly lowObstacleWidth: number;
  private readonly lowObstacleDepth: number;
  private readonly tallObstacleDepth: number;
  private readonly tallHeight: number;
  private readonly lowHeight: number;
  private readonly microHeight: number;
  private readonly microDepthScale: number;
  private readonly obstacleCfg: GameConfig['obstacle'];
  private readonly coinRadius: number;
  private coinHeight: number;
  private readonly playerWidth: number;
  private readonly playerHeight: number;
  private readonly playerDepth: number;
  private readonly rampVisualHeight: number;
  private readonly rampWidth: number;
  private readonly rampDepth: number;
  private readonly trainHeight: number;
  private readonly trainWidth: number;
  private readonly tallMaterial: THREE.MeshStandardMaterial;
  private readonly trainRoofTallMaterial: THREE.MeshStandardMaterial;
  private readonly overheadMaterial: THREE.MeshStandardMaterial;
  private readonly portalMaterial: THREE.MeshStandardMaterial;
  private readonly lowMaterial: THREE.MeshStandardMaterial;
  private readonly nitroLowMaterial: THREE.MeshStandardMaterial;
  private readonly microMaterial: THREE.MeshStandardMaterial;
  private readonly mediumYellowLightMaterial: THREE.MeshStandardMaterial;
  private readonly mediumRedTailLightMaterial: THREE.MeshStandardMaterial;
  private readonly mediumHeadlightOffMaterial: THREE.MeshStandardMaterial;
  private readonly obstacleModelMaterials: ObstacleModelMaterials;
  private readonly coinMaterial: THREE.MeshStandardMaterial;
  private readonly rocketBonusMaterial: THREE.MeshStandardMaterial;
  private readonly rampMaterial: THREE.MeshStandardMaterial;
  private readonly rampMarkerMaterial: THREE.MeshStandardMaterial;
  private readonly trainSideMaterial: THREE.MeshStandardMaterial;
  private readonly trainTopMaterial: THREE.MeshStandardMaterial;
  private readonly trainSideAltMaterial: THREE.MeshStandardMaterial;
  private readonly trainTopAltMaterial: THREE.MeshStandardMaterial;
  private readonly trainDetailMaterials: TrainDetailMaterials;
  private dashMaterial!: THREE.MeshStandardMaterial;
  private groundMaterial!: THREE.MeshStandardMaterial;
  private laneMaterial!: THREE.MeshStandardMaterial;
  private readonly playerMaterial: THREE.MeshStandardMaterial;
  private readonly playerModelRoot: THREE.Group;
  private readonly carModelGroup: THREE.Group;
  private readonly horseModelGroup: THREE.Group;
  private readonly rocketModelGroup: THREE.Group;
  private readonly horseBodyRig: THREE.Group;
  private readonly horseHeadRig: THREE.Group;
  private readonly firstPersonHorseView: HorseFirstPersonViewRig;
  private readonly horseTailRig: THREE.Group;
  private readonly horseLegRigs: HorseLegRig[] = [];
  private readonly carWheelMeshes: THREE.Mesh[] = [];
  private readonly carFrontWheelMeshes: THREE.Mesh[] = [];
  private readonly carHeadlightMaterial: THREE.MeshStandardMaterial;
  private readonly carTaillightMaterial: THREE.MeshStandardMaterial;
  private readonly carHeadlightLights: THREE.PointLight[] = [];
  private readonly firstPersonSteeringWheel: THREE.Group;
  private readonly firstPersonSteeringWheelMaterial: THREE.MeshStandardMaterial;
  private readonly rocketSmokeMeshes: THREE.Mesh[] = [];
  private readonly rocketSmokeMaterial: THREE.MeshBasicMaterial;
  private readonly horseSlideDustMeshes: THREE.Mesh[] = [];
  private readonly horseSlideDustMaterial: THREE.MeshBasicMaterial;
  private readonly farCloudMaterial: THREE.MeshBasicMaterial;
  private readonly nearCloudMaterial: THREE.MeshBasicMaterial;
  private readonly horseBlasterMaterial: THREE.MeshStandardMaterial;
  private readonly slideMarkerMaterial: THREE.MeshStandardMaterial;
  private readonly slideMarkerPortalMaterial: THREE.MeshStandardMaterial;
  private readonly jumpMarkerMaterial: THREE.MeshStandardMaterial;
  private readonly background = new THREE.Color(0x0c0c14);
  private readonly bgBase = new THREE.Color(0x0c0c14);
  private readonly bgGlow = new THREE.Color(0x3a2a5e);
  private readonly bgHorseBase = new THREE.Color(0x21160b);
  private readonly bgHorseGlow = new THREE.Color(0x765124);
  private readonly bgRocketBase = new THREE.Color(0x100818);
  private readonly bgRocketGlow = new THREE.Color(0x3d1f62);
  private readonly horseBackground = new THREE.Color();
  private readonly rocketBackground = new THREE.Color();
  private readonly ambientCarColor = new THREE.Color(0x5566aa);
  private readonly ambientHorseColor = new THREE.Color(0xffbd68);
  private readonly ambientRocketColor = new THREE.Color(0x7a4bbf);
  private readonly groundCarColor = new THREE.Color(0x1a1a22);
  private readonly groundHorseColor = new THREE.Color(0x332516);
  private readonly groundRocketColor = new THREE.Color(0x160f22);
  private readonly groundUnderRocketDim = new THREE.Color(0x05040a);
  private readonly laneCarColor = new THREE.Color(0x33333c);
  private readonly laneHorseColor = new THREE.Color(0x6a4a28);
  private readonly laneRocketColor = new THREE.Color(0x2a1f3a);
  private readonly dashCarColor = new THREE.Color(0x2c2c36);
  private readonly dashStressColor = new THREE.Color(0x5c1414);
  private readonly dashHorseColor = new THREE.Color(0x8a6230);
  private readonly dashRocketColor = new THREE.Color(0x241833);
  private readonly dashCarEmissive = new THREE.Color(0x2244aa);
  private readonly dashHorseEmissive = new THREE.Color(0xb86416);
  private readonly dashRocketEmissive = new THREE.Color(0x6a3faa);
  private readonly cloudCarColor = new THREE.Color(0x858792);
  private readonly cloudHorseColor = new THREE.Color(0x9a8068);
  private readonly cloudRocketColor = new THREE.Color(0x776d8a);
  private readonly baseFov: number;
  private readonly fovMax: number;
  private readonly trainFov: number;
  private readonly speedMin: number;
  private readonly speedMax: number;
  private readonly composer: EffectComposer;
  private readonly blurPass: ShaderPass;
  private readonly speedLineMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly speedLineMeshes: THREE.Mesh[] = [];
  private readonly edgeLines: THREE.LineSegments;
  private readonly edgeMaterial: THREE.LineBasicMaterial;
  private readonly playerCrackGroup: THREE.Group;
  private readonly pulseCfg: GameConfig['pulse'];
  private readonly postfxCfg: GameConfig['postfx'];
  private readonly nitroCfg: GameConfig['nitro'];
  private readonly horseCfg: GameConfig['horse'];
  private readonly rocketCfg: GameConfig['rocket'];
  private readonly switches: FxSwitches;
  private readonly visualLab: VisualLabSettings;
  private cameraPresetOffsets = getCameraPresetOffsets('default');
  private firstPersonPresetBlend = 0;
  private horseFpsViewBlend = 0;
  private horseOverdriveBlend = 0;
  private firstPersonMode: PlayerMode = 'car';
  private firstPersonModeTransition = 1;
  private readonly firstPersonFromPositionOffset =
    FIRST_PERSON_CAR_POSITION.clone();
  private readonly firstPersonFromLookOffset = FIRST_PERSON_CAR_LOOK.clone();
  private readonly firstPersonTargetPositionOffset =
    FIRST_PERSON_CAR_POSITION.clone();
  private readonly firstPersonTargetLookOffset = FIRST_PERSON_CAR_LOOK.clone();
  private readonly firstPersonCurrentPositionOffset =
    FIRST_PERSON_CAR_POSITION.clone();
  private readonly firstPersonCurrentLookOffset = FIRST_PERSON_CAR_LOOK.clone();
  private readonly firstPersonCameraPosition = new THREE.Vector3();
  private readonly firstPersonCameraLookAt = new THREE.Vector3();
  private readonly chaseCameraPosition = new THREE.Vector3();
  private readonly chaseCameraLookAt = new THREE.Vector3();
  private readonly blendedCameraLookAt = new THREE.Vector3();
  private firstPersonFromRoll = 0;
  private firstPersonTargetRoll = 0;
  private firstPersonCurrentRoll = 0;
  private readonly contactShadowMaterial: THREE.MeshBasicMaterial;
  private readonly contactShadowMesh: THREE.Mesh;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly baseAmbient = 0.7;
  private readonly playerColor = new THREE.Color(0x44aaff);
  private readonly playerDamagedColor = new THREE.Color(0xffaa44);
  private readonly playerCriticalColor = new THREE.Color(0xff2222);
  private readonly playerEmissiveBase = new THREE.Color(0x0a2a44);
  private readonly playerEmissiveHeal = new THREE.Color(0x33ff88);
  private readonly playerEmissiveNitro = new THREE.Color(0x2fd0ff);
  private readonly playerTrainColor = new THREE.Color(0xe0ffff);
  private readonly playerTrainEmissive = new THREE.Color(0x59ffff);
  private readonly playerHorseColor = new THREE.Color(0xffb347);
  private readonly playerHorseEmissive = new THREE.Color(0x7a3308);
  private readonly playerRocketColor = new THREE.Color(0xb88aff);
  private readonly playerRocketEmissive = new THREE.Color(0x5a2a99);
  private readonly playerBlasterColor = new THREE.Color(0x69eaff);
  private readonly playerBlasterEmissive = new THREE.Color(0x16bfff);
  private readonly tallCarColor = new THREE.Color(0xdd3f52);
  private readonly tallHorseColor = new THREE.Color(0xff5a6b);
  private readonly tallCarEmissive = new THREE.Color(0x441010);
  private readonly tallHorseEmissive = new THREE.Color(0x7a101d);
  private readonly lowHorseColor = new THREE.Color(0xffd45f);
  private readonly lowHorseEmissive = new THREE.Color(0x80500a);
  private readonly overheadCarColor = new THREE.Color(0xf28a2e);
  private readonly overheadHorseColor = new THREE.Color(0xffb452);
  private readonly overheadCarEmissive = new THREE.Color(0x5c2107);
  private readonly overheadHorseEmissive = new THREE.Color(0x8a3d08);
  private readonly destructibleBaseColor = new THREE.Color(0xdd3f52);
  private readonly destructibleNitroColor = new THREE.Color(0x55d98c);
  private readonly destructibleBaseEmissive = new THREE.Color(0x330a0a);
  private readonly destructibleNitroEmissive = new THREE.Color(0x0a3318);
  private readonly edgeBaseColor = new THREE.Color(0x66ccff);
  private readonly edgeNitroColor = new THREE.Color(0x8ffbff);
  private readonly edgeNitroReadyColor = new THREE.Color(0x3fd0ff);
  private prevAirState: AirState = 'grounded';
  private prevAirSource: GameSnapshot['player']['airSource'] = 'none';
  private landingCamBounceT = -1;
  private landingCamBounceAmp = 0;
  private landingPulse = 0;
  private horseLandingSquatT = -1;
  private horseLandingSquatFx = 0;
  private horseLandingSquatScale = 1;
  private horseLandingSquatDuration = 0.4;
  private camX = 0;
  private camXVelocity = 0;
  private camFollowY = 0;
  private time = 0;
  private vfx = 0;
  private pulse = 0;
  private strongPulse = 0;
  private turbo = 0;
  private nitro = 0;
  private trainFx = 0;
  private speedNorm = 0;
  private prevSpeed = 0;
  private fx = 0;
  private comboGlow = 0;
  private readonly comboBadge: THREE.Group;
  private readonly comboCanvas: HTMLCanvasElement;
  private readonly comboTexture: THREE.CanvasTexture;
  private readonly comboMaterial: THREE.MeshBasicMaterial;
  private readonly comboMesh: THREE.Mesh;
  private comboPosX = 0;
  private comboPosY = 1.2;
  private comboPosZ = -2.1;
  private comboVelX = 0;
  private comboVelY = 0;
  private comboVelZ = 0;
  private comboPop = 0;
  private prevComboValue = 0;
  private smoothedKick = 0;
  private musicSceneVig = 0;
  private prevMusicSceneKey = '';
  private prevTurboLevel = 0;
  private beatLaunchPulse = 0;
  private horizonVideoPulseBlend = 0;
  private readonly vigEl: HTMLDivElement;
  private readonly tutorialSlowMoEl: HTMLDivElement;
  private readonly rocketTunnelVigEl: HTMLDivElement;
  private readonly critEl: HTMLDivElement;
  private readonly damagedEl: HTMLDivElement;
  private readonly damageGradeEl: HTMLDivElement;
  private readonly nitroGlowEl: HTMLDivElement;
  private readonly turboSceneVigEl: HTMLDivElement;
  private readonly roadEdgeVeilEl: HTMLDivElement;
  private windPhase = 0;
  private bank = 0;
  private shakeAmp = 0;
  private healFlash = 0;
  private playerHitFlash = 0;
  private nitroReadyOutline = 0;
  private smashVacuumGlow = 0;
  private prevIsHit = false;
  private prevDamageState: DamageState = 'normal';
  private blurActive = false;
  private readonly breaking = new Map<number, number>();
  private readonly chunkReveal = new Map<number, number>();
  private readonly smashVacuumSpawned = new Set<number>();
  private readonly knockbackBurstSpawned = new Set<number>();
  private readonly crushedCoinIds = new Set<number>();
  private readonly fragments: Fragment[] = [];
  private currentShape: PlayerShape | null = null;
  private previousMode: PlayerMode = 'car';
  private modeTransition = 1;
  private horseCameraBlend = 0;
  private horseAirFx = 0;
  private horseRampFallFx = 0;
  private horseJumpTurnBank = 0;
  private horseSpeedFx = 0;
  private horseSlideFx = 0;
  private horseSlideOffsetActive = 0;
  private horseSlideLookOffsetActive = 0;
  private horseSlideBank = 0;
  private jumpCamLiftFx = 0;
  private horseBoostFx = 0;
  private rocketBoostFx = 0;
  private horseGaitPhase = 0;
  private carWheelSpin = 0;
  private carHeadlightNitroBlend = 0;
  private playerTurnBlend = 0;
  private carBodyTurn = 0;
  private carBodyTurnVelocity = 0;
  private readonly turnCfg: GameConfig['camera'];
  private readonly levelIntroCfg: GameConfig['levelIntro'];
  private readonly introCameraStart = new THREE.Vector3();
  private readonly introCameraStartLook = new THREE.Vector3();
  private readonly introCameraSavedPosition = new THREE.Vector3();
  private readonly introCameraSavedLook = new THREE.Vector3();
  private readonly turnMomentumState: TurnMomentumState = createTurnMomentumState();
  private readonly dodgePresentationState: DodgePresentationState =
    createDodgePresentationState();
  private previousPlayerModelX: number | null = null;
  private horseEnvironmentBlend = 0;
  private sideEnvironmentBlend = 0;
  private sideEnvironmentMode: 'car' | 'horse' = 'car';
  private rocketCameraBlend = 0;
  private rocketEnvironmentBlend = 0;
  private rocketBank = 0;
  private rocketAnticipationBlend = 0;
  private rocketTurboBlend = 0;
  private rocketTurboTimer = 0;
  private rocketTunnelVig = 0;
  private rocketLaunchArcBlend = 0;
  private rocketLaunchPhaseProgress = 0;
  private rocketLaunchDipY = 0;
  private rocketLaunchLookY = 0;
  private rocketLaunchPullbackZ = 0;
  private rocketPlateauBounce = 1;
  private prevRocketPhase: RocketPhase = 'none';
  private horizonVideoMesh: THREE.Mesh | null = null;
  private horizonVideoTexture: THREE.VideoTexture | null = null;
  private horizonVideoSource: HTMLVideoElement | null = null;
  private horizonVideoEnabled = false;
  private horizonVideoCarJumpBlend = 0;
  private horizonVideoNitroBlend = 0;
  private horizonVideoSpeedBlend = 0;
  private readonly rampFlightTimeSeconds: number;
  private readonly beatLaunchWindowSeconds: number;

  constructor(
    container: HTMLElement,
    opts: GameSceneOptions,
    game: GameConfig,
    levelgen: LevelgenConfig,
    switches: FxSwitches = createFxSwitches(),
    visualLab: VisualLabSettings = createVisualLabSettings(),
  ) {
    this.opts = opts;
    this.switches = switches;
    this.visualLab = visualLab;
    this.cameraPresetOffsets = getCameraPresetOffsets(this.visualLab.cameraPresetId);
    this.lanePositions = game.lane.positions;
    this.laneFlow = levelgen.laneFlow;
    const laneSpacing = this.lanePositions.length > 1
      ? Math.abs(this.lanePositions[1] - this.lanePositions[0])
      : 1.92;
    this.roadEdge =
      Math.max(...this.lanePositions.map((position) => Math.abs(position))) +
      laneSpacing * 0.5;
    this.overheadWidth = game.obstacle.width;
    this.overheadDepth = game.obstacle.depth;
    this.lowObstacleWidth = game.obstacle.lowWidth;
    this.lowObstacleDepth = game.obstacle.lowDepth;
    this.tallObstacleDepth = game.obstacle.tallDepth;
    this.tallHeight = game.obstacle.tallHeight;
    this.lowHeight = game.obstacle.lowHeight;
    this.microHeight = game.obstacle.microHeight;
    this.microDepthScale = game.obstacle.microDepthScale;
    this.obstacleCfg = game.obstacle;
    this.coinRadius = game.coin.radius;
    this.coinHeight = levelgen.coinHeight;
    this.playerWidth = game.player.width;
    this.playerHeight = game.player.height;
    this.playerDepth = game.player.depth;
    this.rampVisualHeight = Math.min(game.ramp.height * 0.27, 2.15);
    this.rampWidth = game.obstacle.width * 1.2;
    this.rampDepth = game.obstacle.depth;
    this.trainHeight = game.train.height;
    this.trainWidth = game.train.width;
    this.baseFov = opts.fov;
    this.fovMax = game.camera.fovMax;
    this.trainFov = game.train.fov;
    this.speedMin = game.speeds.min;
    this.speedMax = game.speeds.max;
    this.pulseCfg = game.pulse;
    this.postfxCfg = game.postfx;
    this.turnCfg = game.camera;
    this.levelIntroCfg = game.levelIntro;
    this.nitroCfg = game.nitro;
    this.horseCfg = game.horse;
    this.rocketCfg = game.rocket;
    this.rampFlightTimeSeconds = game.ramp.flightTimeSeconds;
    this.beatLaunchWindowSeconds = game.beatLaunch.windowSeconds;
    this.rocketRailMaterial = new THREE.MeshBasicMaterial({
      color: 0x8cb4ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.viewportWidth(), this.viewportHeight());
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.userSelect = 'none';
    container.appendChild(this.renderer.domElement);

    this.vigEl = document.createElement('div');
    this.vigEl.className = 'fx-vignette';
    this.vigEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;';
    this.vigEl.style.setProperty('--vig-inner', `${game.postfx.vigInner * 100}%`);
    container.appendChild(this.vigEl);

    this.tutorialSlowMoEl = document.createElement('div');
    this.tutorialSlowMoEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:6;' +
      'background:radial-gradient(ellipse 88% 74% at 50% 48%, transparent 58%, rgba(46,196,182,0.3) 100%);' +
      'box-shadow:inset 0 0 28px rgba(125,231,255,0.18);opacity:0;';
    container.appendChild(this.tutorialSlowMoEl);

    this.critEl = document.createElement('div');
    this.critEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:4;' +
      'background:radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.6) 100%);' +
      'opacity:0;';
    container.appendChild(this.critEl);

    this.damagedEl = document.createElement('div');
    this.damagedEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:4;' +
      'background:radial-gradient(ellipse at center, transparent 58%, rgba(255,140,40,0.42) 100%);' +
      'opacity:0;';
    container.appendChild(this.damagedEl);

    this.damageGradeEl = document.createElement('div');
    this.damageGradeEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:3;' +
      'background:radial-gradient(ellipse at center, rgba(255,70,40,0.08) 0%, rgba(120,10,5,0.42) 100%);' +
      'mix-blend-mode:multiply;opacity:0;';
    container.appendChild(this.damageGradeEl);

    this.rocketTunnelVigEl = document.createElement('div');
    this.rocketTunnelVigEl.className = 'fx-rocket-tunnel';
    this.rocketTunnelVigEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:6;opacity:0;';
    container.appendChild(this.rocketTunnelVigEl);

    this.nitroGlowEl = document.createElement('div');
    this.nitroGlowEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:5;' +
      'background:radial-gradient(ellipse at center, transparent 52%, rgba(47,208,255,0.55) 100%);' +
      'opacity:0;';
    container.appendChild(this.nitroGlowEl);

    this.turboSceneVigEl = document.createElement('div');
    this.turboSceneVigEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:5;' +
      'background:radial-gradient(ellipse at center, transparent 50%, rgba(55,200,255,0.58) 100%);' +
      'opacity:0;';
    container.appendChild(this.turboSceneVigEl);

    this.roadEdgeVeilEl = document.createElement('div');
    this.roadEdgeVeilEl.className = 'fx-road-veil';
    this.roadEdgeVeilEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0.98;';
    container.appendChild(this.roadEdgeVeilEl);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0c14);
    this.scene.fog = new THREE.Fog(0x0c0c14, 20, 95);

    this.camera = new THREE.PerspectiveCamera(
      opts.fov,
      this.viewportWidth() / this.viewportHeight(),
      0.1,
      300,
    );
    this.scene.add(this.camera, this.tutorialArrows.root);

    this.ambientLight = new THREE.AmbientLight(0x5566aa, this.baseAmbient);
    this.scene.add(this.ambientLight);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 14, 9);
    this.scene.add(sun);

    this.groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a22 });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_PLANE_WIDTH, 400),
      this.groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    this.scene.add(ground);

    this.farCloudMaterial = new THREE.MeshBasicMaterial({
      color: 0x858792,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      fog: true,
    });
    this.nearCloudMaterial = new THREE.MeshBasicMaterial({
      color: 0x92949e,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      fog: true,
    });

    this.addLaneStrips();
    this.addDashes();
    this.addRocketRailDashes();
    this.addSideEnvironmentDecor();
    this.addParallaxClouds();
    this.cityScenery = createCityScenery(this.roadEdge);
    this.orbitalScenery = createOrbitalScenery();
    this.scene.add(this.cityScenery.root, this.orbitalScenery.root);

    this.playerMaterial = new THREE.MeshStandardMaterial({
      color: 0x44aaff,
      emissive: 0x0a2a44,
      metalness: 0.32,
      roughness: 0.42,
    });
    const playerGeom = this.makePlayerGeometry('box');
    const playerCarrierMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.playerMesh = new THREE.Mesh(playerGeom, playerCarrierMaterial);
    this.playerMesh.position.set(0, game.player.height / 2, 0);
    this.scene.add(this.playerMesh);
    this.playerModelRoot = new THREE.Group();
    this.playerMesh.add(this.playerModelRoot);
    const modelDarkMaterial = new THREE.MeshStandardMaterial({
      color: 0x171922,
      roughness: 0.75,
      metalness: 0.22,
    });
    const modelGlassMaterial = new THREE.MeshStandardMaterial({
      color: 0x24384a,
      emissive: 0x07131d,
      emissiveIntensity: 0.35,
      roughness: 0.34,
      metalness: 0.18,
    });
    const modelAccentMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9d4df,
      emissive: 0x244957,
      emissiveIntensity: 0.55,
      roughness: 0.55,
      metalness: 0.3,
    });
    this.carHeadlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xa9dfff,
      emissive: 0x2b8fca,
      emissiveIntensity: 0.45,
      roughness: 0.3,
      metalness: 0.18,
    });
    this.carTaillightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4a58,
      emissive: 0xcc1828,
      emissiveIntensity: 1.15,
      roughness: 0.32,
      metalness: 0.2,
    });
    this.firstPersonSteeringWheelMaterial = new THREE.MeshStandardMaterial({
      color: 0x252a32,
      emissive: 0x071018,
      emissiveIntensity: 0.45,
      metalness: 0.72,
      roughness: 0.34,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.firstPersonSteeringWheel = this.createFirstPersonSteeringWheel();
    this.camera.add(this.firstPersonSteeringWheel);
    this.rocketSmokeMaterial = new THREE.MeshBasicMaterial({
      color: 0xc6cad6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.horseSlideDustMaterial = new THREE.MeshBasicMaterial({
      color: 0x9b7a58,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.carModelGroup = this.createSportCarModel(
      modelDarkMaterial,
      modelGlassMaterial,
      this.carHeadlightMaterial,
      this.carTaillightMaterial,
    );
    const horseRig = this.createHorseModel(modelDarkMaterial);
    this.horseModelGroup = horseRig.group;
    this.horseBodyRig = horseRig.body;
    this.horseHeadRig = horseRig.head;
    this.firstPersonHorseView = createHorseFirstPersonView(
      horseRig.head,
      this.playerMaterial,
      modelDarkMaterial,
    );
    this.camera.add(this.firstPersonHorseView.root);
    this.horseTailRig = horseRig.tail;
    this.horseLegRigs.push(...horseRig.legs);
    this.rocketModelGroup = this.createRocketModel(
      modelDarkMaterial,
      modelAccentMaterial,
    );
    this.playerModelRoot.add(
      this.carModelGroup,
      this.horseModelGroup,
      this.rocketModelGroup,
    );
    const slideDustGeometry = new THREE.SphereGeometry(0.18, 7, 5);
    for (let index = 0; index < 3; index++) {
      const dust = new THREE.Mesh(slideDustGeometry, this.horseSlideDustMaterial);
      dust.visible = false;
      this.horseSlideDustMeshes.push(dust);
      this.playerModelRoot.add(dust);
    }
    this.playerChargeLight = new THREE.PointLight(0x9ffcff, 0, 12, 2);
    this.playerChargeLight.position.set(0, 0.4, 0);
    this.playerMesh.add(this.playerChargeLight);
    this.horseBlasterMaterial = new THREE.MeshStandardMaterial({
      color: 0x56e8ff,
      emissive: 0x176bff,
      emissiveIntensity: 2.4,
      metalness: 0.55,
    });
    this.horseBlasterMesh = this.createHorseBlasterMesh();
    this.horseModelGroup.add(this.horseBlasterMesh);

    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const carBody = this.carModelGroup.userData.body as THREE.Mesh;
    this.edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(carBody.geometry),
      this.edgeMaterial,
    );
    this.edgeLines.position.copy(carBody.position);
    this.carModelGroup.add(this.edgeLines);
    this.playerCrackGroup = this.createPlayerCrackGroup();
    this.playerCrackGroup.position.copy(carBody.position);
    this.carModelGroup.add(this.playerCrackGroup);

    const contactShadowSize =
      Math.max(this.playerWidth, this.playerDepth) * CONTACT_SHADOW_SIZE_SCALE;
    const contactShadowTexture = this.createContactShadowTexture();
    this.contactShadowMaterial = new THREE.MeshBasicMaterial({
      map: contactShadowTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.contactShadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(contactShadowSize, contactShadowSize),
      this.contactShadowMaterial,
    );
    this.contactShadowMesh.rotation.x = -Math.PI / 2;
    this.contactShadowMesh.visible = false;
    this.scene.add(this.contactShadowMesh);

    this.comboCanvas = document.createElement('canvas');
    this.comboCanvas.width = 512;
    this.comboCanvas.height = 160;
    this.comboTexture = new THREE.CanvasTexture(this.comboCanvas);
    this.comboTexture.minFilter = THREE.LinearFilter;
    this.comboMaterial = new THREE.MeshBasicMaterial({
      map: this.comboTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.comboMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.35, 1.15), this.comboMaterial);
    this.comboMesh.rotation.y = Math.PI;
    this.comboBadge = new THREE.Group();
    this.comboBadge.add(this.comboMesh);
    this.comboBadge.visible = false;
    this.scene.add(this.comboBadge);

    this.tallMaterial = new THREE.MeshStandardMaterial({ color: 0xdd3f52, emissive: 0x441010 });
    this.trainRoofTallMaterial = new THREE.MeshStandardMaterial({
      color: 0xdd3f52,
      emissive: 0x441010,
      emissiveIntensity: 0.35,
      roughness: 0.55,
    });
    this.overheadMaterial = new THREE.MeshStandardMaterial({
      color: 0xf28a2e,
      emissive: 0x5c2107,
    });
    this.portalMaterial = new THREE.MeshStandardMaterial({
      color: 0x43e7ff,
      emissive: 0x087fb4,
      emissiveIntensity: 3.5,
      metalness: 0.3,
    });
    this.slideMarkerMaterial = new THREE.MeshStandardMaterial({
      color: 0x7ec8de,
      emissive: 0x1298b8,
      emissiveIntensity: 1.62,
      depthTest: false,
    });
    this.slideMarkerPortalMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8a85a,
      emissive: 0xb05810,
      emissiveIntensity: 1.62,
      depthTest: false,
    });
    this.jumpMarkerMaterial = new THREE.MeshStandardMaterial({
      color: 0x7ec8de,
      emissive: 0x1298b8,
      emissiveIntensity: 1.62,
      depthTest: true,
      depthWrite: true,
    });
    this.lowMaterial = new THREE.MeshStandardMaterial({
      color: 0xdd3f52,
      emissive: 0x441010,
      metalness: 0.35,
    });
    this.nitroLowMaterial = new THREE.MeshStandardMaterial({
      color: 0x55d98c,
      emissive: 0x0f4a26,
    });
    this.microMaterial = new THREE.MeshStandardMaterial({
      color: 0x55ed8f,
      emissive: 0x125d37,
      emissiveIntensity: 1.28,
      metalness: 0.2,
    });
    this.mediumYellowLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdf66,
      emissive: 0xffa818,
      emissiveIntensity: 3.1,
      roughness: 0.38,
    });
    this.mediumRedTailLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff5544,
      emissive: 0xff2018,
      emissiveIntensity: 2.8,
      roughness: 0.42,
    });
    this.mediumHeadlightOffMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a9098,
      emissive: 0x11141a,
      emissiveIntensity: 0.12,
      roughness: 0.45,
      metalness: 0.35,
    });
    this.obstacleModelMaterials = createObstacleModelMaterials();
    this.coinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcc33,
      emissive: 0x664400,
      metalness: 0.6,
    });
    this.rocketBonusMaterial = new THREE.MeshStandardMaterial({
      color: 0xb28cff,
      emissive: 0x4a22aa,
      emissiveIntensity: 3.6,
      metalness: 0.25,
    });
    this.rampMaterial = new THREE.MeshStandardMaterial({
      color: 0x58d8ef,
      emissive: 0x18a8c8,
      emissiveIntensity: 1.85,
      metalness: 0.12,
    });
    this.rampMarkerMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8f5ff,
      emissive: 0x3ecfe8,
      emissiveIntensity: 2.5,
    });
    this.trainSideMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a258f,
      emissive: 0x210b3d,
      metalness: 0.35,
    });
    this.trainTopMaterial = new THREE.MeshStandardMaterial({
      color: 0xb85cff,
      emissive: 0x4b177a,
      metalness: 0.25,
    });
    this.trainSideAltMaterial = new THREE.MeshStandardMaterial({
      color: 0x164f80,
      emissive: 0x071f3d,
      metalness: 0.4,
    });
    this.trainTopAltMaterial = new THREE.MeshStandardMaterial({
      color: 0x39d9ff,
      emissive: 0x0b5577,
      metalness: 0.3,
    });
    this.trainDetailMaterials = createTrainDetailMaterials();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.blurPass = new ShaderPass(buildRadialBlurShader(this.postfxCfg));
    this.composer.addPass(this.blurPass);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.addSpeedLines();
    this.addFragments();
    this.portalSwallow = createPortalSwallow();
    this.scene.add(this.portalSwallow.root);

    this.handleResize = (): void => {
      const w = this.viewportWidth();
      const h = this.viewportHeight();
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    };
    window.addEventListener('resize', this.handleResize);
  }

  update(snapshot: GameSnapshot, dt: number, tutorial: TutorialIntent | null = null): void {
    this.tutorialArrows.update(tutorial, dt);
    this.tutorialSlowMoEl.style.opacity = String((tutorial?.slowMoBlend ?? 0) * 0.48);
    const motionActive = dt > 1e-6;
    if (!motionActive) {
      this.shakeAmp = 0;
      this.camXVelocity = 0;
      this.landingCamBounceT = -1;
      this.landingCamBounceAmp = 0;
    }
    if (!motionActive || snapshot.player.gameOver) {
      resetTurnMomentum(this.turnMomentumState);
      resetDodgePresentation(this.dodgePresentationState);
    }

    if (motionActive && snapshot.salvationFlash > 0) {
      this.shakeAmp = Math.max(this.shakeAmp, SHAKE_STRENGTH * 0.85);
      this.playerHitFlash = Math.max(this.playerHitFlash, snapshot.salvationFlash / 0.55);
    }

    const sceneKey = snapshot.musicScene
      ? `${snapshot.musicScene.kind}:${snapshot.musicScene.reason}`
      : '';
    if (sceneKey && sceneKey !== this.prevMusicSceneKey) {
      this.musicSceneVig = 1;
    }
    this.prevMusicSceneKey = sceneKey;
    if (snapshot.turbo > 0.55 && this.prevTurboLevel <= 0.55) {
      this.musicSceneVig = Math.max(this.musicSceneVig, 0.9);
    }
    this.prevTurboLevel = snapshot.turbo;
    this.musicSceneVig = Math.max(0, this.musicSceneVig - dt / 0.4);

    const beatLaunchWindow = snapshot.player.gameTime < this.beatLaunchWindowSeconds;
    if (
      beatLaunchWindow &&
      snapshot.player.mode === 'car' &&
      snapshot.strongPulse > 0.55
    ) {
      this.beatLaunchPulse = 1;
    }
    this.beatLaunchPulse = Math.max(0, this.beatLaunchPulse - dt * 14);

    this.time += dt;
    const player = snapshot.player;
    if (player.mode !== this.previousMode) {
      if (this.previousMode === 'rocket') {
        this.landingPulse = 1;
        this.shakeAmp = Math.max(this.shakeAmp, SHAKE_STRENGTH);
        this.spawnLandingSparks(player.laneX, player.y);
        this.triggerLandingCamBounce(LANDING_CAM_BOUNCE_BASE * 1.05);
      }
      this.setPlayerShape(MODE_PROFILES[player.mode].playerShape, true);
      this.previousMode = player.mode;
      this.modeTransition = 0;
    }
    this.modeTransition = Math.min(1, this.modeTransition + dt * 4.5);
    if (snapshot.bonusPicked === 'horse' || snapshot.bonusPicked === 'car') {
      this.triggerPortalJelly(player, snapshot.bonusPicked);
    }
    this.updatePortalJelly(dt, player);
    const horseEnvironmentTarget = player.mode === 'horse' ? 1 : 0;
    const environmentStep = dt / this.horseCfg.environmentTransitionSeconds;
    this.horseEnvironmentBlend = horseEnvironmentTarget > this.horseEnvironmentBlend
      ? Math.min(horseEnvironmentTarget, this.horseEnvironmentBlend + environmentStep)
      : Math.max(horseEnvironmentTarget, this.horseEnvironmentBlend - environmentStep);
    if (player.mode === 'car' || player.mode === 'horse') {
      this.sideEnvironmentMode = player.mode;
    }
    const sideEnvironmentTarget = this.sideEnvironmentMode === 'horse' ? 1 : 0;
    this.sideEnvironmentBlend = sideEnvironmentTarget > this.sideEnvironmentBlend
      ? Math.min(sideEnvironmentTarget, this.sideEnvironmentBlend + environmentStep)
      : Math.max(sideEnvironmentTarget, this.sideEnvironmentBlend - environmentStep);
    this.updateSideEnvironmentDecor();
    const horseCameraTarget = player.mode === 'horse' ? 1 : 0;
    this.horseCameraBlend +=
      (horseCameraTarget - this.horseCameraBlend) * (1 - Math.exp(-dt * 6));
    const rocketHyper =
      player.mode === 'rocket' &&
      player.rocketPhase !== 'fall' &&
      player.rocketPhase !== 'anticipation'
        ? player.rocketFx
        : 0;
    const rocketEnvironmentTarget = rocketHyper;
    const rocketEnvironmentStep = dt / this.rocketCfg.environmentTransitionSeconds;
    this.rocketEnvironmentBlend = rocketEnvironmentTarget > this.rocketEnvironmentBlend
      ? Math.min(rocketEnvironmentTarget, this.rocketEnvironmentBlend + rocketEnvironmentStep)
      : Math.max(rocketEnvironmentTarget, this.rocketEnvironmentBlend - rocketEnvironmentStep);
    this.updateParallaxCloudAppearance();
    const rocketCameraTarget =
      player.mode === 'rocket' && player.rocketPhase !== 'fall'
        ? player.rocketPhase === 'anticipation'
          ? smoothstep01(this.rocketAnticipationBlend) * 0.55
          : player.rocketFx
        : 0;
    this.rocketCameraBlend +=
      (rocketCameraTarget - this.rocketCameraBlend) *
      (1 - Math.exp(-dt * this.rocketCfg.cameraBlendRate));
    const horseAirActive =
      player.mode === 'horse' && player.airSource === 'horseJump';
    const horseAirProgress = horseAirActive
      ? clamp01(player.airTime / this.horseCfg.flightTimeSeconds)
      : 0;
    const horseAirApex = player.airState === 'airborne'
      ? Math.sin(Math.PI * horseAirProgress)
      : 0;
    const horseAirTarget = horseAirActive
      ? 0.55 + horseAirApex * 0.45
      : 0;
    const horseAirRate = horseAirTarget > this.horseAirFx
      ? this.horseCfg.airCameraBlendRate
      : this.horseCfg.airCameraBlendRate * 1.25;
    this.horseAirFx +=
      (horseAirTarget - this.horseAirFx) * (1 - Math.exp(-dt * horseAirRate));
    const horseRampFallActive =
      player.mode === 'horse' &&
      player.airSource === 'ramp' &&
      (player.airState === 'airborne' || player.airState === 'landing');
    const rampFallProgress = horseRampFallActive
      ? clamp01(player.airTime / this.rampFlightTimeSeconds)
      : 0;
    const horseRampFallTarget = horseRampFallActive
      ? lerp(0.35, 1, rampFallProgress)
      : 0;
    const horseRampFallRate = horseRampFallTarget > this.horseRampFallFx
      ? this.horseCfg.rampFallCameraBlendRate
      : this.horseCfg.rampFallCameraBlendRate * 1.35;
    this.horseRampFallFx +=
      (horseRampFallTarget - this.horseRampFallFx) *
      (1 - Math.exp(-dt * horseRampFallRate));
    const horseSlideTarget = player.mode === 'horse' && player.isSliding ? 1 : 0;
    this.horseSlideFx +=
      (horseSlideTarget - this.horseSlideFx) *
      (1 - Math.exp(-dt * this.horseCfg.slideCameraBlendRate));
    const horseSlideOffsetTarget =
      horseSlideTarget > 0 ? this.resolveHorseSlideCameraYOffset() : 0;
    const horseSlideLookTarget =
      horseSlideTarget > 0 ? this.resolveHorseSlideCameraLookYOffset() : 0;
    const horseSlideOffsetRate = horseSlideTarget > 0 ? 12 : 8;
    this.horseSlideOffsetActive +=
      (horseSlideOffsetTarget - this.horseSlideOffsetActive) *
      (1 - Math.exp(-dt * horseSlideOffsetRate));
    this.horseSlideLookOffsetActive +=
      (horseSlideLookTarget - this.horseSlideLookOffsetActive) *
      (1 - Math.exp(-dt * horseSlideOffsetRate));
    const slideBankDirection = player.lane < this.lanePositions.length / 2 ? -1 : 1;
    const slideBankTarget =
      this.horseSlideFx * this.horseCfg.slideCameraBank * slideBankDirection;
    this.horseSlideBank +=
      (slideBankTarget - this.horseSlideBank) *
      (1 - Math.exp(-dt * this.horseCfg.slideCameraBlendRate));
    this.horseBoostFx +=
      (player.horseBoostPulse - this.horseBoostFx) * (1 - Math.exp(-dt * 14));
    this.rocketBoostFx = player.rocketBoostPulse;

    if (player.mode === 'rocket' && player.rocketPhase === 'anticipation') {
      this.rocketAnticipationBlend = Math.min(
        1,
        this.rocketAnticipationBlend +
          dt / Math.max(this.rocketCfg.anticipationSeconds, 0.01),
      );
      this.rocketTurboBlend = 0;
      this.rocketTurboTimer = 0;
      this.rocketTunnelVig = smoothstep01(this.rocketAnticipationBlend) * 0.2;
    } else if (
      player.mode === 'rocket' &&
      player.rocketPhase !== 'none' &&
      player.rocketPhase !== 'fall'
    ) {
      if (this.prevRocketPhase === 'anticipation' && player.rocketPhase === 'launch') {
        this.rocketTurboTimer = 0;
        this.landingPulse = 1.15;
        this.shakeAmp = Math.max(this.shakeAmp, SHAKE_STRENGTH * 1.35);
        this.spawnFragments(player.laneX, -0.8, player.y + 0.4, 2.6, 0x8a35ff);
      }
      this.rocketTurboTimer += dt;
      const snapSeconds = Math.max(this.rocketCfg.turboSnapSeconds, 0.01);
      this.rocketTurboBlend = easeOutCubic(Math.min(1, this.rocketTurboTimer / snapSeconds));
      this.rocketAnticipationBlend = Math.max(
        0,
        1 - this.rocketTurboBlend,
      );
      const peakSeconds = this.rocketCfg.turboVignettePeakSeconds;
      const tunnelTarget = this.rocketTurboTimer < peakSeconds
        ? lerp(
            this.rocketCfg.turboVignettePeak,
            this.rocketCfg.turboVignetteSustain,
            this.rocketTurboTimer / peakSeconds,
          )
        : this.rocketCfg.turboVignetteSustain;
      this.rocketTunnelVig +=
        (tunnelTarget - this.rocketTunnelVig) * Math.min(1, dt * 10);
    } else if (player.mode === 'rocket' && player.rocketPhase === 'fall') {
      this.rocketAnticipationBlend = 0;
      this.rocketTurboBlend = 0;
      this.rocketTurboTimer = 0;
      this.rocketTunnelVig = Math.max(0, this.rocketTunnelVig - dt * 18);
    } else {
      this.rocketAnticipationBlend = Math.max(0, this.rocketAnticipationBlend - dt * 10);
      this.rocketTurboBlend = Math.max(0, this.rocketTurboBlend - dt * 8);
      this.rocketTurboTimer = 0;
      this.rocketTunnelVig = Math.max(0, this.rocketTunnelVig - dt * 6);
    }
    if (
      this.prevRocketPhase === 'launch' &&
      player.rocketPhase === 'plateau'
    ) {
      this.rocketPlateauBounce = 0;
    }
    if (player.rocketPhase === 'launch') {
      this.rocketLaunchPhaseProgress = Math.min(
        1,
        this.rocketLaunchPhaseProgress +
          dt / Math.max(this.rocketCfg.launchSeconds, 0.01),
      );
    } else if (player.rocketPhase === 'anticipation') {
      this.rocketLaunchPhaseProgress = 0;
    }
    this.updateRocketLaunchCamera(player, dt);
    this.prevRocketPhase = player.rocketPhase;
    const rocketArcTarget =
      player.mode === 'rocket' &&
      (player.rocketPhase === 'anticipation' || player.rocketPhase === 'launch')
        ? smoothstep01(player.y / Math.max(this.rocketCfg.peakHeight * 0.4, 0.01))
        : 0;
    this.rocketLaunchArcBlend +=
      (rocketArcTarget - this.rocketLaunchArcBlend) * Math.min(1, dt * 9);

    const damageState = player.damageState;
    const hitJustNow = player.isHit && !this.prevIsHit;
    if (hitJustNow) this.shakeAmp = SHAKE_STRENGTH;
    if (
      hitJustNow &&
      player.mode === 'car' &&
      player.damageState !== 'normal'
    ) {
      this.playerHitFlash = 1;
      this.spawnFragments(player.laneX, -0.8, player.y + 0.35, 1.35, 0xff6622);
      this.spawnFragments(player.laneX, -0.8, player.y + 0.55, 0.95, 0xffaa44);
    } else if (hitJustNow && player.mode === 'car') {
      this.playerHitFlash = 0.5;
    }
    if (damageState === 'normal' && this.prevDamageState !== 'normal') this.healFlash = 1;
    this.prevIsHit = player.isHit;
    this.prevDamageState = damageState;

    this.pulse += (snapshot.pulse - this.pulse) * Math.min(1, dt * 7);
    this.strongPulse += (snapshot.strongPulse - this.strongPulse) * Math.min(1, dt * 7);
    this.turbo += (snapshot.turbo - this.turbo) * Math.min(1, dt * 10);
    this.nitro += ((snapshot.player.isAbilityActive ? 1 : 0) - this.nitro) * Math.min(1, dt * 8);
    const horseSpeedTarget = player.mode === 'horse'
      ? player.horseOverdriveRemaining > 0
        ? 1
        : smoothstep01(
            (player.horseMomentum - this.horseCfg.speedFxStartMomentum) /
              Math.max(1e-6, 1 - this.horseCfg.speedFxStartMomentum),
          )
      : 0;
    this.horseSpeedFx +=
      (horseSpeedTarget - this.horseSpeedFx) * (1 - Math.exp(-dt * 7));
    const trainFxTarget = player.airState === 'trainRoof'
      ? 1
      : rocketHyper;
    const trainFxRate = trainFxTarget > this.trainFx
      ? player.mode === 'rocket' ? 11 : 6
      : player.mode === 'rocket' ? 16 : 9;
    this.trainFx +=
      (trainFxTarget - this.trainFx) *
      (1 - Math.exp(-dt * trainFxRate));
    this.comboGlow +=
      (Math.min(1, snapshot.comboMultiplier - 1) - this.comboGlow) * Math.min(1, dt * 3);
    if (this.shakeAmp > 0.0005) this.shakeAmp *= Math.exp(-dt * SHAKE_DECAY);
    if (this.healFlash > 0) this.healFlash = Math.max(0, this.healFlash - dt * HEAL_DECAY);
    if (this.smashVacuumGlow > 0) {
      this.smashVacuumGlow = Math.max(0, this.smashVacuumGlow - dt * 5.5);
    }
    if (this.playerHitFlash > 0) this.playerHitFlash = Math.max(0, this.playerHitFlash - dt * 9);
    this.updateJumpCameraLift(player, dt);
    const adrenalineMode = snapshot.gameplayRules === 'adrenaline';
    const hitFlashBoost = hitJustNow ? 0.22 : player.isHit ? 0.1 : 0;
    const adrenalineVisualPercent = adrenalineMode
      ? adrenalineBarVisualPercent(
          snapshot.adrenalineMax > 0
            ? (player.adrenaline / snapshot.adrenalineMax) * 100
            : 100,
        )
      : 100;
    const adrenalineVisualDamaged =
      adrenalineMode && adrenalineVisualPercent < 50 && adrenalineVisualPercent >= 25;
    const adrenalineVisualCritical = adrenalineMode && adrenalineVisualPercent < 25;
    const damageStress = this.resolvePlayerStress(snapshot);
    if (adrenalineVisualDamaged) {
      this.damagedEl.style.background =
        'radial-gradient(ellipse at center, transparent 48%, rgba(255,45,25,0.62) 100%)';
      this.damagedEl.style.opacity = String(0.48 + hitFlashBoost);
    } else if (!adrenalineMode && damageState === 'damaged') {
      this.damagedEl.style.background =
        'radial-gradient(ellipse at center, transparent 50%, rgba(255,90,35,0.58) 100%)';
      this.damagedEl.style.opacity = String(0.42 + hitFlashBoost);
    } else {
      this.damagedEl.style.opacity = '0';
    }
    this.damageGradeEl.style.opacity = String(
      Math.min(0.72, damageStress * 0.78 + (hitJustNow ? 0.18 : 0)),
    );
    this.critEl.style.opacity =
      adrenalineVisualCritical || (!adrenalineMode && damageState === 'critical')
        ? String(
            (adrenalineMode ? 0.62 : 0.55) +
              (adrenalineMode ? 0.42 : 0.55) * (0.5 + 0.5 * Math.sin(this.time * 10)) +
              (adrenalineMode ? hitFlashBoost : hitFlashBoost * 0.8),
          )
        : '0';

    this.speedNorm = clamp01(
      (player.speed - this.speedMin) / Math.max(1e-6, this.speedMax - this.speedMin),
    );
    const accel = (player.speed - this.prevSpeed) / Math.max(dt, 1e-6);
    this.prevSpeed = player.speed;
    const kick = clamp01(accel / (this.speedMax * 2));
    this.smoothedKick += (kick - this.smoothedKick) * Math.min(1, dt * 5.5);
    const speedAbilityFx = Math.max(
      this.nitro,
      this.horseSpeedFx,
      this.rocketCameraBlend,
      this.rocketBoostFx * 0.95,
    );

    const speedShake = motionActive && this.switches.shake
      ? this.postfxCfg.shakeSpeed *
        (this.speedNorm +
          this.turbo +
          speedAbilityFx * this.postfxCfg.shakeNitroBoost +
          player.horseBoostPulse * 2 +
          this.trainFx * 4 +
          player.skillMomentum * this.postfxCfg.shakeSkillMomentumBoost)
      : 0;
    const shakeX =
      motionActive && this.switches.shake
        ? (Math.random() - 0.5) * this.shakeAmp
        : 0;
    const shakeY =
      motionActive && this.switches.shake
        ? (Math.random() - 0.5) * this.shakeAmp
        : 0;
    const vibX =
      motionActive && this.switches.shake
        ? (Math.random() - 0.5) * speedShake
        : 0;
    const vibY =
      motionActive && this.switches.shake
        ? (Math.random() - 0.5) * speedShake
        : 0;
    const firstPersonPresetBlend = this.updateFirstPersonCameraRig(player, dt);
    const horseFirstPersonBlend = this.computeHorseFirstPersonBlend(
      player,
      firstPersonPresetBlend,
    );
    const presentationFrozen = !motionActive || player.gameOver;
    if (!presentationFrozen) {
      updateTurnMomentum(this.turnMomentumState, player.lane, dt, this.turnCfg);
      if (this.turnCfg.dodgePresentationEnabled) {
        pushDodgeImpulses(this.dodgePresentationState, snapshot.dodgeFx);
      }
    }
    const presentationScale = resolvePresentationScale(
      player.mode,
      horseFirstPersonBlend,
      this.turnCfg,
    );
    const turnMomentum = this.turnMomentumState.momentum;
    const jellyScale = turnJellyScale(
      turnMomentum,
      presentationScale.effect,
      this.turnCfg,
    );
    const bankScale = turnBankScale(
      turnMomentum,
      presentationScale.effect,
      this.turnCfg,
    );
    const dodgeOffset =
      presentationFrozen || !this.turnCfg.dodgePresentationEnabled
        ? { x: 0, y: 0, z: 0 }
        : sampleDodgeOffset(
          this.dodgePresentationState,
          dt,
          this.turnCfg,
          presentationScale.effect,
        );
    const presentation = clampPresentationOffset(
      {
        x: dodgeOffset.x,
        y: dodgeOffset.y,
        z:
          dodgeOffset.z +
          turnPullbackZ(
            turnMomentum,
            presentationScale.pullback,
            this.turnCfg,
          ),
      },
      this.turnCfg,
    );
    const laneDelta = player.laneX - this.camX;
    this.camXVelocity +=
      (laneDelta * CAM_X_JELLY_SPRING * jellyScale -
        this.camXVelocity * CAM_X_JELLY_DAMP) *
      dt;
    this.camX +=
      laneDelta * Math.min(1, dt * CAM_X_FOLLOW_RATE) +
      this.camXVelocity * dt * CAM_X_JELLY_SCALE * jellyScale;
    const rocketVerticalFollowRate =
      player.mode === 'rocket' && player.rocketPhase !== 'fall' ? 15 : 6;
    this.camFollowY +=
      (player.y - this.camFollowY) * Math.min(1, dt * rocketVerticalFollowRate);
    const rocketFlightActive =
      player.mode === 'rocket' && player.rocketPhase !== 'fall';
    const rocketBankTarget =
      rocketFlightActive &&
      player.rocketPhase !== 'anticipation' &&
      player.rocketPhase !== 'launch' &&
      (player.rocketPhase !== 'plateau' || this.rocketPlateauBounce >= 1)
        ? (player.laneX - this.camX) *
          this.rocketCfg.cameraBankAngle *
          this.rocketCfg.launchCameraLaneBankScale *
          this.rocketCameraBlend
        : 0;
    this.rocketBank +=
      (rocketBankTarget - this.rocketBank) *
      Math.min(1, dt * this.rocketCfg.cameraBankBlendRate);
    const bankTarget = rocketFlightActive
      ? 0
      : (player.laneX - this.camX) *
        this.postfxCfg.bankStrength *
        (player.mode === 'car' ? this.turnCfg.carTurnBankScale : this.turnCfg.horseTurnBankScale) *
        2 *
        (1 + speedAbilityFx * this.postfxCfg.bankNitroBoost) *
        bankScale;
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 4);
    const horseAirTurn =
      player.mode === 'horse' &&
      (player.airSource === 'horseJump' || player.airSource === 'ramp') &&
      (player.airState === 'airborne' || player.airState === 'landing');
    const horseTurnBankTarget = horseAirTurn
      ? this.playerTurnBlend * HORSE_JUMP_TURN_BANK * this.turnCfg.horseTurnBankScale * bankScale
      : player.mode === 'horse'
        ? this.playerTurnBlend * HORSE_GROUND_TURN_BANK * this.turnCfg.horseTurnBankScale * bankScale
        : 0;
    const horseTurnBankRate = horseAirTurn ? 11 : 6.5;
    this.horseJumpTurnBank +=
      (horseTurnBankTarget - this.horseJumpTurnBank) *
      (1 - Math.exp(-dt * horseTurnBankRate));
    const airFollowScale =
      1 - this.horseAirFx * this.horseCfg.airCameraFollowSuppression;
    const camPreset = this.cameraPresetOffsets;
    const lowPresetLift = this.usesLowStyleCameraLift(player)
      ? this.computeLowPresetCameraLift(player)
      : { camY: 0, lookY: 0 };
    const jumpLift = this.sampleJumpCameraLift(player);
    const horseLandingSquat = this.sampleHorseLandingSquat(dt);
    const horseSquatCamY =
      horseLandingSquat *
      this.horseCfg.landingSquatCameraY *
      this.horseLandingSquatScale;
    const horseSquatLookY =
      horseLandingSquat *
      this.horseCfg.landingSquatLookY *
      this.horseLandingSquatScale;
    const landingBounce = this.sampleLandingCamBounce(dt);
    const carChaseBlend =
      player.mode === 'car' && horseFirstPersonBlend < 0.02 ? 1 : 0;
    const carSpeedPullback =
      carChaseBlend * this.speedNorm * CAR_SPEED_PULLBACK_Z;
    const greenSmashPullback =
      snapshot.greenSmashFx * (0.28 + snapshot.greenSmashStacks * 0.05);
    this.chaseCameraPosition.set(
      this.camX + shakeX + vibX + presentation.x,
      this.opts.positionY +
        camPreset.positionY +
        lowPresetLift.camY +
        jumpLift.camY +
        shakeY +
        vibY +
        speedAbilityFx * this.nitroCfg.camYOffset +
        this.horseCameraBlend * this.horseCfg.cameraYOffset +
        this.horseAirFx * this.horseCfg.airCameraYOffset +
        this.horseRampFallFx * this.horseCfg.rampFallCameraYOffset +
        this.horseSlideFx * this.horseSlideOffsetActive +
        this.rocketCameraBlend * this.rocketCfg.cameraYOffset +
        this.rocketLaunchDipY +
        landingBounce +
        horseSquatCamY +
        this.camFollowY * this.opts.positionYFollow * airFollowScale +
        presentation.y,
      -(this.opts.positionZ + camPreset.positionZ) -
        carSpeedPullback -
        greenSmashPullback -
        this.horseCameraBlend * HORSE_CAMERA_BACK_OFFSET -
        this.horseAirFx * this.horseCfg.airCameraBackOffset +
        this.horseBoostFx * 0.45 -
        this.rocketCameraBlend * this.rocketCfg.cameraZOffset -
        this.rocketLaunchPullbackZ -
        presentation.z,
    );
    this.chaseCameraLookAt.set(
      player.laneX,
      this.opts.lookY +
        camPreset.lookY +
        lowPresetLift.lookY +
        jumpLift.lookY +
        this.camFollowY * this.opts.lookYFollow * airFollowScale +
        this.horseAirFx * this.horseCfg.airCameraLookBoost -
        this.horseRampFallFx * this.horseCfg.rampFallCameraLookBoost +
        this.horseSlideFx * this.horseSlideLookOffsetActive +
        this.rocketLaunchArcBlend * this.rocketCfg.launchArcCameraLookLift +
        this.rocketLaunchLookY +
        horseSquatLookY +
        player.y * 0.12 * topDownRocketLook(player),
      camPreset.lookZ,
    );
    this.firstPersonCameraPosition.x +=
      (shakeX + vibX) * 1.12 +
      presentation.x +
      (this.camX - player.laneX) * presentationScale.effect;
    this.firstPersonCameraPosition.y +=
      (shakeY + vibY) * 1.12 + landingBounce * 1.28 + presentation.y;
    this.firstPersonCameraPosition.z += -presentation.z;
    this.camera.position.lerpVectors(
      this.chaseCameraPosition,
      this.firstPersonCameraPosition,
      horseFirstPersonBlend,
    );
    this.blendedCameraLookAt.lerpVectors(
      this.chaseCameraLookAt,
      this.firstPersonCameraLookAt,
      horseFirstPersonBlend,
    );
    this.camera.lookAt(this.blendedCameraLookAt);
    if (snapshot.levelIntroActive) {
      const introBlend = levelIntroCameraBlend(snapshot.levelIntroElapsed, this.levelIntroCfg);
      if (introBlend < 0.999) {
        this.introCameraStart.set(
          player.laneX + this.levelIntroCfg.cameraSideX,
          player.y + 0.55 + this.levelIntroCfg.cameraSideY,
          this.levelIntroCfg.cameraSideZ,
        );
        this.introCameraStartLook.set(player.laneX, player.y + 0.45, 6);
        this.introCameraSavedPosition.copy(this.camera.position);
        this.introCameraSavedLook.copy(this.blendedCameraLookAt);
        this.camera.position.lerpVectors(
          this.introCameraStart,
          this.introCameraSavedPosition,
          introBlend,
        );
        this.blendedCameraLookAt.lerpVectors(
          this.introCameraStartLook,
          this.introCameraSavedLook,
          introBlend,
        );
        this.camera.lookAt(this.blendedCameraLookAt);
      }
    }
    const chaseRoll =
      this.bank +
      this.horseSlideBank +
      this.rocketBank +
      this.horseJumpTurnBank;
    this.camera.rotation.z += lerp(
      chaseRoll,
      this.firstPersonCurrentRoll,
      horseFirstPersonBlend,
    );

    this.applyVfx(snapshot, dt, this.smoothedKick);
    this.updateSpeedLines(player.laneX, player.y, player.speed * dt);
    this.updateFragments(
      dt,
      player.laneX,
      player.y + this.playerHeight * 0.45,
      player.speed,
    );
    this.updatePlayerColor(dt, snapshot);
    this.setPlayerShape(MODE_PROFILES[player.mode].playerShape);

    const transitionScale = player.mode === 'rocket' ? 1 : 0.72 + 0.28 * smoothstep01(this.modeTransition);
    const slideHeightScale = lerp(
      1,
      this.horseCfg.slideHeight / this.playerHeight,
      smoothstep01(this.horseSlideFx),
    );
    this.playerMesh.position.set(
      player.laneX,
      player.y + (this.playerHeight * slideHeightScale) / 2,
      0,
    );
    const jelly = this.portalJellyT < 0
      ? { xy: 1, z: 1, flash: 0 }
      : samplePortalJelly(this.portalJellyT / PORTAL_JELLY_SECONDS);
    this.playerMesh.scale.set(
      transitionScale * jelly.xy,
      transitionScale * jelly.xy,
      transitionScale * jelly.z,
    );
    this.updateContactShadow(player);
    this.updatePlayerSpin(player);
    this.updatePlayerModelAnimation(player, dt, motionActive);
    if (motionActive && snapshot.nitroDryPulse > 0 && player.mode === 'car') {
      const dry = Math.min(1, snapshot.nitroDryPulse / NITRO_DRY_PULSE_SECONDS);
      this.playerMesh.position.y -= dry * 0.05;
      this.playerMesh.rotation.z += dry * 0.05 * Math.sin(this.time * 70);
    }
    this.updateFirstPersonPresentation(player);
    this.updateComboBadge(snapshot, dt);
    if (player.airState === 'landing' && this.prevAirState !== 'landing') {
      const horseJumpLanding =
        player.mode === 'horse' && this.prevAirSource === 'horseJump';
      const horseRampLanding =
        player.mode === 'horse' && this.prevAirSource === 'ramp';
      if (horseJumpLanding) {
        this.triggerHorseLandingSquat();
      } else if (horseRampLanding) {
        this.triggerHorseLandingSquat({
          scale: this.horseCfg.landingSquatRampScale,
          duration: this.horseCfg.landingSquatRampSeconds,
        });
      } else {
        this.landingPulse = 1;
        this.shakeAmp = Math.max(this.shakeAmp, SHAKE_STRENGTH * 0.8);
        this.spawnLandingSparks(player.laneX, player.y);
        this.triggerLandingCamBounce(
          this.resolveLandingCamBounceStrength(player, this.prevAirSource),
        );
      }
    }
    this.prevAirState = player.airState;
    this.prevAirSource = player.airSource;
    if (this.landingPulse > 0) this.landingPulse = Math.max(0, this.landingPulse - dt * 3);
    this.playerMesh.visible =
      this.playerHidden
        ? false
        : player.gameOver ||
          !player.isHit ||
          player.rocketPhase === 'launch' ||
          player.rocketPhase === 'anticipation' ||
          Math.floor(this.time * 8) % 2 === 0;

    this.syncFrontierTownScenery(snapshot);
    this.syncObstacles(snapshot);
    this.syncHorseBlaster(snapshot);
    this.syncCoins(snapshot, motionActive);
    const hideGroundCarCoins =
      snapshot.gameplayRules === 'destroy' && snapshot.player.mode === 'car';
    for (const pickup of snapshot.coinPickups) {
      if (hideGroundCarCoins) continue;
      const adrenalineMode = snapshot.gameplayRules === 'adrenaline';
      const adrenalineVisual = adrenalineMode && snapshot.adrenalineMax > 0
        ? adrenalineBarVisualPercent((snapshot.player.adrenaline / snapshot.adrenalineMax) * 100)
        : 100;
      const rocketRescue =
        adrenalineMode &&
        snapshot.player.mode === 'rocket' &&
        adrenalineVisual < 30;
      const coinColor =
        rocketRescue
          ? 0x55f0ff
          : snapshot.player.mode === 'rocket'
            ? 0x66eeff
            : snapshot.player.mode === 'horse'
              ? 0xffb04a
              : 0xffd966;
      this.spawnFragments(
        pickup.x,
        pickup.z,
        pickup.y,
        (rocketRescue ? 1.05 : 0.82) *
          (snapshot.player.mode === 'horse' ? HORSE_COIN_FRAGMENT_SCALE : 1),
        coinColor,
        true,
      );
    }
    this.syncBonuses(snapshot);
    this.syncRamps(snapshot);
    this.syncTrains(snapshot);
    if (!player.gameOver) {
      this.scrollDashes(player.speed * dt);
      this.scrollSideEnvironment(player.speed * dt);
      this.scrollParallaxClouds(player.speed * dt);
      this.scrollRocketRailDashes(snapshot, player.speed * dt);
    }
    const sceneryDt = motionActive && !player.gameOver ? dt : 0;
    const sceneryScrollDistance = player.gameOver ? 0 : player.speed * dt;
    const environmentGroundTransition =
      resolveEnvironmentGroundTransition(this.sideEnvironmentBlend);
    updateCityScenery(this.cityScenery, {
      dt: sceneryDt,
      scrollDistance: sceneryScrollDistance,
      blend: environmentGroundTransition.cityPresence,
    });
    updateOrbitalScenery(this.orbitalScenery, {
      dt: sceneryDt,
      blend: smoothstep01(this.rocketEnvironmentBlend),
      cameraX: this.camera.position.x,
      cameraY: this.camera.position.y,
    });
    this.updateHorizonVideo(snapshot, dt);
  }

  setCameraPreset(id: CameraPresetId): void {
    this.visualLab.cameraPresetId = id;
    this.cameraPresetOffsets = getCameraPresetOffsets(
      id === 'firstPerson' ? 'low' : id,
    );
  }

  setContactShadowEnabled(enabled: boolean): void {
    this.visualLab.contactShadow = enabled;
    if (!enabled) this.contactShadowMesh.visible = false;
  }

  setPlayerHidden(hidden: boolean): void {
    this.playerHidden = hidden;
    if (hidden) {
      this.playerMesh.visible = false;
      this.contactShadowMesh.visible = false;
    }
  }

  setHorizonVideo(video: HTMLVideoElement | null, enabled: boolean): void {
    this.horizonVideoEnabled = enabled && video !== null;
    this.horizonVideoSource = video;
    if (!this.horizonVideoEnabled) {
      if (this.horizonVideoMesh) this.horizonVideoMesh.visible = false;
      return;
    }
    if (
      !this.horizonVideoTexture ||
      this.horizonVideoTexture.image !== video
    ) {
      this.clearHorizonVideo();
      this.horizonVideoTexture = new THREE.VideoTexture(video!);
      this.horizonVideoTexture.colorSpace = THREE.SRGBColorSpace;
      this.horizonVideoTexture.minFilter = THREE.LinearFilter;
      this.horizonVideoTexture.magFilter = THREE.LinearFilter;
      this.horizonVideoMesh = createHorizonVideoMesh(this.horizonVideoTexture);
      this.scene.add(this.horizonVideoMesh);
    }
    if (this.horizonVideoMesh) this.horizonVideoMesh.visible = true;
  }

  private updateHorizonVideo(snapshot: GameSnapshot, dt: number): void {
    const player = snapshot.player;
    if (!this.horizonVideoEnabled || !this.horizonVideoTexture || !this.horizonVideoMesh) {
      return;
    }
    const video = this.horizonVideoSource;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    let carJumpTarget = 0;
    if (
      player.mode === 'car' &&
      player.airSource === 'ramp' &&
      player.airState === 'airborne'
    ) {
      const progress = Math.min(1, player.airTime / this.rampFlightTimeSeconds);
      carJumpTarget = Math.sin(progress * Math.PI);
    }
    this.horizonVideoCarJumpBlend +=
      (carJumpTarget - this.horizonVideoCarJumpBlend) * Math.min(1, dt * 14);
    const nitroTarget = Math.max(
      player.mode === 'car' && player.isAbilityActive ? 1 : 0,
      player.mode === 'horse' && player.horseOverdriveRemaining > 0 ? 1 : 0,
      player.mode === 'rocket' &&
        player.rocketPhase !== 'fall' &&
        player.rocketPhase !== 'anticipation' &&
        player.rocketPhase !== 'none'
        ? player.rocketFx
        : 0,
    );
    const nitroRate = nitroTarget > this.horizonVideoNitroBlend ? 9 : 3.2;
    this.horizonVideoNitroBlend +=
      (nitroTarget - this.horizonVideoNitroBlend) * Math.min(1, dt * nitroRate);
    const speedNorm = clamp01(
      (player.speed - this.speedMin) / Math.max(1e-6, this.speedMax - this.speedMin),
    );
    const horseMomentumBoost =
      player.mode === 'horse'
        ? smoothstep01(
            (player.horseMomentum - this.horseCfg.speedFxStartMomentum) /
              Math.max(1e-6, 1 - this.horseCfg.speedFxStartMomentum),
          ) * 0.28
        : 0;
    const speedTarget = Math.min(
      1,
      smoothstep01(
        (speedNorm - HORIZON_VIDEO_SPEED_START) /
          Math.max(1e-6, HORIZON_VIDEO_SPEED_END - HORIZON_VIDEO_SPEED_START),
      ) + horseMomentumBoost,
    );
    this.horizonVideoSpeedBlend +=
      (speedTarget - this.horizonVideoSpeedBlend) * Math.min(1, dt * 3.2);
    const beatKickTarget =
      this.horizonVideoSpeedBlend > 0.35
        ? this.pulse * 0.1 + this.strongPulse * 0.15
        : this.pulse * 0.02;
    this.horizonVideoPulseBlend +=
      (beatKickTarget - this.horizonVideoPulseBlend) * Math.min(1, dt * 4.5);
    const nitro = this.horizonVideoNitroBlend;
    const speedFx = this.horizonVideoSpeedBlend * (1 - nitro * 0.72);
    const idleCoverage = 1 + (1 - this.horizonVideoSpeedBlend) * 0.12;
    const pulseScale = this.horizonVideoSpeedBlend * this.horizonVideoPulseBlend;
    const scale =
      idleCoverage *
      (1 +
        speedFx * (HORIZON_VIDEO_SPEED_SCALE - 1) +
        nitro * (HORIZON_VIDEO_NITRO_SCALE - 1) +
        pulseScale);
    this.horizonVideoTexture.needsUpdate = true;
    this.horizonVideoMesh.visible = true;
    this.horizonVideoMesh.scale.set(scale, scale, 1);
    this.horizonVideoMesh.position.y =
      HORIZON_VIDEO_Y +
      this.horizonVideoCarJumpBlend * HORIZON_VIDEO_CAR_JUMP_Y_BOOST +
      speedFx * HORIZON_VIDEO_SPEED_Y_BOOST +
      nitro * HORIZON_VIDEO_NITRO_Y_BOOST;
    const material = this.horizonVideoMesh.material as THREE.ShaderMaterial;
    material.uniforms.uCurve.value =
      HORIZON_VIDEO_CURVE +
      speedFx * HORIZON_VIDEO_SPEED_CURVE_BOOST +
      nitro * HORIZON_VIDEO_NITRO_CURVE_BOOST;
    material.uniforms.uDome.value =
      speedFx * HORIZON_VIDEO_SPEED_DOME_BOOST +
      nitro * HORIZON_VIDEO_NITRO_DOME_BOOST;
    material.uniforms.uGrade.value = clamp01(
      snapshot.musicBrightness * 0.85 + snapshot.vfxIntensity * 0.12,
    );
  }

  private clearHorizonVideo(): void {
    if (this.horizonVideoMesh) {
      this.scene.remove(this.horizonVideoMesh);
      disposeHorizonVideoMesh(this.horizonVideoMesh);
      this.horizonVideoMesh = null;
    }
    this.horizonVideoCarJumpBlend = 0;
    this.horizonVideoNitroBlend = 0;
    this.horizonVideoSpeedBlend = 0;
    this.horizonVideoPulseBlend = 0;
    this.horizonVideoTexture = null;
  }

  setLevelgen(levelgen: LevelgenConfig): void {
    this.coinHeight = levelgen.coinHeight;
  }

  reset(): void {
    this.tutorialArrows.reset();
    this.breaking.clear();
    this.chunkReveal.clear();
    this.smashVacuumSpawned.clear();
    this.knockbackBurstSpawned.clear();
    for (const fragment of this.fragments) {
      fragment.active = false;
      fragment.mesh.visible = false;
      fragment.material.opacity = 0;
    }
    for (const group of this.rampMeshes) group.visible = false;
    for (const group of this.trainMeshes) group.visible = false;
    for (const portal of this.horsePortalBonuses) portal.root.visible = false;
    for (const portal of this.carPortalBonuses) portal.root.visible = false;
    this.portalJellyT = -1;
    this.portalJellyFlash = 0;
    updatePortalSwallow(this.portalSwallow, 1, 'horse', 1);
    this.prevAirState = 'grounded';
    this.prevAirSource = 'none';
    this.landingPulse = 0;
    this.landingCamBounceT = -1;
    this.landingCamBounceAmp = 0;
    this.horseLandingSquatT = -1;
    this.horseLandingSquatFx = 0;
    this.horseLandingSquatScale = 1;
    this.horseLandingSquatDuration = this.horseCfg.landingSquatSeconds;
    this.camX = 0;
    this.camXVelocity = 0;
    resetTurnMomentum(this.turnMomentumState);
    resetDodgePresentation(this.dodgePresentationState);
    this.playerMesh.rotation.z = 0;
    this.pulse = 0;
    this.strongPulse = 0;
    this.turbo = 0;
    this.nitro = 0;
    this.trainFx = 0;
    this.currentShape = null;
    this.previousMode = 'car';
    this.modeTransition = 1;
    this.firstPersonPresetBlend =
      this.visualLab.cameraPresetId === 'firstPerson' ? 1 : 0;
    this.firstPersonMode = 'car';
    this.firstPersonModeTransition = 1;
    this.firstPersonFromPositionOffset.copy(FIRST_PERSON_CAR_POSITION);
    this.firstPersonFromLookOffset.copy(FIRST_PERSON_CAR_LOOK);
    this.firstPersonTargetPositionOffset.copy(FIRST_PERSON_CAR_POSITION);
    this.firstPersonTargetLookOffset.copy(FIRST_PERSON_CAR_LOOK);
    this.firstPersonCurrentPositionOffset.copy(FIRST_PERSON_CAR_POSITION);
    this.firstPersonCurrentLookOffset.copy(FIRST_PERSON_CAR_LOOK);
    this.firstPersonFromRoll = 0;
    this.firstPersonTargetRoll = 0;
    this.firstPersonCurrentRoll = 0;
    this.horseFpsViewBlend = 0;
    this.horseOverdriveBlend = 0;
    this.horseCameraBlend = 0;
    this.horseAirFx = 0;
    this.horseRampFallFx = 0;
    this.horseJumpTurnBank = 0;
    this.horseSpeedFx = 0;
    this.horseSlideFx = 0;
    this.horseSlideOffsetActive = 0;
    this.horseSlideLookOffsetActive = 0;
    this.horseSlideBank = 0;
    this.jumpCamLiftFx = 0;
    this.horseBoostFx = 0;
    this.rocketBoostFx = 0;
    this.horseGaitPhase = 0;
    this.carWheelSpin = 0;
    this.playerTurnBlend = 0;
    this.carBodyTurn = 0;
    this.carBodyTurnVelocity = 0;
    this.previousPlayerModelX = null;
    this.horseEnvironmentBlend = 0;
    this.sideEnvironmentBlend = 0;
    this.sideEnvironmentMode = 'car';
    this.updateSideEnvironmentDecor();
    resetCityScenery(this.cityScenery);
    updateCityScenery(this.cityScenery, {
      dt: 0,
      scrollDistance: 0,
      blend: 1,
    });
    this.rocketCameraBlend = 0;
    this.rocketEnvironmentBlend = 0;
    resetOrbitalScenery(this.orbitalScenery);
    this.rocketBank = 0;
    this.rocketAnticipationBlend = 0;
    this.rocketTurboBlend = 0;
    this.rocketTurboTimer = 0;
    this.rocketTunnelVig = 0;
    this.rocketLaunchArcBlend = 0;
    this.rocketLaunchPhaseProgress = 0;
    this.rocketLaunchDipY = 0;
    this.rocketLaunchLookY = 0;
    this.rocketLaunchPullbackZ = 0;
    this.rocketPlateauBounce = 1;
    this.prevRocketPhase = 'none';
    this.horizonVideoCarJumpBlend = 0;
    this.horizonVideoNitroBlend = 0;
    this.horizonVideoSpeedBlend = 0;
    this.horizonVideoPulseBlend = 0;
    for (const rail of this.rocketRailDashMeshes) {
      for (const dash of rail) dash.visible = false;
    }
    this.speedNorm = 0;
    this.prevSpeed = 0;
    this.shakeAmp = 0;
    this.healFlash = 0;
    this.smoothedKick = 0;
    this.horizonVideoPulseBlend = 0;
    this.comboGlow = 0;
    this.comboBadge.visible = false;
    this.comboPop = 0;
    this.prevComboValue = 0;
    this.comboVelX = 0;
    this.musicSceneVig = 0;
    this.prevMusicSceneKey = '';
    this.prevTurboLevel = 0;
    this.beatLaunchPulse = 0;
    this.nitroReadyOutline = 0;
    this.smashVacuumGlow = 0;
    this.playerHitFlash = 0;
    this.prevIsHit = false;
    this.prevDamageState = 'normal';
    this.edgeMaterial.opacity = 0;
    this.vigEl.style.opacity = '0';
    this.tutorialSlowMoEl.style.opacity = '0';
    this.rocketTunnelVigEl.style.opacity = '0';
    this.critEl.style.opacity = '0';
    this.damagedEl.style.opacity = '0';
    this.damageGradeEl.style.opacity = '0';
    this.nitroGlowEl.style.opacity = '0';
    this.turboSceneVigEl.style.opacity = '0';
    this.firstPersonSteeringWheel.visible = false;
    this.firstPersonSteeringWheelMaterial.opacity = 0;
    this.firstPersonHorseView.root.visible = false;
    this.horseHeadRig.visible = true;
    for (const material of this.speedLineMaterials) material.opacity = 0;
    for (const mesh of this.speedLineMeshes) mesh.visible = false;
  }

  private updatePlayerColor(dt: number, snapshot: GameSnapshot): void {
    const player = snapshot.player;
    const damageState = player.damageState;
    const playerStress = this.resolvePlayerStress(snapshot);
    for (const line of this.playerCrackGroup.children) {
      const mat = (line as THREE.Line).material as THREE.LineBasicMaterial;
      mat.opacity = 0.15 + playerStress * 0.75;
    }
    this.playerCrackGroup.visible = playerStress > 0.08;
    this.playerCrackGroup.scale.setScalar(0.92 + playerStress * 0.12);
    const target =
      snapshot.horseBlasterActive
        ? this.playerBlasterColor
        : damageState === 'critical'
        ? this.playerCriticalColor
        : damageState === 'damaged'
          ? this.playerDamagedColor
          : player.mode === 'rocket'
            ? this.playerRocketColor
            : player.mode === 'horse'
              ? this.playerHorseColor
              : this.playerColor;
    const rate = damageState === 'normal' ? 6 : 10;
    this.playerMaterial.color.lerp(target, Math.min(1, dt * rate));
    if (this.playerHitFlash > 0) {
      this.playerMaterial.color.lerp(this.playerCriticalColor, this.playerHitFlash * 0.55);
    }
    if (this.smashVacuumGlow > 0) {
      this.playerMaterial.emissive
        .copy(this.playerEmissiveNitro)
        .multiplyScalar(0.6 + this.smashVacuumGlow * 2.4);
    } else if (player.mode === 'horse' && player.horseOverdriveRemaining > 0) {
      this.playerMaterial.emissive
        .copy(this.playerBlasterEmissive)
        .multiplyScalar(2.8 + this.pulse * 1.4);
    } else if (snapshot.horseBlasterActive) {
      this.playerMaterial.emissive
        .copy(this.playerBlasterEmissive)
        .multiplyScalar(1.3 + this.pulse * 0.7);
    } else if (this.playerHitFlash > 0) {
      this.playerMaterial.emissive
        .copy(this.playerCriticalColor)
        .multiplyScalar(0.35 + this.playerHitFlash * 1.8);
    } else if (this.nitro > 0.05) {
      this.playerMaterial.emissive.copy(this.playerEmissiveNitro).multiplyScalar(0.8 + this.nitro);
    } else if (this.healFlash > 0) {
      this.playerMaterial.emissive
        .copy(this.playerEmissiveHeal)
        .multiplyScalar(0.4 + 0.6 * this.healFlash);
    } else if (player.mode === 'rocket') {
      this.playerMaterial.emissive
        .copy(this.playerRocketEmissive)
        .multiplyScalar(
          0.8 +
            this.rocketCameraBlend * 1.6 +
            player.rocketBoostPulse * 2.4,
        );
    } else if (this.beatLaunchPulse > 0 && player.mode === 'car') {
      this.playerMaterial.emissive
        .copy(this.playerEmissiveNitro)
        .multiplyScalar(0.45 + this.beatLaunchPulse * 2.4);
    } else if (player.mode === 'horse' && player.horseMomentum > 0.01) {
      this.playerMaterial.emissive
        .copy(this.playerHorseEmissive)
        .multiplyScalar(0.5 + player.horseMomentum * 1.5 + this.horseSpeedFx);
    } else {
      this.playerMaterial.emissive.copy(this.playerEmissiveBase);
    }
    const trainBlend = smoothstep01(this.trainFx);
    const chargePulse = 0.5 + 0.5 * Math.sin(this.time * 14);
    this.playerMaterial.color.lerp(this.playerTrainColor, trainBlend);
    this.playerMaterial.emissive.lerp(this.playerTrainEmissive, trainBlend);
    this.playerMaterial.emissiveIntensity +=
      trainBlend * (4.2 + this.pulse * 5 + chargePulse * 2) +
      (snapshot.horseBlasterActive ? 4 + chargePulse * 2 : 0) +
      (player.horseOverdriveRemaining > 0 ? 6 + chargePulse * 4 : 0) +
      this.horseSpeedFx * 1.5 +
      player.horseBoostPulse * 3;
    this.playerChargeLight.intensity =
      trainBlend * (5 + this.pulse * 10 + chargePulse * 4) +
      (snapshot.horseBlasterActive ? 9 + chargePulse * 5 : 0) +
      (player.mode === 'horse'
        ? player.horseMomentum * 4 + player.horseBoostPulse * 8
        : 0);
    this.edgeMaterial.opacity = Math.max(this.edgeMaterial.opacity, trainBlend);
    if (snapshot.horseBlasterActive) {
      this.edgeMaterial.opacity = Math.max(this.edgeMaterial.opacity, 0.9);
      this.edgeMaterial.color.copy(this.playerBlasterColor);
    }
    this.edgeMaterial.color.lerp(this.playerTrainColor, trainBlend);
  }

  private applyVfx(snapshot: GameSnapshot, dt: number, kick: number): void {
    this.vfx += (snapshot.vfxIntensity - this.vfx) * Math.min(1, dt * 3);
    const t = this.vfx;
    const p = this.switches.pulse ? this.pulse : 0;
    const sp = this.switches.pulse ? this.strongPulse : 0;
    const ch = this.pulseCfg.channels;
    const pulseSpeedGate = smoothstep01((this.speedNorm - 0.1) / 0.32);
    const speedAbilityFx = Math.max(
      this.nitro,
      this.horseSpeedFx,
      this.rocketCameraBlend,
      this.rocketBoostFx * 0.95,
    );
    const horseOverdrive = snapshot.player.mode === 'horse' &&
      snapshot.player.horseOverdriveRemaining > 0;

    const fog = this.scene.fog as THREE.Fog;
    if (this.switches.fog) {
      fog.near = lerp(FOG_CLASSIC_NEAR, FOG_CLASSIC_NEAR - 6, t);
      fog.far = lerp(FOG_CLASSIC_FAR, FOG_CLASSIC_FAR - 23, t);
    } else {
      fog.near = FOG_CLASSIC_NEAR;
      fog.far = FOG_CLASSIC_FAR;
    }
    if (this.switches.sky) {
      this.background.copy(this.bgBase).lerp(this.bgGlow, t);
      this.background.offsetHSL(
        (snapshot.musicBrightness - 0.5) * 0.05,
        snapshot.musicBrightness * 0.08,
        (snapshot.musicSilence ? -0.04 * pulseSpeedGate : 0),
      );
      this.background.offsetHSL(0, 0, sp * ch.background * pulseSpeedGate);
      this.horseBackground.copy(this.bgHorseBase).lerp(this.bgHorseGlow, t);
      this.horseBackground.offsetHSL(
        (snapshot.musicBrightness - 0.5) * 0.035,
        snapshot.musicBrightness * 0.06,
        (snapshot.musicSilence ? -0.035 * pulseSpeedGate : 0),
      );
      this.horseBackground.offsetHSL(0, 0, sp * ch.background * pulseSpeedGate);
      this.rocketBackground.copy(this.bgRocketBase).lerp(this.bgRocketGlow, t);
      this.rocketBackground.offsetHSL(
        (snapshot.musicBrightness - 0.5) * 0.04,
        snapshot.musicBrightness * 0.05,
        (snapshot.musicSilence ? -0.03 * pulseSpeedGate : 0),
      );
      this.rocketBackground.offsetHSL(0, 0, sp * ch.background * pulseSpeedGate);
    } else {
      this.background.copy(this.bgBase);
      this.horseBackground.copy(this.bgHorseBase);
      this.rocketBackground.copy(this.bgRocketBase);
    }
    this.background.lerp(this.horseBackground, this.horseEnvironmentBlend);
    this.background.lerp(this.rocketBackground, this.rocketEnvironmentBlend);
    const dashStress = this.resolveDashStress(snapshot);
    const damageStress = Math.max(dashStress, this.resolvePlayerStress(snapshot));
    if (damageStress > 0) {
      this.background.lerp(new THREE.Color(0x3a1010), damageStress * 0.38);
    }
    fog.color.copy(this.background);
    this.scene.background = this.background;
    const edgeR = Math.round(this.background.r * 255);
    const edgeG = Math.round(this.background.g * 255);
    const edgeB = Math.round(this.background.b * 255);
    this.roadEdgeVeilEl.style.setProperty('--edge-r', String(edgeR));
    this.roadEdgeVeilEl.style.setProperty('--edge-g', String(edgeG));
    this.roadEdgeVeilEl.style.setProperty('--edge-b', String(edgeB));

    this.ambientLight.color
      .copy(this.ambientCarColor)
      .lerp(this.ambientHorseColor, this.horseEnvironmentBlend)
      .lerp(this.ambientRocketColor, this.rocketEnvironmentBlend);
    this.groundMaterial.color
      .copy(this.groundCarColor)
      .lerp(this.groundHorseColor, this.horseEnvironmentBlend)
      .lerp(this.groundRocketColor, this.rocketEnvironmentBlend);
    const underRocketDim = this.rocketEnvironmentBlend * 0.58;
    this.groundMaterial.color.lerp(this.groundUnderRocketDim, underRocketDim);
    this.laneMaterial.color
      .copy(this.laneCarColor)
      .lerp(this.laneHorseColor, this.horseEnvironmentBlend)
      .lerp(this.laneRocketColor, this.rocketEnvironmentBlend)
      .lerp(this.groundUnderRocketDim, underRocketDim * 0.72);
    this.dashMaterial.color
      .copy(this.dashCarColor)
      .lerp(this.dashHorseColor, this.horseEnvironmentBlend)
      .lerp(this.dashRocketColor, this.rocketEnvironmentBlend)
      .lerp(this.groundUnderRocketDim, underRocketDim * 0.8);
    if (dashStress > 0) {
      this.dashMaterial.color.lerp(this.dashStressColor, dashStress);
    }
    this.dashMaterial.emissive
      .copy(this.dashCarEmissive)
      .lerp(this.dashHorseEmissive, this.horseEnvironmentBlend)
      .lerp(this.dashRocketEmissive, this.rocketEnvironmentBlend);

    this.ambientLight.intensity =
      this.baseAmbient * (1 + (this.switches.pulse ? p * ch.ambient * pulseSpeedGate : 0));

    const objEm = this.switches.pulse ? p * ch.objectsEmissive : 0;
    this.tallMaterial.color
      .copy(this.tallCarColor)
      .lerp(this.tallHorseColor, this.horseEnvironmentBlend);
    this.tallMaterial.emissive
      .copy(this.tallCarEmissive)
      .lerp(this.tallHorseEmissive, this.horseEnvironmentBlend);
    this.lowMaterial.color
      .copy(this.destructibleBaseColor)
      .lerp(this.lowHorseColor, this.horseEnvironmentBlend);
    this.lowMaterial.emissive
      .copy(this.destructibleBaseEmissive)
      .lerp(this.lowHorseEmissive, this.horseEnvironmentBlend);
    this.overheadMaterial.color
      .copy(this.overheadCarColor)
      .lerp(this.overheadHorseColor, this.horseEnvironmentBlend);
    this.overheadMaterial.emissive
      .copy(this.overheadCarEmissive)
      .lerp(this.overheadHorseEmissive, this.horseEnvironmentBlend);
    this.tallMaterial.emissiveIntensity = OBJ_BASE_EMISSIVE + objEm;
    this.overheadMaterial.emissiveIntensity = OBJ_BASE_EMISSIVE + objEm;
    this.lowMaterial.emissiveIntensity = OBJ_BASE_EMISSIVE + objEm;
    this.nitroLowMaterial.emissiveIntensity = OBJ_BASE_EMISSIVE + objEm;
    const nitroFullForLowTint =
      snapshot.player.mode === 'car' &&
      (snapshot.nitroReady || snapshot.player.nitroCharge >= snapshot.nitroMaxFill * 0.985);
    const nitroLowTint = Math.max(
      snapshot.nitroSmashVisual,
      nitroFullForLowTint && !snapshot.player.isAbilityActive ? 1 : 0,
    );
    this.nitroLowMaterial.color
      .copy(this.destructibleBaseColor)
      .lerp(this.destructibleNitroColor, nitroLowTint);
    this.nitroLowMaterial.emissive
      .copy(this.destructibleBaseEmissive)
      .lerp(this.destructibleNitroEmissive, nitroLowTint);
    this.coinMaterial.emissiveIntensity = OBJ_BASE_EMISSIVE + objEm;
    this.trainSideMaterial.emissiveIntensity = 0.8 + p * 5 + sp * 6;
    this.trainTopMaterial.emissiveIntensity = 1.8 + p * 7 + sp * 10;
    this.trainSideAltMaterial.emissiveIntensity = 0.8 + p * 5 + sp * 6;
    this.trainTopAltMaterial.emissiveIntensity = 1.8 + p * 7 + sp * 10;
    this.trainTopMaterial.color.setRGB(
      0.72 + p * 0.28,
      0.36 + p * 0.55,
      1,
    );
    this.trainTopAltMaterial.color.setRGB(
      0.22 + p * 0.45,
      0.78 + p * 0.22,
      1,
    );
    this.trainDetailMaterials.light.emissiveIntensity = 2.4 + p * 3 + sp * 4;

    const greenSmashHighSpeedFov = smoothstep01((this.speedNorm - 0.62) / 0.28);
    const fovT = this.switches.fov
      ? clamp01(
            t * 0.45 +
              this.turbo * 0.25 +
            speedAbilityFx * 0.55 +
            (horseOverdrive ? 0.16 : 0) +
            this.speedNorm * CAR_SPEED_FOV_NORM +
            snapshot.player.horseMomentum * 0.08 +
            kick * this.postfxCfg.kickStrength +
            snapshot.greenSmashFx *
              this.postfxCfg.greenSmashFovBoost *
              greenSmashHighSpeedFov,
        )
      : 0;
    const rocketAnticipationProgress = smoothstep01(this.rocketAnticipationBlend);
    const rocketTurboFov =
      this.rocketTurboBlend *
      (this.rocketCfg.cameraFovBoost + snapshot.player.rocketBoostPulse * 12);
    const normalFov = Math.min(
      this.fovMax,
      lerp(this.baseFov, this.fovMax, fovT) +
        this.horseAirFx * this.horseCfg.airCameraFovBoost +
        snapshot.player.horseBoostPulse * 5 +
        rocketTurboFov,
    );
    const anticipationFov = Math.max(
      28,
      this.baseFov - this.rocketCfg.anticipationFovDip * rocketAnticipationProgress,
    );
    const rocketFovActive =
      snapshot.player.mode === 'rocket' &&
      snapshot.player.rocketPhase !== 'none' &&
      snapshot.player.rocketPhase !== 'fall';
    const rocketLaunchProgress =
      snapshot.player.rocketPhase === 'launch'
        ? clamp01(
            snapshot.player.y / Math.max(this.rocketCfg.peakHeight, 0.01),
          )
        : snapshot.player.rocketPhase === 'anticipation'
          ? rocketAnticipationProgress
          : 0;
    const climbFov = Math.max(
      28,
      anticipationFov -
        this.rocketCfg.launchCameraFovDip * rocketLaunchProgress,
    );
    const fovBase =
      rocketFovActive &&
      (snapshot.player.rocketPhase === 'anticipation' ||
        snapshot.player.rocketPhase === 'launch')
        ? climbFov
        : rocketFovActive
          ? normalFov
          : normalFov;
    const chaseFov = this.switches.fov
      ? lerp(fovBase, this.trainFov, smoothstep01(this.trainFx))
      : fovBase;
    const fov = lerp(
      chaseFov,
      Math.max(FIRST_PERSON_CAMERA_FOV, chaseFov) +
        this.horseOverdriveBlend * FIRST_PERSON_HORSE_OVERDRIVE_FOV_BOOST,
      this.computeHorseFirstPersonBlend(
        snapshot.player,
        smoothstep01(this.firstPersonPresetBlend),
      ),
    );
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.fx = clamp01(
      this.turbo * 0.5 +
      speedAbilityFx * 0.35 +
      this.vfx * 0.72 +
      this.speedNorm * 0.1 +
      (horseOverdrive ? 0.22 : 0) +
      snapshot.player.horseMomentum * 0.25 +
      snapshot.player.horseBoostPulse * 0.6 +
      snapshot.player.rocketBoostPulse * 0.85 +
      this.trainFx,
    );
    const directorVig = snapshot.vfxIntensity * 0.24 * (0.35 + 0.65 * this.speedNorm);
    this.vigEl.style.opacity = String(
      Math.min(
        0.9,
        (this.switches.vignette ? this.postfxCfg.vigStrength * this.fx : 0) + directorVig,
      ),
    );
    this.rocketTunnelVigEl.style.opacity = String(
      this.switches.vignette ? this.rocketTunnelVig : 0,
    );
    this.nitroGlowEl.style.opacity = String(
      this.switches.vignette
        ? Math.max(
            this.nitro * 0.6,
            this.nitroReadyOutline * 0.62,
            this.horseSpeedFx * 0.78,
            horseOverdrive ? 0.95 : 0,
            this.trainFx * 0.95,
          )
        : 0,
    );
    this.turboSceneVigEl.style.opacity = String(
      this.switches.vignette ? this.musicSceneVig * 0.72 : 0,
    );
    const glow = t * (0.5 + 0.9 * this.speedNorm);
    this.dashMaterial.emissiveIntensity =
      glow + (this.switches.pulse ? p * ch.dashesEmissive : 0);
    this.playerMaterial.emissiveIntensity = 0.3 + glow * 0.9 + this.beatLaunchPulse * 2.8 + snapshot.beatHitPulse * 0.55;

    const blurIntensity = this.switches.blur
      ? this.postfxCfg.blurMax *
        clamp01(this.turbo * 0.7 + this.speedNorm * 0.4 + speedAbilityFx * 0.8 + (horseOverdrive ? 0.2 : 0) + this.portalJellyFlash * 0.55)
      : 0;
    this.blurPass.uniforms.uIntensity.value = blurIntensity;
    this.blurPass.uniforms.uInner.value = this.postfxCfg.blurInner;
    this.blurPass.uniforms.uOuter.value = this.postfxCfg.blurOuter;
    this.blurPass.uniforms.uSpread.value = this.postfxCfg.blurSpread;

    const nitroFullReady =
      snapshot.player.mode === 'car' &&
      !snapshot.player.isAbilityActive &&
      snapshot.player.nitroCharge >= snapshot.nitroMaxFill - 0.25;
    if (nitroFullReady) {
      this.nitroReadyOutline = Math.min(1, this.nitroReadyOutline + dt * 5);
    } else {
      const hold = snapshot.player.isAbilityActive ? 0.2 : 0;
      this.nitroReadyOutline = Math.max(
        hold,
        this.nitroReadyOutline - dt * (snapshot.player.isAbilityActive ? 2.4 : 3.6),
      );
    }
    if (this.nitroReadyOutline > 0.02) {
      this.nitroGlowEl.style.background =
        'radial-gradient(ellipse at center, transparent 50%, rgba(63,208,255,0.48) 100%)';
    } else {
      this.nitroGlowEl.style.background =
        'radial-gradient(ellipse at center, transparent 52%, rgba(47,208,255,0.55) 100%)';
    }

    this.edgeMaterial.opacity =
      EDGE_GLOW_MAX *
      clamp01(
        this.fx +
          this.comboGlow * COMBO_EDGE_GLOW +
          this.landingPulse * 0.8 +
          this.portalJellyFlash * 0.85 +
          this.nitroReadyOutline * 0.95,
      );
    this.edgeMaterial.color
      .copy(this.edgeBaseColor)
      .lerp(this.edgeNitroColor, speedAbilityFx)
      .lerp(this.edgeNitroReadyColor, this.nitroReadyOutline * (1 - this.nitro * 0.7));

    if (blurIntensity > BLUR_ACTIVATION && !this.blurActive) {
      this.blurActive = true;
    } else if (blurIntensity <= BLUR_ACTIVATION && this.blurActive) {
      this.blurActive = false;
    }
  }

  private updateSpeedLines(playerLaneX: number, playerY: number, dz: number): void {
    const windSpeed = this.speedNorm;
    const speedAbilityFx = Math.max(
      this.nitro,
      this.horseSpeedFx,
      this.rocketCameraBlend,
      this.rocketBoostFx * 0.95,
    );
    const gate = this.switches.wind &&
      (windSpeed >= this.postfxCfg.windMinSpeed ||
        speedAbilityFx > 0.25 ||
        this.horseBoostFx > 0 ||
        this.trainFx > 0)
      ? clamp01(this.fx + speedAbilityFx * 0.6 + this.horseBoostFx + this.trainFx)
      : 0;
    this.windPhase =
      (this.windPhase +
        dz *
          (0.5 +
            this.speedNorm +
            speedAbilityFx * 2 +
            this.trainFx * 5 +
            this.horseBoostFx)
      ) %
      (this.postfxCfg.windFadeRange * 2);
    const count = this.speedLineMeshes.length;
    for (let i = 0; i < count; i++) {
      const mesh = this.speedLineMeshes[i];
      const material = this.speedLineMaterials[i];
      const offset = (i / count) * this.postfxCfg.windFadeRange * 2 + this.windPhase;
      const behind = offset % (this.postfxCfg.windFadeRange * 2);
      const fade = Math.max(0, 1 - behind / this.postfxCfg.windFadeRange);
      const variation = 0.7 + (i % 3) * 0.3;
      const length =
        this.postfxCfg.lineMaxLength *
        (0.5 +
          0.5 * this.fx +
          0.3 * speedAbilityFx +
          this.trainFx * 2.5 +
          this.horseBoostFx * 0.35) *
        variation;
      const z = -1.2 - behind;
      const side = i % 2 === 0 ? -1 : 1;
      const spread = this.trainFx > 0 ? 0.7 + (i % 4) * 0.32 : 0.3;
      const y = this.trainFx > 0 ? playerY + 0.2 + (i % 3) * 0.28 : 0.02;
      mesh.position.set(playerLaneX + side * spread, y, z - length / 2);
      mesh.scale.z = length;
      material.opacity = Math.min(
        1,
        this.postfxCfg.lineMaxAlpha *
          (1 + this.trainFx * 1.8) *
          gate *
          fade *
          (0.4 + 0.6 * Math.abs(Math.sin(this.time * 7 + i * 2.1))),
      );
      mesh.visible = gate > 0.03 && material.opacity > 0.01;
    }
  }

  render(): void {
    if (this.blurActive) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  fxDiagnostics(): string {
    const fog = this.scene.fog as THREE.Fog;
    return [
      `vfx ${this.vfx.toFixed(2)}`,
      `fx ${this.fx.toFixed(2)}`,
      `fog ${fog.near.toFixed(0)}/${fog.far.toFixed(0)}`,
      `fogColor #${fog.color.getHexString()}`,
      `bg #${this.background.getHexString()}`,
      `fov ${this.camera.fov.toFixed(0)}`,
      `turbo ${this.turbo.toFixed(2)}`,
      `nitro ${this.nitro.toFixed(2)}`,
    ].join('  ');
  }

  dispose(): void {
    this.tutorialArrows.dispose();
    this.tutorialSlowMoEl.remove();
    window.removeEventListener('resize', this.handleResize);
    this.contactShadowMaterial.map?.dispose();
    this.renderer.dispose();
  }

  private createContactShadowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private resolveSupportTopY(player: GameSnapshot['player']): number | null {
    if (player.airState === 'grounded' || player.airState === 'landing') return 0;
    if (player.airState === 'trainRoof' || player.airState === 'trainExit') {
      return player.y;
    }
    if (player.airState === 'airborne') return 0;
    return null;
  }

  private updateContactShadow(player: GameSnapshot['player']): void {
    if (this.playerHidden || !this.visualLab.contactShadow) {
      this.contactShadowMesh.visible = false;
      return;
    }
    const supportTopY = this.resolveSupportTopY(player);
    if (supportTopY === null) {
      this.contactShadowMesh.visible = false;
      return;
    }
    const heightAboveSupport = Math.max(0, player.y - supportTopY);
    const opacity =
      THREE.MathUtils.clamp(
        1 - heightAboveSupport / CONTACT_SHADOW_FADE_DISTANCE,
        0,
        1,
      ) * CONTACT_SHADOW_AO_MAX;
    this.contactShadowMesh.visible = opacity > 0.01;
    this.contactShadowMesh.position.set(
      player.laneX,
      supportTopY + CONTACT_SHADOW_Y_OFFSET,
      0,
    );
    this.contactShadowMaterial.opacity = opacity;
  }

  private updateFirstPersonCameraRig(
    player: GameSnapshot['player'],
    dt: number,
  ): number {
    const presetTarget =
      this.visualLab.cameraPresetId === 'firstPerson' ? 1 : 0;
    const presetStep = dt / FIRST_PERSON_CAMERA_BLEND_SECONDS;
    this.firstPersonPresetBlend =
      presetTarget > this.firstPersonPresetBlend
        ? Math.min(presetTarget, this.firstPersonPresetBlend + presetStep)
        : Math.max(presetTarget, this.firstPersonPresetBlend - presetStep);

    const modeChanged = player.mode !== this.firstPersonMode;
    const firstPersonVisible =
      presetTarget > 0 || this.firstPersonPresetBlend > 0.001;
    if (modeChanged) {
      this.firstPersonFromPositionOffset.copy(
        this.firstPersonCurrentPositionOffset,
      );
      this.firstPersonFromLookOffset.copy(this.firstPersonCurrentLookOffset);
      this.firstPersonFromRoll = this.firstPersonCurrentRoll;
      this.firstPersonMode = player.mode;
      this.firstPersonModeTransition = firstPersonVisible ? 0 : 1;
    }

    this.updateHorseOverdriveBlend(player, dt);
    this.resolveFirstPersonCameraTarget(player);
    if (modeChanged && player.mode === 'horse' && firstPersonVisible) {
      this.firstPersonFromPositionOffset.copy(
        this.firstPersonTargetPositionOffset,
      );
      this.firstPersonFromLookOffset.copy(this.firstPersonTargetLookOffset);
      this.firstPersonFromRoll = this.firstPersonTargetRoll;
      this.firstPersonCurrentPositionOffset.copy(
        this.firstPersonTargetPositionOffset,
      );
      this.firstPersonCurrentLookOffset.copy(this.firstPersonTargetLookOffset);
      this.firstPersonCurrentRoll = this.firstPersonTargetRoll;
    }
    if (modeChanged && !firstPersonVisible) {
      this.firstPersonFromPositionOffset.copy(
        this.firstPersonTargetPositionOffset,
      );
      this.firstPersonFromLookOffset.copy(this.firstPersonTargetLookOffset);
      this.firstPersonFromRoll = this.firstPersonTargetRoll;
    }
    if (player.mode === 'horse') {
      this.firstPersonModeTransition = Math.min(
        1,
        this.firstPersonModeTransition +
          dt / FIRST_PERSON_CAMERA_BLEND_SECONDS,
      );
      const modeBlend = smoothstep01(this.firstPersonModeTransition);
      this.firstPersonCurrentPositionOffset.lerpVectors(
        this.firstPersonFromPositionOffset,
        this.firstPersonTargetPositionOffset,
        modeBlend,
      );
      this.firstPersonCurrentLookOffset.lerpVectors(
        this.firstPersonFromLookOffset,
        this.firstPersonTargetLookOffset,
        modeBlend,
      );
      this.firstPersonCurrentRoll = lerp(
        this.firstPersonFromRoll,
        this.firstPersonTargetRoll,
        modeBlend,
      );
    }
    if (player.mode === 'horse' || this.horseFpsViewBlend > 0.001) {
      this.firstPersonCameraPosition.set(
        player.laneX + this.firstPersonCurrentPositionOffset.x,
        player.y + this.firstPersonCurrentPositionOffset.y,
        this.firstPersonCurrentPositionOffset.z,
      );
      this.firstPersonCameraLookAt.set(
        player.laneX + this.firstPersonCurrentLookOffset.x,
        player.y + this.firstPersonCurrentLookOffset.y,
        this.firstPersonCurrentLookOffset.z,
      );
    }
    this.updateHorseFpsViewBlend(player, smoothstep01(this.firstPersonPresetBlend), dt);
    return smoothstep01(this.firstPersonPresetBlend);
  }

  private updateHorseFpsViewBlend(
    player: GameSnapshot['player'],
    presetBlend: number,
    dt: number,
  ): void {
    if (this.visualLab.cameraPresetId !== 'firstPerson' || presetBlend <= 0.001) {
      const step = dt / FIRST_PERSON_HORSE_EXIT_BLEND_SECONDS;
      this.horseFpsViewBlend = Math.max(0, this.horseFpsViewBlend - step);
      return;
    }

    const target =
      player.mode === 'horse'
        ? presetBlend * smoothstep01(this.firstPersonModeTransition)
        : 0;
    const blendSeconds =
      target > this.horseFpsViewBlend
        ? FIRST_PERSON_CAMERA_BLEND_SECONDS
        : FIRST_PERSON_HORSE_EXIT_BLEND_SECONDS;
    const step = dt / blendSeconds;
    if (target > this.horseFpsViewBlend) {
      this.horseFpsViewBlend = Math.min(target, this.horseFpsViewBlend + step);
    } else {
      this.horseFpsViewBlend = Math.max(target, this.horseFpsViewBlend - step);
    }
  }

  private computeHorseFirstPersonBlend(
    _player: GameSnapshot['player'],
    _presetBlend: number,
  ): number {
    return smoothstep01(this.horseFpsViewBlend);
  }

  private usesLowStyleCameraLift(player: GameSnapshot['player']): boolean {
    if (this.visualLab.cameraPresetId === 'low') return true;
    return (
      this.visualLab.cameraPresetId === 'firstPerson' && player.mode !== 'horse'
    );
  }

  private updateHorseOverdriveBlend(
    player: GameSnapshot['player'],
    dt: number,
  ): void {
    const target =
      player.mode === 'horse' &&
      player.horseOverdriveRemaining > 0 &&
      !player.isSliding &&
      this.horseSlideFx < 0.04
        ? 1
        : 0;
    const rate = dt / FIRST_PERSON_HORSE_OVERDRIVE_DIP_SECONDS;
    this.horseOverdriveBlend +=
      (target - this.horseOverdriveBlend) * Math.min(1, rate);
  }

  private resolveFirstPersonCameraTarget(
    player: GameSnapshot['player'],
  ): void {
    if (player.mode !== 'horse') return;

    const slide = smoothstep01(this.horseSlideFx);
    const overdriveActive =
      this.visualLab.cameraPresetId === 'firstPerson'
        ? this.horseOverdriveBlend
        : 0;
    const overdriveDipScale = 1 - slide * 0.92;
    const overdriveDipY =
      overdriveActive *
      FIRST_PERSON_HORSE_OVERDRIVE_CAM_Y *
      overdriveDipScale;
    const gaitActive =
      (player.airState === 'grounded' || player.airState === 'trainRoof') &&
      !player.isSliding;
    const gaitBob = gaitActive
      ? Math.sin(this.horseGaitPhase * 2) * lerp(0.05, 0.075, this.speedNorm)
      : 0;
    const gaitSway = gaitActive ? Math.cos(this.horseGaitPhase) * 0.022 : 0;
    this.firstPersonTargetPositionOffset.set(
      gaitSway,
      lerp(1.52, 0.84, slide) +
        gaitBob +
        this.horseAirFx * 0.08 -
        this.horseRampFallFx * this.horseCfg.rampFallCameraLookBoost * 0.2 +
        overdriveDipY,
      lerp(-0.48, -0.3, slide) -
        this.horseRampFallFx * this.horseCfg.rampFallCameraLookBoost * 0.08,
    );
    this.firstPersonTargetLookOffset.set(
      this.playerTurnBlend * 0.16,
      lerp(1.12, 0.64, slide) +
        gaitBob * 0.35 +
        this.horseAirFx * 0.1 -
        this.horseRampFallFx * this.horseCfg.rampFallCameraLookBoost * 0.38 +
        overdriveDipY * 0.55,
      8 -
        this.horseRampFallFx * this.horseCfg.rampFallCameraLookBoost * 0.45,
    );
    this.firstPersonTargetRoll =
      Math.cos(this.horseGaitPhase * 2) * (gaitActive ? 0.028 : 0) -
      this.playerTurnBlend * 0.04 * this.turnCfg.horseTurnBankScale +
      this.horseSlideBank * 0.55 +
      this.horseJumpTurnBank * 0.85;
  }

  private updateFirstPersonPresentation(
    player: GameSnapshot['player'],
  ): void {
    const horseBlend = smoothstep01(this.horseFpsViewBlend);
    this.firstPersonSteeringWheel.visible = false;
    this.firstPersonSteeringWheelMaterial.opacity = 0;
    const showFirstPersonHorseHead =
      player.mode === 'horse' && horseBlend > 0.42;
    const showHorseWorldModel =
      this.currentShape === 'sphere' && !showFirstPersonHorseHead;
    this.horseModelGroup.visible = showHorseWorldModel;
    this.horseHeadRig.visible = showHorseWorldModel;
    this.horseBodyRig.visible = showHorseWorldModel;
    updateHorseFirstPersonView(this.firstPersonHorseView, {
      visible: showFirstPersonHorseHead,
      gaitPhase: this.horseGaitPhase,
      speedNorm: this.speedNorm,
      turnBlend: this.playerTurnBlend,
      slideBlend: this.horseSlideFx,
      slideBank: this.horseSlideBank,
      boostShake: clamp01(
        this.turbo * 0.85 +
          this.horseBoostFx * 0.7 +
          player.horseBoostPulse * 0.55,
      ),
      landingSquat: this.horseLandingSquatFx,
      landingSquatHeadY:
        this.horseCfg.landingSquatHeadY * this.horseLandingSquatScale,
    });
  }

  private computeLowPresetCameraLift(player: GameSnapshot['player']): {
    camY: number;
    lookY: number;
  } {
    let camY = 0;
    let lookY = 0;

    if (player.mode === 'car' && this.nitro > 0.05) {
      camY += this.nitro * LOW_PRESET_NITRO_CAM_Y;
      lookY += this.nitro * LOW_PRESET_NITRO_LOOK_Y;
    }

    if (
      player.mode === 'car' &&
      (player.airState === 'trainRoof' ||
        player.airState === 'trainExit' ||
        this.trainFx > 0.05)
    ) {
      const trainBlend = Math.max(this.trainFx, player.airState === 'trainRoof' ? 1 : 0.75);
      camY += trainBlend * LOW_PRESET_TRAIN_CAM_Y;
      lookY += trainBlend * LOW_PRESET_TRAIN_LOOK_Y;
    }

    if (player.mode === 'horse') {
      const horseBlend = Math.max(this.horseCameraBlend, 0.15);
      camY += horseBlend * LOW_PRESET_HORSE_BASE_CAM_Y;
      lookY += horseBlend * LOW_PRESET_HORSE_BASE_LOOK_Y;
      const horseAccelBlend = Math.max(this.horseSpeedFx, this.horseBoostFx);
      if (horseAccelBlend > 0.05) {
        camY += horseAccelBlend * LOW_PRESET_HORSE_ACCEL_CAM_Y;
        lookY += horseAccelBlend * LOW_PRESET_HORSE_ACCEL_LOOK_Y;
      }
    }

    if (player.mode === 'rocket' && player.rocketPhase !== 'fall') {
      const rocketBlend = Math.max(this.rocketCameraBlend, this.rocketBoostFx * 0.95);
      if (rocketBlend > 0.05) {
        camY += rocketBlend * LOW_PRESET_ROCKET_CAM_Y;
        lookY += rocketBlend * LOW_PRESET_ROCKET_LOOK_Y;
      }
    }

    return { camY, lookY };
  }

  private updateJumpCameraLift(player: GameSnapshot['player'], dt: number): void {
    const target = this.computeJumpCameraLiftTarget(player);
    const rate = target > this.jumpCamLiftFx ? 8.5 : 5.8;
    this.jumpCamLiftFx +=
      (target - this.jumpCamLiftFx) * (1 - Math.exp(-dt * rate));
  }

  private sampleJumpCameraLift(player: GameSnapshot['player']): {
    camY: number;
    lookY: number;
  } {
    if (this.jumpCamLiftFx < 0.01) return { camY: 0, lookY: 0 };
    const presetMul = this.usesLowStyleCameraLift(player)
      ? LOW_PRESET_JUMP_CAM_MUL
      : 1;
    let modeMul = 1;
    let liftY = JUMP_CAM_LIFT_Y;
    let lookY = JUMP_CAM_LOOK_Y;
    let heightFollow = JUMP_CAM_HEIGHT_FOLLOW;
    if (player.mode === 'horse') {
      modeMul = JUMP_CAM_HORSE_MUL;
    } else if (player.mode === 'rocket') {
      modeMul = JUMP_CAM_ROCKET_MUL;
    } else if (player.mode === 'car' && player.airSource === 'ramp') {
      liftY *= JUMP_CAM_RAMP_LIFT_MUL;
      lookY *= 1.18;
      heightFollow = JUMP_CAM_RAMP_HEIGHT_FOLLOW;
    }
    const fx = this.jumpCamLiftFx * presetMul * modeMul;
    return {
      camY: fx * liftY + player.y * fx * heightFollow,
      lookY: fx * lookY,
    };
  }

  private computeJumpCameraLiftTarget(player: GameSnapshot['player']): number {
    if (player.mode === 'car') {
      if (player.airState !== 'airborne' && player.airState !== 'landing') return 0;
      const rampHeightRef =
        player.airSource === 'ramp'
          ? Math.max(this.rampFlightTimeSeconds * 4.8, this.playerHeight * 1.15)
          : this.playerHeight * 1.1;
      return smoothstep01(player.y / Math.max(rampHeightRef, 0.01));
    }
    if (player.mode === 'horse') {
      const heightBlend = smoothstep01(player.y / Math.max(this.playerHeight * 1.1, 0.01));
      const horseJumpBlend =
        player.airState === 'airborne' || player.airState === 'landing'
          ? heightBlend
          : 0;
      return Math.max(horseJumpBlend, this.horseAirFx);
    }
    if (
      player.mode === 'rocket' &&
      player.rocketPhase !== 'fall' &&
      player.rocketPhase !== 'none'
    ) {
      return smoothstep01(player.y / Math.max(this.rocketCfg.peakHeight * 0.52, 0.01));
    }
    return 0;
  }

  private resolveHorseSlideCameraYOffset(): number {
    if (this.visualLab.cameraPresetId === 'low') {
      return LOW_PRESET_SLIDE_CAM_Y;
    }
    return this.horseCfg.slideCameraYOffset;
  }

  private resolveHorseSlideCameraLookYOffset(): number {
    if (this.visualLab.cameraPresetId === 'low') {
      return LOW_PRESET_SLIDE_LOOK_Y;
    }
    return this.horseCfg.slideCameraLookYOffset;
  }

  private resolveLandingCamBounceStrength(
    player: GameSnapshot['player'],
    airSource: GameSnapshot['player']['airSource'],
  ): number {
    if (airSource === 'horseJump') {
      return 0;
    }
    if (player.mode === 'horse' && player.isSliding) return 0;
    if (player.mode === 'car' && airSource === 'ramp') {
      return LANDING_CAM_BOUNCE_BASE * LANDING_CAM_BOUNCE_CAR_RAMP_MUL;
    }
    if (player.mode === 'car') {
      return LANDING_CAM_BOUNCE_BASE * LANDING_CAM_BOUNCE_CAR_MUL;
    }
    if (player.mode === 'rocket' && player.rocketPhase === 'fall') {
      return LANDING_CAM_BOUNCE_BASE * 1.05;
    }
    return LANDING_CAM_BOUNCE_BASE * 0.9;
  }

  private triggerLandingCamBounce(strength: number): void {
    if (strength <= 0) return;
    this.landingCamBounceT = 0;
    this.landingCamBounceAmp = Math.max(this.landingCamBounceAmp, strength);
  }

  private triggerHorseLandingSquat(opts?: {
    scale?: number;
    duration?: number;
  }): void {
    this.horseLandingSquatT = 0;
    this.horseLandingSquatScale = opts?.scale ?? 1;
    this.horseLandingSquatDuration =
      opts?.duration ?? this.horseCfg.landingSquatSeconds;
  }

  private sampleHorseLandingSquat(dt: number): number {
    const duration = this.horseLandingSquatDuration;
    if (this.horseLandingSquatT < 0) {
      this.horseLandingSquatFx = 0;
      return 0;
    }
    this.horseLandingSquatT += dt;
    const progress = clamp01(
      this.horseLandingSquatT / Math.max(duration, 0.01),
    );
    this.horseLandingSquatFx = Math.sin(Math.PI * progress);
    if (progress >= 1) {
      this.horseLandingSquatT = -1;
      this.horseLandingSquatFx = 0;
      return 0;
    }
    return this.horseLandingSquatFx;
  }

  private sampleLandingCamBounce(dt: number): number {
    if (this.landingCamBounceT < 0) return 0;
    this.landingCamBounceT += dt;
    const t = this.landingCamBounceT;
    const bounce =
      -this.landingCamBounceAmp * Math.sin(t * 11.5) * Math.exp(-t * 5.2);
    if (t > 0.5) {
      this.landingCamBounceT = -1;
      this.landingCamBounceAmp = 0;
    }
    return bounce;
  }

  private syncObstacles(snapshot: GameSnapshot): void {
    const ps = 1 + this.pulse * this.pulseCfg.channels.objectsScale;
    const nitroActiveVisual = snapshot.nitroSmashVisual;
    const nitroReadyVisual =
      snapshot.player.mode === 'car' &&
      !snapshot.player.isAbilityActive &&
      (snapshot.nitroReady || snapshot.player.nitroCharge >= snapshot.nitroMaxFill * 0.985)
        ? 1
        : 0;
    const liveIds = new Set<number>();
    for (let i = 0; i < snapshot.obstacles.length; i++) {
      const obstacle = snapshot.obstacles[i];
      liveIds.add(obstacle.id);
      let group = this.obstacleMeshes.get(obstacle.id);
      if (!group) {
        group = this.obstacleMeshPool.pop() ?? this.createObstacleMesh();
        this.obstacleMeshes.set(obstacle.id, group);
      }
      const body = group.userData.body as THREE.Mesh;
      const top = group.userData.top as THREE.Mesh;
      const left = group.userData.left as THREE.Mesh;
      const right = group.userData.right as THREE.Mesh;
      const horseBody = group.userData.horseBody as THREE.Mesh;
      const horseTop = group.userData.horseTop as THREE.Mesh;
      const horseLeft = group.userData.horseLeft as THREE.Mesh;
      const horseRight = group.userData.horseRight as THREE.Mesh;
      const slideMarker = group.userData.slideMarker as THREE.Group;
      const jumpMarker = group.userData.jumpMarker as THREE.Group;
      const trainRoofDodgeMarker = group.userData.trainRoofDodgeMarker as THREE.Group;
      const lowChunks = group.userData.lowChunks as THREE.Mesh[];
      const horseLowChunks = group.userData.horseLowChunks as THREE.Mesh[];
      const detailRoot = group.userData.detailRoot as THREE.Group;
      const chunkCarMaterial = group.userData.chunkCarMaterial as THREE.MeshStandardMaterial;
      const chunkHorseMaterial = group.userData.chunkHorseMaterial as THREE.MeshStandardMaterial;
      const fadeMaterial = group.userData.fadeMaterial as THREE.MeshStandardMaterial;
      const overhead = obstacle.kind === 'overhead';
      const transitionGhost = obstacle.transitionGhost === true;
      const modePortal = obstacle.modePortal === 'car';
      const horseVisualMode =
        (snapshot.player.mode === 'horse' ||
          (snapshot.player.mode === 'rocket' && this.sideEnvironmentMode === 'horse')) &&
        !modePortal &&
        !transitionGhost;
      const showHorseActionMarkers =
        snapshot.player.mode === 'horse' && !transitionGhost;
      const horseObstacle = horseVisualMode;
      const isFirstInActionGroup =
        obstacle.actionIndex === undefined || obstacle.actionIndex === 0;
      const activeSlideGroup =
        overhead &&
        obstacle.actionGroupId !== undefined &&
        obstacle.actionGroupId === snapshot.activeHorseSlideGroupId;
      const behindFade =
        (obstacle.kind === 'tall' || overhead) && obstacle.z < 0;
      const height =
        obstacle.kind === 'micro'
          ? this.microHeight
          : obstacle.kind === 'low'
            ? this.lowHeight
            : horseObstacle && obstacle.horseDodgeOnly
              ? this.tallHeight * HORSE_DODGE_TALL_VISUAL_HEIGHT_MUL
              : this.tallHeight;
      const isTrainRoofObstacle =
        obstacle.trainId !== undefined && obstacle.kind === 'tall';
      const baseMaterial = modePortal
        ? this.portalMaterial
        : obstacle.kind === 'micro'
          ? this.microMaterial
          : obstacle.kind === 'low'
            ? nitroReadyVisual > 0 || nitroActiveVisual > 0
              ? this.nitroLowMaterial
              : this.lowMaterial
            : overhead
              ? this.overheadMaterial
              : isTrainRoofObstacle
                ? this.trainRoofTallMaterial
                : this.tallMaterial;
      let material = baseMaterial;
      const rocketRoadDim = this.rocketEnvironmentBlend * 0.34;
      if (
        rocketRoadDim > 0 &&
        !modePortal &&
        !transitionGhost &&
        !isTrainRoofObstacle
      ) {
        fadeMaterial.color.copy(baseMaterial.color);
        fadeMaterial.emissive.copy(baseMaterial.emissive);
        fadeMaterial.emissiveIntensity = baseMaterial.emissiveIntensity * (1 - rocketRoadDim * 0.55);
        fadeMaterial.opacity = 1 - rocketRoadDim * 0.42;
        fadeMaterial.depthWrite = false;
        material = fadeMaterial;
      } else if (
        !isTrainRoofObstacle &&
        (activeSlideGroup ||
        transitionGhost ||
        behindFade)
      ) {
        const fade = activeSlideGroup || transitionGhost
          ? 1
          : smoothstep01((-obstacle.z - 0.15) / 3);
        fadeMaterial.color.copy(baseMaterial.color);
        fadeMaterial.emissive.copy(baseMaterial.emissive);
        fadeMaterial.emissiveIntensity = baseMaterial.emissiveIntensity;
        fadeMaterial.opacity = transitionGhost
          ? 0.2
          : activeSlideGroup
          ? 0.28
          : lerp(1, 0.18, fade);
        fadeMaterial.depthWrite = false;
        material = fadeMaterial;
      } else if (
        !isTrainRoofObstacle &&
        !obstacle.broken &&
        !obstacle.smashed &&
        (obstacle.kind === 'low' ||
          obstacle.kind === 'tall' ||
          obstacle.kind === 'micro') &&
        obstacle.z >= -1 &&
        obstacle.z <= 26
      ) {
        // Деликатное отделение ближайших важных объектов от фона и тумана:
        // только свой клон материала группы, только ближняя зона, без
        // глобальной экспозиции и без неонового свечения.
        const proximity = 1 - clamp01((obstacle.z + 1) / 27);
        fadeMaterial.color.copy(baseMaterial.color);
        fadeMaterial.emissive.copy(baseMaterial.emissive);
        fadeMaterial.emissiveIntensity =
          baseMaterial.emissiveIntensity * (1 + 0.22 * proximity);
        fadeMaterial.opacity = 1;
        fadeMaterial.depthWrite = true;
        material = fadeMaterial;
      }
      body.material = material;
      top.material = material;
      left.material = material;
      right.material = material;
      horseBody.material = material;
      horseTop.material = material;
      horseLeft.material = material;
      horseRight.material = material;
      for (const chunk of lowChunks) chunk.material = material;
      for (const chunk of horseLowChunks) chunk.material = material;

      const useChunkVisual =
        obstacle.kind === 'low' &&
        !overhead &&
        obstacle.broken &&
        obstacle.penaltyBreak;
      const detailHeight = overhead && horseObstacle
        ? this.tallHeight * HORSE_OVERHEAD_ARCH_HEIGHT_MUL
        : height;
      const footprint = obstacleFootprint(obstacle, this.obstacleCfg);
      const detailClearance = overhead
        ? horseObstacle
          ? this.horseCfg.slideClearanceHeight * HORSE_OVERHEAD_CLEARANCE_MUL
          : this.horseCfg.slideClearanceHeight
        : 0;
      const detailDepth = footprint.depth;
      const mediumHeadlightsLit =
        snapshot.player.mode === 'car' &&
        nitroReadyVisual <= 0 &&
        nitroActiveVisual <= 0;
      const tallCarLights =
        obstacle.kind === 'tall' &&
        !horseObstacle &&
        snapshot.player.mode === 'car';
      const obstacleFrontLightMaterial = tallCarLights
        ? this.mediumRedTailLightMaterial
        : mediumHeadlightsLit
          ? this.mediumYellowLightMaterial
          : this.mediumHeadlightOffMaterial;
      const obstacleRearLightMaterial = tallCarLights
        ? this.mediumRedTailLightMaterial
        : mediumHeadlightsLit
          ? this.mediumRedTailLightMaterial
          : this.mediumHeadlightOffMaterial;
      const detailVisible =
        !useChunkVisual &&
        !obstacle.broken &&
        !transitionGhost &&
        this.syncObstacleDetailModel(
          group,
          obstacle,
          horseObstacle,
          material,
          obstacleFrontLightMaterial,
          obstacleRearLightMaterial,
          {
            width: footprint.width,
            height: detailHeight,
            depth: detailDepth,
            clearance: detailClearance,
          },
          snapshot.player.speed,
          obstacle.kind === 'low' &&
            !horseObstacle &&
            (nitroReadyVisual > 0 || nitroActiveVisual > 0),
        );
      detailRoot.visible = detailVisible;
      if (detailVisible && (activeSlideGroup || behindFade)) {
        const detailModel = group.userData.detailModel as ObstacleModelInstance;
        for (const binding of detailModel.baseMaterials) {
          binding.mesh.material = fadeMaterial;
        }
      }
      if (useChunkVisual) {
        const nitroLowLit = nitroReadyVisual > 0 || nitroActiveVisual > 0;
        const chunkSource =
          obstacle.broken || !nitroLowLit
            ? this.lowMaterial
            : this.nitroLowMaterial;
        const breakStart = this.breaking.get(obstacle.id);
        const penaltyFlash =
          obstacle.broken && obstacle.penaltyBreak && breakStart !== undefined
            ? Math.max(0, 1 - (this.time - breakStart) / 0.22)
            : 0;
        this.applyObstacleChunkMaterials(
          chunkCarMaterial,
          chunkHorseMaterial,
          chunkSource,
          penaltyFlash,
        );
        for (const chunk of lowChunks) chunk.material = chunkCarMaterial;
        for (const chunk of horseLowChunks) chunk.material = chunkHorseMaterial;
        if (!this.chunkReveal.has(obstacle.id)) {
          this.chunkReveal.set(obstacle.id, this.time);
        }
        body.visible = false;
        horseBody.visible = false;
        const centerY = (obstacle.y ?? 0) + height / 2;
        const breakProgress = obstacle.broken
          ? clamp01((this.time - (this.breaking.get(obstacle.id) ?? this.time)) / CRUMBLE_DURATION)
          : 0;
        const revealStart = this.chunkReveal.get(obstacle.id) ?? this.time;
        const revealEase = smoothstep01(
          clamp01((this.time - revealStart) / LOW_CHUNK_REVEAL_DURATION),
        );
        const breakEase = smoothstep01(breakProgress);
        for (let ci = 0; ci < 3; ci++) {
          const carChunk = lowChunks[ci];
          const horseChunk = horseLowChunks[ci];
          carChunk.visible = !horseObstacle;
          horseChunk.visible = horseObstacle;
          this.applyLowChunkPose(
            carChunk,
            ci,
            obstacle.id,
            centerY,
            height,
            revealEase,
            breakEase,
          );
          this.applyLowChunkPose(
            horseChunk,
            ci,
            obstacle.id,
            centerY,
            height,
            revealEase,
            breakEase,
          );
        }
      } else {
        this.chunkReveal.delete(obstacle.id);
        for (const chunk of lowChunks) chunk.visible = false;
        for (const chunk of horseLowChunks) chunk.visible = false;
        body.visible = !overhead && !horseObstacle && !detailVisible;
        horseBody.visible = !overhead && horseObstacle && !detailVisible;
      }
      top.visible = overhead && !horseObstacle && !detailVisible;
      left.visible = overhead && !horseObstacle && !detailVisible;
      right.visible = overhead && !horseObstacle && !detailVisible;
      if (!useChunkVisual) {
        horseBody.visible = !overhead && horseObstacle && !detailVisible;
      }
      horseTop.visible = overhead && horseObstacle && !detailVisible;
      horseLeft.visible = overhead && horseObstacle && !detailVisible;
      horseRight.visible = overhead && horseObstacle && !detailVisible;
      const showSlideMarker =
        showHorseActionMarkers &&
        overhead &&
        isFirstInActionGroup;
      slideMarker.visible = showSlideMarker;
      if (showSlideMarker) {
        const slideMarkerMat = modePortal
          ? this.slideMarkerPortalMaterial
          : this.slideMarkerMaterial;
        for (const child of slideMarker.children) {
          if (child instanceof THREE.Mesh) child.material = slideMarkerMat;
        }
      }
      slideMarker.scale.setScalar(
        modePortal ? 1.35 + 0.18 * (0.5 + 0.5 * Math.sin(this.time * 9)) : 1,
      );
      jumpMarker.visible =
        horseVisualMode && obstacle.kind === 'low' && isFirstInActionGroup;
      trainRoofDodgeMarker.visible = isTrainRoofObstacle;
      if (overhead) {
        const clearance = horseObstacle
          ? this.horseCfg.slideClearanceHeight * HORSE_OVERHEAD_CLEARANCE_MUL
          : this.horseCfg.slideClearanceHeight;
        const archHeight = horseObstacle
          ? this.tallHeight * HORSE_OVERHEAD_ARCH_HEIGHT_MUL
          : this.tallHeight;
        const barHeight = Math.max(0.2, archHeight - clearance);
        top.position.set(0, clearance + barHeight / 2, 0);
        top.scale.set(1, barHeight, 1);
        left.position.set(-this.overheadWidth * 0.43, clearance / 2, 0);
        right.position.set(this.overheadWidth * 0.43, clearance / 2, 0);
        left.scale.set(0.13, clearance, 1);
        right.scale.set(0.13, clearance, 1);
        horseTop.position.copy(top.position);
        horseTop.scale.copy(top.scale);
        horseLeft.position.copy(left.position);
        horseRight.position.copy(right.position);
        horseLeft.scale.copy(left.scale);
        horseRight.scale.copy(right.scale);
        slideMarker.position.set(
          0,
          clearance + barHeight * 0.5,
          -this.overheadDepth / 2 - 0.14,
        );
        slideMarker.renderOrder = 12;
      } else {
        body.position.set(0, (obstacle.y ?? 0) + height / 2, 0);
        const bodyScale = obstacleGroundBodyScale(obstacle, this.obstacleCfg);
        body.scale.set(bodyScale.x, bodyScale.y, bodyScale.z);
        horseBody.position.copy(body.position);
        horseBody.scale.copy(body.scale);
        const markerDepth =
          obstacle.kind === 'tall'
            ? obstacle.zExtent ?? this.tallObstacleDepth
            : obstacle.kind === 'micro'
              ? this.lowObstacleDepth * this.microDepthScale
              : obstacle.zExtent ?? this.lowObstacleDepth;
        jumpMarker.position.set(
          0,
          (obstacle.y ?? 0) + height * 0.55,
          -markerDepth / 2 + 0.05,
        );
        if (isTrainRoofObstacle) {
          trainRoofDodgeMarker.position.set(
            0,
            (obstacle.y ?? 0) + height * 0.55,
            -markerDepth / 2 - 0.14,
          );
          trainRoofDodgeMarker.renderOrder = 12;
        }
      }
      if (obstacle.panicFleeActive) {
        const fleeX = this.lanePositions[obstacle.lane] + (obstacle.xOffset ?? 0);
        group.position.set(fleeX, 0, obstacle.z);
        group.rotation.y = obstacle.panicFleeYaw ?? 0;
        group.rotation.z = 0;
        group.scale.set(ps, 1, ps);
        group.visible = true;
        continue;
      }
      if (obstacle.knockbackActive) {
        const knockX = this.lanePositions[obstacle.lane] + (obstacle.xOffset ?? 0);
        const knockY = (obstacle.y ?? 0) + (obstacle.yOffset ?? 0);
        detailRoot.position.y = 0;
        if (
          obstacle.knockbackBurstFx &&
          !this.knockbackBurstSpawned.has(obstacle.id)
        ) {
          this.knockbackBurstSpawned.add(obstacle.id);
          const burstPower = obstacle.smashStrength === undefined
            ? FRAGMENT_SMASH_POWER * 0.9
            : obstacle.smashStrength;
          this.spawnFragments(
            knockX,
            obstacle.z,
            knockY + height * 0.5,
            burstPower,
            0x62d477,
            true,
            7,
          );
        }
        group.position.set(knockX, knockY, obstacle.z);
        group.rotation.y = 0;
        group.rotation.z = obstacle.knockbackSpin ?? 0;
        group.scale.set(ps, 1, ps);
        group.visible = true;
        continue;
      }
      group.position.set(this.lanePositions[obstacle.lane], 0, obstacle.z);
      group.scale.set(ps, 1, ps);
      group.rotation.y = 0;
      group.rotation.z = 0;
      if (obstacle.broken) {
        let start = this.breaking.get(obstacle.id);
        if (start === undefined) {
          start = this.time;
          this.breaking.set(obstacle.id, start);
          if (obstacle.penaltyBreak && obstacle.kind === 'low') {
            this.spawnFragments(
              this.lanePositions[obstacle.lane],
              obstacle.z,
              height,
              1.15,
              0xff2a28,
            );
          }
          if (obstacle.smashed || obstacle.crushBroken) {
            const carLowVacuumSmash =
              obstacle.smashed &&
              snapshot.player.mode === 'car' &&
              obstacle.kind === 'low' &&
              !obstacle.horseDodgeOnly;
            if (!carLowVacuumSmash) {
              const fragmentColor = obstacle.kind === 'micro'
                ? 0x55ff99
                : obstacle.horseDodgeOnly
                ? 0xff4f62
                : obstacle.kind === 'overhead'
                  ? 0xf28a2e
                  : obstacle.kind === 'tall'
                    ? 0xff6b4a
                    : 0xffb347;
              const actionPower = obstacle.smashStrength === undefined
                ? FRAGMENT_SMASH_POWER
                : 1.5 * obstacle.smashStrength;
              this.spawnFragments(
                this.lanePositions[obstacle.lane],
                obstacle.z,
                height,
                actionPower,
                fragmentColor,
              );
            }
            if (
              carLowVacuumSmash &&
              !this.smashVacuumSpawned.has(obstacle.id)
            ) {
              this.smashVacuumSpawned.add(obstacle.id);
              this.spawnVacuumEnergy(
                this.lanePositions[obstacle.lane],
                obstacle.z,
                (obstacle.y ?? 0) + height * 0.5,
                this.lowObstacleWidth,
                height,
              );
            }
          }
        }
        if (obstacle.smashed || obstacle.crushBroken) {
          group.visible = false;
          continue;
        }
        if (useChunkVisual && obstacle.penaltyBreak) {
          const progress = clamp01((this.time - start) / CRUMBLE_DURATION);
          if (progress >= 1) {
            group.visible = false;
          }
          continue;
        }
        const progress = clamp01((this.time - start) / CRUMBLE_DURATION);
        const s = 1 - progress;
        group.scale.set(ps, Math.max(0.02, s), ps);
        group.rotation.z = progress * CRUMBLE_TILT;
        group.visible = s > 0.02;
        continue;
      }
      group.visible = true;
    }
    for (const [id, group] of [...this.obstacleMeshes]) {
      if (liveIds.has(id)) continue;
      this.obstacleMeshes.delete(id);
      group.visible = false;
      group.rotation.y = 0;
      group.rotation.z = 0;
      this.obstacleMeshPool.push(group);
    }
  }

  private syncObstacleDetailModel(
    group: THREE.Group,
    obstacle: ObstacleEntity,
    horseVisual: boolean,
    tintMaterial: THREE.MeshStandardMaterial,
    frontLightMaterial: THREE.MeshStandardMaterial,
    rearLightMaterial: THREE.MeshStandardMaterial,
    dimensions: {
      width: number;
      height: number;
      depth: number;
      clearance: number;
    },
    playerSpeed: number,
    showGreenOutline: boolean,
  ): boolean {
    const choice = resolveObstacleVisual(
      obstacle,
      horseVisual,
      this.lanePositions.length,
    );
    const detailRoot = group.userData.detailRoot as THREE.Group;
    if (!choice) {
      detailRoot.visible = false;
      return false;
    }
    const visualDimensions = resolveObstacleModelDimensions(
      choice.variant,
      dimensions,
    );
    const key = [
      choice.variant,
      visualDimensions.width.toFixed(2),
      visualDimensions.height.toFixed(2),
      visualDimensions.depth.toFixed(2),
      visualDimensions.clearance.toFixed(2),
    ].join(':');
    if (group.userData.detailKey !== key) {
      const previousOutline = group.userData.greenOutline as
        | ObstacleTintOutline
        | undefined;
      if (previousOutline) disposeObstacleTintOutline(previousOutline);
      detailRoot.clear();
      const model = buildObstacleModel(
        choice.variant,
        visualDimensions,
        this.obstacleModelMaterials,
      );
      detailRoot.add(model.root);
      group.userData.detailKey = key;
      group.userData.detailModel = model;
      group.userData.greenOutline = createObstacleTintOutline(model);
    }
    const model = group.userData.detailModel as ObstacleModelInstance;
    const greenOutline = group.userData.greenOutline as ObstacleTintOutline;
    for (const binding of model.baseMaterials) {
      binding.mesh.material = binding.material;
    }
    for (const mesh of model.tintMeshes) mesh.material = tintMaterial;
    for (const mesh of model.lightMeshes) mesh.material = frontLightMaterial;
    for (const mesh of model.rearLightMeshes) mesh.material = rearLightMaterial;
    const outlineVisible = choice.family === 'medium' && showGreenOutline;
    for (const line of greenOutline.lines) line.visible = outlineVisible;
    greenOutline.material.opacity = outlineVisible
      ? 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(this.time * 8.5 + obstacle.id))
      : 0;
    const relativeSpeed = Math.max(
      4,
      playerSpeed + (this.laneFlow[obstacle.lane] ?? 0),
    );
    const wheelPhase = -this.time * relativeSpeed * 2.25;
    for (const wheel of model.wheels) wheel.rotation.x = wheelPhase;
    detailRoot.position.y = obstacle.y ?? 0;
    const reverseY = shouldReverseRoadObstacle(
      obstacle.lane,
      this.laneFlow,
      horseVisual,
    )
      ? Math.PI
      : 0;
    if (choice.variant === 'nitro-canister') {
      detailRoot.scale.setScalar(MICRO_NITRO_CANISTER_VISUAL_SCALE);
      detailRoot.rotation.set(
        MICRO_NITRO_CANISTER_TILT_X,
        reverseY +
          this.time * MICRO_NITRO_CANISTER_SPIN_RATE +
          obstacle.id * 0.41,
        MICRO_NITRO_CANISTER_TILT_Z,
      );
    } else {
      detailRoot.scale.setScalar(1);
      detailRoot.rotation.set(0, reverseY, 0);
    }
    detailRoot.visible = true;
    return true;
  }

  private syncFrontierTownScenery(snapshot: GameSnapshot): void {
    const { horsePresence } = resolveEnvironmentGroundTransition(
      this.sideEnvironmentBlend,
    );
    const liveIds = new Set<number>();
    for (const zone of snapshot.sceneryZones) {
      if (zone.theme !== 'frontierTown') continue;
      liveIds.add(zone.id);
      let group = this.frontierTownMeshes.get(zone.id);
      if (!group) {
        group = createFrontierTownScenery(
          zone.length,
          this.roadEdge,
          this.obstacleModelMaterials,
        );
        this.frontierTownMeshes.set(zone.id, group);
        this.scene.add(group);
      }
      group.position.set(
        0,
        -SIDE_DECOR_HIDE_DEPTH * (1 - horsePresence),
        zone.z,
      );
      group.visible = horsePresence > 0.005;
    }
    for (const [id, group] of [...this.frontierTownMeshes]) {
      if (liveIds.has(id)) continue;
      this.frontierTownMeshes.delete(id);
      this.scene.remove(group);
    }
  }

  private syncHorseBlaster(snapshot: GameSnapshot): void {
    // Keep the gameplay state and pulse intact, but do not render a weapon on the horse.
    this.horseBlasterMesh.visible = false;
    this.horseBlasterMesh.scale.setScalar(1 + snapshot.pulse * 0.18);
  }

  private syncCoins(snapshot: GameSnapshot, motionActive: boolean): void {
    let visible = 0;
    const hideGroundCarCoins =
      snapshot.gameplayRules === 'destroy' && snapshot.player.mode === 'car';
    const ps = 1 + this.pulse * this.pulseCfg.channels.coinsScale;
    const liveIds = new Set<number>();
    const horseCoinSlots = new Set<string>();
    for (let i = 0; i < snapshot.coins.length; i++) {
      const coin = snapshot.coins[i];
      const groundCoin =
        coin.airPathId === undefined &&
        coin.airTargetTime === undefined &&
        coin.trainId === undefined;
      if (hideGroundCarCoins && groundCoin) continue;
      liveIds.add(coin.id);
      if (coin.collected) continue;
      if (snapshot.player.mode === 'horse' && groundCoin) {
        const slotX = coin.x ?? this.lanePositions[coin.lane];
        const slotY = coin.y ?? this.coinHeight;
        const slotKey = `${slotX.toFixed(2)}:${coin.z.toFixed(2)}:${slotY.toFixed(2)}`;
        if (horseCoinSlots.has(slotKey)) continue;
        horseCoinSlots.add(slotKey);
      }
      if (coin.destroyed) {
        if (!this.crushedCoinIds.has(coin.id)) {
          this.crushedCoinIds.add(coin.id);
          this.spawnFragments(
            coin.x ?? this.lanePositions[coin.lane],
            coin.z,
            coin.y ?? this.coinHeight,
            0.7,
            0xffcc33,
            true,
          );
        }
        continue;
      }
      const mesh = this.coinMeshes[visible] ?? this.createCoinMesh();
      const echoProgress = coin.echoSpawnTime === undefined
        ? 1
        : smoothstep01((snapshot.player.gameTime - coin.echoSpawnTime) / 0.42);
      const sourceX = coin.echoSourceLane === undefined
        ? this.lanePositions[coin.lane]
        : this.lanePositions[coin.echoSourceLane];
      const targetX = coin.x ?? this.lanePositions[coin.lane];
      mesh.position.set(sourceX + (targetX - sourceX) * echoProgress, coin.y ?? this.coinHeight, coin.z);
      if (motionActive) mesh.rotation.y += 0.05;
      mesh.scale.setScalar(ps * (0.55 + echoProgress * 0.45));
      mesh.visible = true;
      visible++;
    }
    for (let i = visible; i < this.coinMeshes.length; i++) {
      this.coinMeshes[i].visible = false;
    }
    for (const id of [...this.crushedCoinIds]) {
      if (!liveIds.has(id)) this.crushedCoinIds.delete(id);
    }
  }

  private syncBonuses(snapshot: GameSnapshot): void {
    let meshVisible = 0;
    let horseVisible = 0;
    let carVisible = 0;
    const ps = 1 + this.pulse * this.pulseCfg.channels.objectsScale;
    for (let i = 0; i < snapshot.bonuses.length; i++) {
      const bonus = snapshot.bonuses[i];
      if (bonus.collected) continue;
      if (bonus.kind === 'horse' || bonus.kind === 'car') {
        const isHorse = bonus.kind === 'horse';
        const pool = isHorse ? this.horsePortalBonuses : this.carPortalBonuses;
        const visible = isHorse ? horseVisible : carVisible;
        const portal = pool[visible] ?? (
          isHorse ? this.createHorsePortalBonus() : this.createCarPortalBonus()
        );
        portal.root.position.set(
          this.lanePositions[bonus.lane],
          bonus.y ?? this.coinHeight,
          bonus.z,
        );
        portal.root.rotation.set(0, Math.PI, 0);
        portal.root.scale.setScalar(ps * (1.04 + 0.06 * (0.5 + 0.5 * Math.sin(this.time * 7))));
        updateModePortal(portal, this.time, this.pulse);
        portal.root.visible = true;
        if (isHorse) horseVisible++;
        else carVisible++;
        continue;
      }
      const mesh = this.bonusMeshes[meshVisible] ?? this.createBonusMesh();
      if (mesh.userData.bonusKind !== bonus.kind) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.ConeGeometry(
          this.coinRadius * this.rocketCfg.bonusVisualScale * 0.55,
          this.coinRadius * this.rocketCfg.bonusVisualScale * 1.35,
          12,
        );
        mesh.material = this.rocketBonusMaterial;
        mesh.userData.bonusKind = bonus.kind;
      }
      mesh.position.set(this.lanePositions[bonus.lane], bonus.y ?? this.coinHeight, bonus.z);
      mesh.rotation.y += 0.04;
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z += 0.03;
      mesh.scale.setScalar(ps * (1.1 + 0.16 * (0.5 + 0.5 * Math.sin(this.time * 9))));
      mesh.visible = true;
      meshVisible++;
    }
    for (let i = meshVisible; i < this.bonusMeshes.length; i++) {
      this.bonusMeshes[i].visible = false;
    }
    for (let i = horseVisible; i < this.horsePortalBonuses.length; i++) {
      this.horsePortalBonuses[i].root.visible = false;
    }
    for (let i = carVisible; i < this.carPortalBonuses.length; i++) {
      this.carPortalBonuses[i].root.visible = false;
    }
  }

  private updateComboBadge(snapshot: GameSnapshot, dt: number): void {
    const combo = snapshot.combo;
    if (combo <= 0) {
      this.comboBadge.visible = false;
      this.prevComboValue = 0;
      return;
    }

    if (combo > this.prevComboValue) {
      this.comboPop = 1;
    }
    this.prevComboValue = combo;
    this.comboPop = Math.max(0, this.comboPop - dt * 5.5);

    this.drawComboCanvas(combo);
    this.comboTexture.needsUpdate = true;
    this.comboBadge.visible = true;

    const player = snapshot.player;
    const height =
      this.playerHeight *
      (player.mode === 'horse'
        ? lerp(1, this.horseCfg.slideHeight / this.playerHeight, smoothstep01(this.horseSlideFx))
        : 1);
    const targetX = player.laneX;
    const targetY = player.y + height * 0.72;
    const targetZ = -2.1;

    const posX = this.springScalar(this.comboPosX, targetX, this.comboVelX, dt, 64, 18);
    this.comboPosX = posX.value;
    this.comboVelX = posX.velocity;
    const posY = this.springScalar(this.comboPosY, targetY, this.comboVelY, dt, 56, 17);
    this.comboPosY = posY.value;
    this.comboVelY = posY.velocity;
    const posZ = this.springScalar(this.comboPosZ, targetZ, this.comboVelZ, dt, 48, 15);
    this.comboPosZ = posZ.value;
    this.comboVelZ = posZ.velocity;

    this.comboBadge.position.set(this.comboPosX, this.comboPosY, this.comboPosZ);
    this.comboBadge.rotation.set(0, 0, 0);
    this.comboMesh.rotation.set(0, Math.PI, 0);
    const popScale = 1 + this.comboPop * 0.34;
    this.comboMesh.scale.set(popScale, popScale, 1);
  }

  private springScalar(
    current: number,
    target: number,
    velocity: number,
    dt: number,
    stiffness: number,
    damping: number,
  ): { value: number; velocity: number } {
    const nextVelocity = (velocity + (target - current) * stiffness * dt) *
      Math.exp(-damping * dt);
    return { value: current + nextVelocity * dt, velocity: nextVelocity };
  }

  private drawComboCanvas(combo: number): void {
    const ctx = this.comboCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.comboCanvas.width, this.comboCanvas.height);
    const color = '#ffe066';
    const size = 68;
    const centerX = 256;
    const centerY = 80;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(`${combo}`, centerX, centerY + 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillText(`${combo}`, centerX, centerY);
    ctx.shadowBlur = 0;
  }

  private updatePlayerModelAnimation(
    player: GameSnapshot['player'],
    dt: number,
    motionActive = true,
  ): void {
    if (!motionActive) return;
    const speedT = smoothstep01(this.speedNorm);
    let lateralSpeed = 0;
    if (this.previousPlayerModelX !== null) {
      lateralSpeed =
        (player.laneX - this.previousPlayerModelX) / Math.max(dt, 1e-6);
    }
    this.previousPlayerModelX = player.laneX;
    const turnTarget = clamp01(Math.abs(lateralSpeed) / 5.5) * Math.sign(lateralSpeed);
    const turnRate = Math.abs(turnTarget) > Math.abs(this.playerTurnBlend) ? 18 : 6.5;
    this.playerTurnBlend +=
      (turnTarget - this.playerTurnBlend) * (1 - Math.exp(-dt * turnRate));
    const carTurn = player.mode === 'car' ? this.playerTurnBlend : 0;
    const turnStep = Math.min(dt, 1 / 120);
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0 && turnStep > 0) {
      const step = Math.min(remaining, turnStep);
      this.carBodyTurnVelocity += (
        ((player.mode === 'car' ? turnTarget : 0) - this.carBodyTurn) * this.turnCfg.carTurnSpring -
        this.carBodyTurnVelocity * this.turnCfg.carTurnDamping
      ) * step;
      this.carBodyTurn += this.carBodyTurnVelocity * step;
      remaining -= step;
    }
    this.carModelGroup.rotation.y = this.carBodyTurn * this.turnCfg.carTurnBodyYaw;
    this.carModelGroup.rotation.z = this.carBodyTurn * this.turnCfg.carTurnBodyRoll;
    if (player.mode === 'car') {
      this.carWheelSpin -= player.speed * dt / 0.16;
    }
    for (const wheel of this.carWheelMeshes) {
      wheel.rotation.x = this.carWheelSpin;
    }
    for (const wheel of this.carFrontWheelMeshes) {
      wheel.rotation.y = carTurn * 0.46;
    }
    const headlightTarget =
      player.mode === 'car' && player.isAbilityActive ? 1 : 0;
    this.carHeadlightNitroBlend +=
      (headlightTarget - this.carHeadlightNitroBlend) *
      (1 - Math.exp(-dt * (headlightTarget > 0 ? 12 : 7)));
    this.carHeadlightMaterial.emissiveIntensity =
      lerp(0.45, 5.8, this.carHeadlightNitroBlend);
    this.carHeadlightMaterial.color.setRGB(
      lerp(0.66, 0.82, this.carHeadlightNitroBlend),
      lerp(0.87, 1, this.carHeadlightNitroBlend),
      1,
    );
    for (const light of this.carHeadlightLights) {
      light.intensity = this.carHeadlightNitroBlend * 3.8;
    }

    const rocketSmokeStrength =
      player.mode === 'rocket' && player.rocketPhase !== 'fall'
        ? clamp01(player.rocketFx * 0.78 + player.rocketBoostPulse * 0.42)
        : 0;
    this.rocketSmokeMaterial.opacity = rocketSmokeStrength * 0.24;
    for (let index = 0; index < this.rocketSmokeMeshes.length; index++) {
      const smoke = this.rocketSmokeMeshes[index];
      const phase = (this.time * 2.8 + index * 0.23) % 1;
      const spread = 0.38 + phase * 0.9 + index * 0.08;
      smoke.visible = rocketSmokeStrength > 0.025;
      smoke.position.set(
        Math.sin(this.time * 5.1 + index * 1.7) * 0.035 * spread,
        -1.02 - index * 0.18 - phase * 0.42,
        Math.cos(this.time * 4.4 + index) * 0.025 * spread,
      );
      smoke.scale.set(
        spread * 0.72,
        spread,
        spread * 0.72,
      );
    }

    const horseActive = player.mode === 'horse';
    const horseGrounded =
      horseActive &&
      (player.airState === 'grounded' || player.airState === 'trainRoof');
    const slideT = horseActive ? smoothstep01(this.horseSlideFx) : 0;
    const jumping =
      horseActive &&
      player.airSource === 'horseJump' &&
      player.airState === 'airborne';
    const jumpT = jumping ? smoothstep01(this.horseAirFx) : 0;
    const gaitActive = horseGrounded && !player.isSliding;
    const gaitRate =
      5.2 +
      speedT * 8.3 +
      player.horseMomentum * 2.2 +
      (player.horseOverdriveRemaining > 0
        ? FIRST_PERSON_HORSE_OVERDRIVE_GAIT_RATE_BOOST
        : 0);
    if (gaitActive || slideT > 0.01) {
      this.horseGaitPhase += dt * gaitRate * (gaitActive ? 1 : 0.42);
    }
    const gaitAmount = gaitActive ? 1 : 0;
    const horseFpsShakeMul = lerp(1, 0.5, smoothstep01(this.horseFpsViewBlend));
    const horseBlueAbility =
      player.horseOverdriveRemaining > 0 ||
      player.horseMomentum >= this.horseCfg.blasterMomentumThreshold;
    const horseBlueShakeMul = horseBlueAbility
      ? FIRST_PERSON_HORSE_BLUE_GAIT_SHAKE_MUL
      : 1;
    const gaitShakeMul = horseFpsShakeMul * horseBlueShakeMul;
    const bodyBob =
      Math.sin(this.horseGaitPhase * 2) *
      lerp(0.018, 0.042, speedT) *
      gaitAmount *
      (1 - slideT) *
      gaitShakeMul;
    const overdriveVisualBlend =
      horseActive ? this.horseOverdriveBlend * (1 - slideT * 0.92) : 0;
    const overdriveModelDip =
      overdriveVisualBlend * FIRST_PERSON_HORSE_OVERDRIVE_MODEL_Y;
    const overdriveModelPitch =
      overdriveVisualBlend * FIRST_PERSON_HORSE_OVERDRIVE_MODEL_PITCH;
    const fallDirection = player.lane < this.lanePositions.length / 2 ? -1 : 1;

    this.horseSlideDustMaterial.opacity = slideT * 0.065;
    for (let index = 0; index < this.horseSlideDustMeshes.length; index++) {
      const dust = this.horseSlideDustMeshes[index];
      const dustPhase = (this.time * 2.2 + index * 0.31) % 1;
      dust.visible = slideT > 0.04;
      dust.position.set(
        (index - 1) * 0.14 + fallDirection * slideT * 0.05,
        -0.12 + dustPhase * 0.08,
        -0.9 - dustPhase * 0.78 - index * 0.14,
      );
      const dustScale = slideT * (0.45 + dustPhase * 0.85);
      dust.scale.set(dustScale * 1.25, dustScale * 0.38, dustScale);
    }

    this.horseModelGroup.position.set(
      fallDirection * slideT * 0.035,
      0.12 + bodyBob - slideT * 0.02 + overdriveModelDip,
      -0.5,
    );
    this.horseModelGroup.rotation.set(
      -slideT * 0.08 - jumpT * 0.08 - overdriveModelPitch,
      this.playerTurnBlend * 0.34 + fallDirection * slideT * 0.2,
      -this.playerTurnBlend * 0.2 * this.turnCfg.horseTurnBankScale + fallDirection * slideT * 0.26,
    );
    this.horseBodyRig.position.y = bodyBob * 0.55 - slideT * 0.04;
    this.horseBodyRig.rotation.x =
      Math.sin(this.horseGaitPhase * 2 + 0.8) *
      0.035 *
      gaitAmount *
      gaitShakeMul -
      slideT * 0.18 -
      jumpT * 0.06 -
      overdriveModelPitch * 0.45;
    this.horseBodyRig.rotation.y = this.playerTurnBlend * 0.1;
    this.horseHeadRig.position.y = 0.66 - bodyBob * 0.35 - slideT * 0.48;
    this.horseHeadRig.position.z = 0.57 + slideT * 0.04;
    this.horseHeadRig.rotation.x =
      -Math.sin(this.horseGaitPhase * 2 + 0.25) *
      0.045 *
      gaitAmount *
      gaitShakeMul -
      slideT * 0.24 +
      jumpT * 0.08;
    this.horseHeadRig.rotation.y = this.playerTurnBlend * 0.2;
    this.horseHeadRig.rotation.z = -fallDirection * slideT * 0.06;
    this.horseTailRig.rotation.x =
      -0.95 +
      Math.sin(this.horseGaitPhase + 0.6) * 0.12 * gaitAmount * gaitShakeMul;
    this.horseTailRig.rotation.z =
      Math.sin(this.horseGaitPhase * 0.72) * 0.16 * gaitAmount * gaitShakeMul;

    const strideAmplitude = lerp(0.34, 0.66, speedT);
    for (const leg of this.horseLegRigs) {
      if (slideT > 0.01) {
        const gaitStride =
          Math.sin(this.horseGaitPhase + leg.phase) * strideAmplitude;
        if (leg.front) {
          const frontStep =
            Math.sin(this.horseGaitPhase * 0.72 + leg.phase) * 0.22;
          leg.hip.rotation.x = lerp(gaitStride, frontStep, slideT);
          leg.knee.rotation.x = lerp(
            0.12 + Math.max(0, -gaitStride) * 0.45,
            0.18 + Math.max(0, -frontStep) * 0.42,
            slideT,
          );
        } else {
          leg.hip.rotation.x = lerp(gaitStride, -0.7, slideT);
          leg.knee.rotation.x = lerp(0.18, 0.82, slideT);
        }
        leg.hip.rotation.z = fallDirection * slideT * (leg.front ? 0.035 : 0.055);
        leg.knee.rotation.z = -fallDirection * slideT * 0.025;
      } else if (jumping) {
        leg.hip.rotation.x = leg.front
          ? lerp(-0.25, -0.72, jumpT)
          : lerp(0.2, 0.78, jumpT);
        leg.knee.rotation.x = lerp(0.14, leg.front ? 1.08 : 0.88, jumpT);
        leg.hip.rotation.z = 0;
        leg.knee.rotation.z = 0;
      } else {
        const stride = Math.sin(this.horseGaitPhase + leg.phase);
        leg.hip.rotation.x = stride * strideAmplitude * gaitAmount;
        leg.knee.rotation.x =
          (0.1 + Math.max(0, -stride) * lerp(0.38, 0.76, speedT)) * gaitAmount;
        leg.hip.rotation.z = 0;
        leg.knee.rotation.z = 0;
      }
    }
  }

  private updatePlayerSpin(player: GameSnapshot['player']): void {
    if (player.mode === 'rocket') {
      this.playerMesh.position.z = 0;
      const nosePitch = player.rocketPhase === 'fall'
        ? 0
        : this.rocketLaunchArcBlend * this.rocketCfg.launchArcNosePitch;
      this.playerMesh.rotation.x = Math.PI / 2 - nosePitch;
      this.playerMesh.rotation.y = 0;
      this.playerMesh.rotation.z = 0;
      return;
    }
    if (player.mode === 'horse') {
      this.playerMesh.position.z = 0;
      this.playerMesh.rotation.set(0, 0, 0);
      return;
    }
    this.playerMesh.position.z = 0;
    this.playerMesh.rotation.x = 0;
    this.playerMesh.rotation.y = 0;
    // Keep trick scoring, but avoid a full-body barrel roll that can cause motion sickness.
    const target = 0;
    this.playerMesh.rotation.z += (target - this.playerMesh.rotation.z) * Math.min(1, 0.2);
  }

  private syncRamps(snapshot: GameSnapshot): void {
    let visible = 0;
    for (let i = 0; i < snapshot.ramps.length; i++) {
      const ramp = snapshot.ramps[i];
      if (ramp.used) continue;
      const mesh = this.rampMeshes[visible] ?? this.createRampMesh();
      const echoProgress = ramp.echoSpawnTime === undefined
        ? 1
        : smoothstep01((snapshot.player.gameTime - ramp.echoSpawnTime) / 0.5);
      const sourceX = ramp.echoSourceLane === undefined
        ? this.lanePositions[ramp.lane]
        : this.lanePositions[ramp.echoSourceLane];
      const targetX = this.lanePositions[ramp.lane];
      mesh.position.set(sourceX + (targetX - sourceX) * echoProgress, 0, ramp.z);
      mesh.scale.setScalar(0.6 + echoProgress * 0.4);
      const flash = ramp.echoSpawnTime === undefined ? 0 : 1 - echoProgress;
      const wedgeMaterial = (mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const markerMaterial = (mesh.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      wedgeMaterial.emissiveIntensity = 1.85 + flash * 6;
      markerMaterial.emissiveIntensity = 2.5 + flash * 8;
      mesh.rotation.y = 0;
      mesh.visible = true;
      visible++;
    }
    for (let i = visible; i < this.rampMeshes.length; i++) {
      this.rampMeshes[i].visible = false;
    }
  }

  private syncTrains(snapshot: GameSnapshot): void {
    let visible = 0;
    for (const train of snapshot.trains) {
      const group = this.trainMeshes[visible] ?? this.createTrainMesh();
      const instance = group.userData.trainModel as TrainModelInstance;
      if (group.userData.trainVariant !== train.variant) {
        paintTrain(
          instance,
          train.variant === 0 ? this.trainSideMaterial : this.trainSideAltMaterial,
          train.variant === 0 ? this.trainTopMaterial : this.trainTopAltMaterial,
        );
        group.userData.trainVariant = train.variant;
      }
      if (instance.length !== train.length) {
        layoutTrain(instance, train.length);
      }
      const echoProgress = train.echoSpawnTime === undefined
        ? 1
        : smoothstep01((snapshot.player.gameTime - train.echoSpawnTime) / 0.65);
      const sourceX = train.echoSourceLane === undefined
        ? this.lanePositions[train.lane]
        : this.lanePositions[train.echoSourceLane];
      const targetX = this.lanePositions[train.lane];
      group.position.set(sourceX + (targetX - sourceX) * echoProgress, 0, train.z);
      const echoScale = (0.55 + echoProgress * 0.45) * (1 + this.pulse * 0.06);
      group.scale.set(echoScale, 1, 1);
      group.visible = true;
      visible++;
    }
    for (let i = visible; i < this.trainMeshes.length; i++) {
      this.trainMeshes[i].visible = false;
    }
  }

  private spawnLandingSparks(x: number, y: number): void {
    let spawned = 0;
    for (const fragment of this.fragments) {
      if (spawned >= 6) break;
      if (fragment.active) continue;
      fragment.active = true;
      fragment.mesh.visible = true;
      fragment.mesh.position.set(x + rand(-0.4, 0.4), y + 0.1, 0);
      fragment.velocity.set(rand(-3, 3), rand(2, 5), rand(-2, 0.5));
      fragment.spin.set(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      fragment.mesh.rotation.set(rand(0, Math.PI * 2), rand(0, Math.PI * 2), 0);
      fragment.baseScale = rand(0.25, 0.5);
      fragment.opacityScale = 1;
      fragment.mesh.scale.setScalar(fragment.baseScale);
      fragment.life = rand(0.25, 0.45);
      fragment.maxLife = fragment.life;
      fragment.material.opacity = 1;
      fragment.material.color.set(0xffd27a);
      spawned++;
    }
  }

  private updateRocketLaunchCamera(
    player: GameSnapshot['player'],
    dt: number,
  ): void {
    const cfg = this.rocketCfg;
    const blendRate =
      player.mode === 'rocket'
        ? Math.min(1, dt * cfg.cameraBlendRate)
        : Math.min(1, dt * cfg.cameraBlendRate * 3);
    let targetDip = 0;
    let targetLook = 0;
    let targetPullback = 0;

    if (player.mode === 'rocket') {
      let climbT = 0;
      if (player.rocketPhase === 'anticipation') {
        climbT = smoothstep01(this.rocketAnticipationBlend) * 0.4;
      } else if (player.rocketPhase === 'launch') {
        climbT = 0.4 + this.rocketLaunchPhaseProgress * 0.6;
      } else if (
        player.rocketPhase === 'plateau' ||
        player.rocketPhase === 'cruise'
      ) {
        climbT = 1;
      }
      const lagSpan = Math.max(
        cfg.launchCameraLagToTopEnd - cfg.launchCameraLagToTopStart,
        0.001,
      );
      const topBlend = smoothstep01(
        (climbT - cfg.launchCameraLagToTopStart) / lagSpan,
      );
      const lagBlend = 1 - topBlend;
      targetDip =
        -cfg.launchCameraDipLaunchY * lagBlend +
        cfg.launchCameraPitchBounce * topBlend * 0.55;
      targetLook =
        cfg.launchCameraLookAnticipation * lagBlend +
        cfg.launchCameraLookLaunch * topBlend;
      targetPullback = cfg.launchCameraPullbackZ * lagBlend * 0.55;

      if (
        player.rocketPhase === 'plateau' &&
        this.rocketPlateauBounce < 1
      ) {
        this.rocketPlateauBounce = Math.min(
          1,
          this.rocketPlateauBounce +
            dt / cfg.launchCameraPlateauBounceSeconds,
        );
        const bounce = 1 - Math.min(1, easeOutBack(
          this.rocketPlateauBounce,
          cfg.launchCameraBounceOvershoot,
        ));
        targetDip = cfg.launchCameraPitchBounce * bounce * 1.3;
        targetLook = cfg.launchCameraLookLaunch * bounce * 0.95;
        targetPullback = cfg.launchCameraPullbackZ * bounce * 0.25;
      }
    }

    this.rocketLaunchDipY += (targetDip - this.rocketLaunchDipY) * blendRate;
    this.rocketLaunchLookY += (targetLook - this.rocketLaunchLookY) * blendRate;
    this.rocketLaunchPullbackZ +=
      (targetPullback - this.rocketLaunchPullbackZ) * blendRate;
  }

  private createFirstPersonSteeringWheel(): THREE.Group {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.035, 8, 24),
      this.firstPersonSteeringWheelMaterial,
    );
    group.add(ring);

    const spokeGeometry = new THREE.BoxGeometry(0.22, 0.028, 0.025);
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const spoke = new THREE.Mesh(
        spokeGeometry,
        this.firstPersonSteeringWheelMaterial,
      );
      spoke.position.set(
        Math.cos(angle) * 0.105,
        Math.sin(angle) * 0.105,
        0,
      );
      spoke.rotation.z = angle;
      group.add(spoke);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.055, 12),
      this.firstPersonSteeringWheelMaterial,
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.012;
    group.add(hub);

    group.position.set(0, -0.62, -1.08);
    group.rotation.x = -0.18;
    group.visible = false;
    group.traverse((object) => {
      object.renderOrder = 20;
    });
    return group;
  }

  private createSportCarModel(
    darkMaterial: THREE.MeshStandardMaterial,
    glassMaterial: THREE.MeshStandardMaterial,
    headlightMaterial: THREE.MeshStandardMaterial,
    taillightMaterial: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const group = new THREE.Group();
    const width = this.playerWidth * 1.1;
    const length = this.playerDepth * 1.92;
    const frontZ = this.playerDepth * 0.5;
    const centerZ = frontZ - length * 0.5;

    const bodyGeometry = new RoundedBoxGeometry(width * 0.92, 0.28, length * 0.96, 3, 0.09);
    const body = new THREE.Mesh(bodyGeometry, this.playerMaterial);
    body.position.set(0, -0.12, centerZ);
    group.add(body);
    group.userData.body = body;

    const chassis = new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.86, 0.1, length * 0.9, 2, 0.04),
      darkMaterial,
    );
    chassis.position.set(0, -0.26, centerZ);
    group.add(chassis);

    const nose = new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.88, 0.16, length * 0.34, 3, 0.07),
      this.playerMaterial,
    );
    nose.position.set(0, -0.02, centerZ + length * 0.32);
    nose.rotation.x = -0.16;
    group.add(nose);

    const hood = new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.7, 0.06, length * 0.28, 2, 0.04),
      darkMaterial,
    );
    hood.position.set(0, 0.06, centerZ + length * 0.22);
    hood.rotation.x = -0.12;
    group.add(hood);

    for (const x of [-1, 1]) {
      const haunch = new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.22, 0.2, length * 0.34, 2, 0.06),
        this.playerMaterial,
      );
      haunch.position.set(x * width * 0.42, -0.08, centerZ - length * 0.22);
      group.add(haunch);
      const intake = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.08, 0.1, length * 0.18),
        darkMaterial,
      );
      intake.position.set(x * width * 0.48, -0.06, centerZ + length * 0.08);
      group.add(intake);
    }

    const cabin = new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.62, 0.28, length * 0.32, 3, 0.08),
      glassMaterial,
    );
    cabin.position.set(0, 0.16, centerZ - length * 0.08);
    cabin.rotation.x = -0.08;
    group.add(cabin);

    const canopy = new THREE.Mesh(
      new RoundedBoxGeometry(width * 0.38, 0.08, length * 0.22, 2, 0.04),
      darkMaterial,
    );
    canopy.position.set(0, 0.3, centerZ - length * 0.1);
    group.add(canopy);

    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.96, 0.045, 0.14),
      darkMaterial,
    );
    splitter.position.set(0, -0.28, frontZ - 0.02);
    group.add(splitter);

    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.72, 0.045, 0.12),
      darkMaterial,
    );
    spoiler.position.set(0, 0.18, centerZ - length * 0.46);
    group.add(spoiler);
    for (const x of [-width * 0.24, width * 0.24]) {
      const mount = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.16, 0.04),
        darkMaterial,
      );
      mount.position.set(x, 0.08, centerZ - length * 0.44);
      group.add(mount);
    }

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.42, 0.035, 0.03),
      headlightMaterial,
    );
    bar.position.set(0, 0.01, frontZ + 0.01);
    group.add(bar);

    const lightGeometry = new THREE.BoxGeometry(width * 0.22, 0.07, 0.04);
    for (const x of [-width * 0.32, width * 0.32]) {
      const light = new THREE.Mesh(lightGeometry, headlightMaterial);
      light.position.set(x, 0.015, frontZ + 0.014);
      group.add(light);
      const glow = new THREE.PointLight(0x79ddff, 0, 6.5, 2);
      glow.position.set(x, 0.01, frontZ + 0.1);
      this.carHeadlightLights.push(glow);
      group.add(glow);
    }

    const tailGeometry = new THREE.BoxGeometry(width * 0.2, 0.055, 0.03);
    for (const x of [-width * 0.3, width * 0.3]) {
      const tail = new THREE.Mesh(tailGeometry, taillightMaterial);
      tail.position.set(x, 0.0, centerZ - length * 0.48);
      group.add(tail);
    }

    const wheelGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.13, 12);
    wheelGeometry.rotateZ(Math.PI / 2);
    for (const x of [-width * 0.52, width * 0.52]) {
      for (const z of [centerZ - length * 0.28, centerZ + length * 0.28]) {
        const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
        wheel.position.set(x, -0.28, z);
        this.carWheelMeshes.push(wheel);
        if (z > centerZ) this.carFrontWheelMeshes.push(wheel);
        group.add(wheel);
      }
    }

    group.visible = true;
    return group;
  }

  private createRocketModel(
    darkMaterial: THREE.MeshStandardMaterial,
    accentMaterial: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const group = new THREE.Group();
    const length = this.playerDepth * 2;
    const radius = this.playerWidth * 0.34;

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.82, radius, length * 0.58, 10),
      this.playerMaterial,
    );
    body.position.y = -length * 0.03;
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.82, length * 0.3, 10),
      this.playerMaterial,
    );
    nose.position.y = length * 0.41;
    group.add(nose);

    const engine = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.68, radius * 0.88, length * 0.16, 10),
      darkMaterial,
    );
    engine.position.y = -length * 0.39;
    group.add(engine);

    for (const x of [-1, 1]) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.16, length * 0.32, radius * 0.92),
        accentMaterial,
      );
      fin.position.set(x * radius * 0.86, -length * 0.25, 0);
      fin.rotation.z = x * 0.18;
      group.add(fin);
    }

    const smokeGeometry = new THREE.SphereGeometry(0.2, 8, 6);
    for (let index = 0; index < 4; index++) {
      const smoke = new THREE.Mesh(smokeGeometry, this.rocketSmokeMaterial);
      smoke.position.y = -length * 0.5 - index * 0.24;
      smoke.scale.setScalar(0.35 + index * 0.12);
      smoke.visible = false;
      this.rocketSmokeMeshes.push(smoke);
      group.add(smoke);
    }

    group.position.y = -length * 0.25;
    group.visible = false;
    return group;
  }

  private createHorseModel(
    darkMaterial: THREE.MeshStandardMaterial,
  ): HorseModelRig {
    const group = new THREE.Group();
    const bodyRig = new THREE.Group();
    const torso = new THREE.Mesh(
      new RoundedBoxGeometry(
        this.playerWidth * 0.56,
        0.38,
        this.playerDepth * 1.08,
        3,
        0.11,
      ),
      this.playerMaterial,
    );
    torso.position.set(0, 0.08, -0.12);
    bodyRig.add(torso);

    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 10, 8),
      this.playerMaterial,
    );
    chest.scale.set(0.92, 1.18, 0.92);
    chest.position.set(0, 0.11, 0.29);
    bodyRig.add(chest);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.16, 0.62, 8),
      this.playerMaterial,
    );
    neck.rotation.x = 0.44;
    neck.position.set(0, 0.4, 0.36);
    bodyRig.add(neck);
    group.add(bodyRig);

    const headRig = new THREE.Group();
    headRig.position.set(0, 0.66, 0.57);
    const head = new THREE.Mesh(
      new RoundedBoxGeometry(0.29, 0.26, 0.46, 3, 0.075),
      this.playerMaterial,
    );
    head.position.z = 0.02;
    headRig.add(head);
    const muzzle = new THREE.Mesh(
      new RoundedBoxGeometry(0.24, 0.16, 0.27, 3, 0.05),
      this.playerMaterial,
    );
    muzzle.position.set(0, -0.07, 0.28);
    headRig.add(muzzle);
    for (const x of [-0.11, 0.11]) {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.2, 5),
        darkMaterial,
      );
      ear.position.set(x, 0.25, -0.02);
      ear.rotation.z = x * 0.8;
      headRig.add(ear);
    }
    group.add(headRig);

    const mane = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.58, 0.14),
      darkMaterial,
    );
    mane.position.set(0, 0.42, 0.12);
    mane.rotation.x = 0.47;
    group.add(mane);

    const tailRig = new THREE.Group();
    tailRig.position.set(0, 0.15, -0.63);
    tailRig.rotation.x = -0.95;
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.1, 0.56, 7),
      darkMaterial,
    );
    tail.position.y = -0.25;
    tailRig.add(tail);
    group.add(tailRig);

    const legs: HorseLegRig[] = [];
    const upperGeometry = new THREE.CylinderGeometry(0.065, 0.085, 0.24, 7);
    const lowerGeometry = new THREE.CylinderGeometry(0.045, 0.065, 0.24, 7);
    const hoofGeometry = new THREE.BoxGeometry(0.13, 0.08, 0.18);
    for (const front of [false, true]) {
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.19, -0.02, front ? 0.25 : -0.44);
        const upper = new THREE.Mesh(upperGeometry, this.playerMaterial);
        upper.position.y = -0.12;
        hip.add(upper);
        const knee = new THREE.Group();
        knee.position.y = -0.24;
        const lower = new THREE.Mesh(lowerGeometry, this.playerMaterial);
        lower.position.y = -0.12;
        knee.add(lower);
        const hoof = new THREE.Mesh(hoofGeometry, darkMaterial);
        hoof.position.set(0, -0.27, 0.035);
        knee.add(hoof);
        hip.add(knee);
        group.add(hip);
        const diagonalPhase = front
          ? side < 0 ? 0 : Math.PI
          : side < 0 ? Math.PI + 0.28 : 0.28;
        legs.push({
          hip,
          knee,
          phase: diagonalPhase,
          front,
        });
      }
    }

    group.visible = false;
    return {
      group,
      body: bodyRig,
      head: headRig,
      tail: tailRig,
      legs,
    };
  }

  private makePlayerGeometry(shape: PlayerShape): THREE.BufferGeometry {
    switch (shape) {
      case 'sphere':
        return new THREE.SphereGeometry(this.playerWidth / 2, 16, 12);
      case 'cone':
        return new THREE.ConeGeometry(this.playerWidth / 2, this.playerHeight, 4);
      case 'box':
      default:
        return new THREE.BoxGeometry(
          this.playerWidth,
          this.playerHeight,
          this.playerDepth,
        );
    }
  }

  private setPlayerShape(shape: PlayerShape, force = false): void {
    if (!force && shape === this.currentShape) return;
    this.currentShape = shape;
    this.carModelGroup.visible = shape === 'box';
    this.horseModelGroup.visible = shape === 'sphere';
    this.rocketModelGroup.visible = shape === 'cone';
    this.edgeLines.visible = shape === 'box';
  }

  private createObstacleMesh(): THREE.Group {
    const group = new THREE.Group();
    const lowGeometry = new THREE.BoxGeometry(
      this.lowObstacleWidth,
      1,
      this.lowObstacleDepth,
    );
    const overheadGeometry = new THREE.BoxGeometry(
      this.overheadWidth,
      1,
      this.overheadDepth,
    );
    const body = new THREE.Mesh(lowGeometry, this.lowMaterial);
    const top = new THREE.Mesh(overheadGeometry, this.tallMaterial);
    const left = new THREE.Mesh(overheadGeometry, this.tallMaterial);
    const right = new THREE.Mesh(overheadGeometry, this.tallMaterial);
    const roundedLowGeometry = new RoundedBoxGeometry(
      this.lowObstacleWidth,
      1,
      this.lowObstacleDepth,
      3,
      0.16,
    );
    const roundedOverheadGeometry = new RoundedBoxGeometry(
      this.overheadWidth,
      1,
      this.overheadDepth,
      3,
      0.16,
    );
    const horseBody = new THREE.Mesh(roundedLowGeometry, this.lowMaterial);
    const horseTop = new THREE.Mesh(roundedOverheadGeometry, this.tallMaterial);
    const horseLeft = new THREE.Mesh(roundedOverheadGeometry, this.tallMaterial);
    const horseRight = new THREE.Mesh(roundedOverheadGeometry, this.tallMaterial);
    const slideMarker = new THREE.Group();
    const markerStem = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.42, 0.08),
      this.slideMarkerMaterial,
    );
    markerStem.position.y = 0.18;
    markerStem.renderOrder = 12;
    const markerHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.36, 3),
      this.slideMarkerMaterial,
    );
    markerHead.rotation.z = Math.PI;
    markerHead.position.y = -0.18;
    markerHead.renderOrder = 12;
    slideMarker.add(markerStem, markerHead);
    const jumpMarker = new THREE.Group();
    const jumpStem = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.38, 0.07),
      this.jumpMarkerMaterial,
    );
    jumpStem.position.y = -0.16;
    const jumpHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.23, 0.32, 3),
      this.jumpMarkerMaterial,
    );
    jumpHead.position.y = 0.16;
    jumpMarker.add(jumpStem, jumpHead);
    const trainRoofDodgeMarker = new THREE.Group();
    const dodgeStem = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.08, 0.08),
      this.jumpMarkerMaterial,
    );
    dodgeStem.renderOrder = 12;
    const dodgeLeft = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.28, 3),
      this.jumpMarkerMaterial,
    );
    dodgeLeft.rotation.z = Math.PI / 2;
    dodgeLeft.position.x = -0.26;
    dodgeLeft.renderOrder = 12;
    const dodgeRight = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.28, 3),
      this.jumpMarkerMaterial,
    );
    dodgeRight.rotation.z = -Math.PI / 2;
    dodgeRight.position.x = 0.26;
    dodgeRight.renderOrder = 12;
    trainRoofDodgeMarker.add(dodgeStem, dodgeLeft, dodgeRight);
    trainRoofDodgeMarker.visible = false;
    const chunkCarMaterial = this.lowMaterial.clone();
    const chunkHorseMaterial = this.lowMaterial.clone();
    const lowChunks = this.createLowChunkMeshes(false, chunkCarMaterial);
    const horseLowChunks = this.createLowChunkMeshes(true, chunkHorseMaterial);
    const detailRoot = new THREE.Group();
    detailRoot.visible = false;
    for (const chunk of lowChunks) group.add(chunk);
    for (const chunk of horseLowChunks) group.add(chunk);
    group.add(
      body,
      top,
      left,
      right,
      horseBody,
      horseTop,
      horseLeft,
      horseRight,
      slideMarker,
      jumpMarker,
      trainRoofDodgeMarker,
      detailRoot,
    );
    group.userData.body = body;
    group.userData.top = top;
    group.userData.left = left;
    group.userData.right = right;
    group.userData.horseBody = horseBody;
    group.userData.horseTop = horseTop;
    group.userData.horseLeft = horseLeft;
    group.userData.horseRight = horseRight;
    group.userData.slideMarker = slideMarker;
    group.userData.jumpMarker = jumpMarker;
    group.userData.trainRoofDodgeMarker = trainRoofDodgeMarker;
    group.userData.detailRoot = detailRoot;
    group.userData.detailKey = '';
    group.userData.detailModel = null;
    group.userData.greenOutline = undefined;
    group.userData.lowChunks = lowChunks;
    group.userData.horseLowChunks = horseLowChunks;
    group.userData.chunkCarMaterial = chunkCarMaterial;
    group.userData.chunkHorseMaterial = chunkHorseMaterial;
    const fadeMaterial = this.tallMaterial.clone();
    fadeMaterial.transparent = true;
    group.userData.fadeMaterial = fadeMaterial;
    this.scene.add(group);
    return group;
  }

  private resolvePlayerStress(snapshot: GameSnapshot): number {
    const player = snapshot.player;
    if (snapshot.gameplayRules === 'adrenaline' && snapshot.adrenalineMax > 0) {
      const visual = adrenalineBarVisualPercent(
        (player.adrenaline / snapshot.adrenalineMax) * 100,
      );
      if (visual >= 60) return 0;
      if (visual >= 30) return smoothstep01((60 - visual) / 30) * 0.72;
      return 0.72 + smoothstep01((30 - visual) / 30) * 0.28;
    }
    if (player.damageState === 'critical') return 0.95;
    if (player.damageState === 'damaged') return 0.55;
    return 0;
  }

  private createPlayerCrackGroup(): THREE.Group {
    const group = new THREE.Group();
    const w = this.playerWidth * 0.46;
    const h = this.playerHeight * 0.44;
    const d = this.playerDepth * 0.42;
    const addCrack = (a: THREE.Vector3, b: THREE.Vector3): void => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({
          color: 0x2a0808,
          transparent: true,
          opacity: 0.8,
          depthTest: true,
        }),
      );
      group.add(line);
    };
    addCrack(
      new THREE.Vector3(-w * 0.15, h * 0.12, d),
      new THREE.Vector3(w * 0.38, -h * 0.18, d),
    );
    addCrack(
      new THREE.Vector3(w * 0.1, h * 0.28, d * 0.55),
      new THREE.Vector3(-w * 0.32, -h * 0.05, d * 0.55),
    );
    addCrack(
      new THREE.Vector3(-w * 0.28, -h * 0.22, -d * 0.7),
      new THREE.Vector3(w * 0.2, h * 0.08, -d * 0.7),
    );
    addCrack(
      new THREE.Vector3(0, -h * 0.35, 0),
      new THREE.Vector3(w * 0.12, h * 0.3, 0),
    );
    group.visible = false;
    return group;
  }

  private resolveDashStress(snapshot: GameSnapshot): number {
    if (snapshot.gameplayRules === 'adrenaline' && snapshot.adrenalineMax > 0) {
      const visual = adrenalineBarVisualPercent(
        (snapshot.player.adrenaline / snapshot.adrenalineMax) * 100,
      );
      if (visual >= 50) return 0;
      if (visual >= 25) return smoothstep01((50 - visual) / 25) * 0.72;
      return 0.72 + smoothstep01((25 - visual) / 25) * 0.28;
    }
    if (snapshot.player.damageState === 'critical') return 0.95;
    if (snapshot.player.damageState === 'damaged') return 0.55;
    return 0;
  }

  private applyObstacleChunkMaterials(
    carMaterial: THREE.MeshStandardMaterial,
    horseMaterial: THREE.MeshStandardMaterial,
    source: THREE.MeshStandardMaterial,
    flash: number,
  ): void {
    carMaterial.copy(source);
    horseMaterial.copy(source);
    if (flash <= 0) return;
    for (const mat of [carMaterial, horseMaterial]) {
      mat.emissive.setRGB(1, 0.08, 0.04);
      mat.emissiveIntensity = 2.4 * flash;
    }
  }

  private createLowChunkMeshes(
    rounded: boolean,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh[] {
    const lowDepth = this.lowObstacleDepth;
    const gap = this.lowObstacleWidth * LOW_CHUNK_GAP_RATIO;
    const chunkW = Math.max(0.2, (this.lowObstacleWidth - gap * 2) / 3);
    const geometry = rounded
      ? new RoundedBoxGeometry(chunkW, 1, lowDepth, 3, 0.14)
      : new THREE.BoxGeometry(chunkW, 1, lowDepth);
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      meshes.push(mesh);
    }
    return meshes;
  }

  private applyLowChunkPose(
    mesh: THREE.Mesh,
    index: number,
    obstacleId: number,
    centerY: number,
    height: number,
    revealEase: number,
    breakEase: number,
  ): void {
    const gap = this.lowObstacleWidth * LOW_CHUNK_GAP_RATIO * revealEase;
    const chunkW = Math.max(0.2, (this.lowObstacleWidth - gap * 2) / 3);
    const spread = this.lowObstacleWidth * LOW_CHUNK_SPREAD_RATIO * revealEase;
    const seed = Math.abs(obstacleId);
    const sign = seed % 2 === 0 ? 1 : -1;
    const laneWobble = ((seed % 5) - 2) * 0.018 * revealEase;
    const centers = [
      -(chunkW + gap * 0.55),
      0,
      chunkW + gap * 0.55,
    ];
    const xSpread = [-spread * 0.62, spread * 0.08 * sign, spread * 0.62];
    const tilts = [
      { x: 0.06 * sign, y: 0.03, z: LOW_CHUNK_TILT * sign },
      { x: -0.035 * sign, y: -0.04, z: -LOW_CHUNK_TILT * 0.65 * sign },
      { x: -0.07 * sign, y: 0.035, z: -LOW_CHUNK_TILT * 1.15 * sign },
    ];
    const breakSpread = breakEase * this.lowObstacleWidth * LOW_CHUNK_SPREAD_RATIO * 0.55;
    const x =
      centers[index] +
      xSpread[index] +
      (index === 0 ? -breakSpread : index === 2 ? breakSpread : 0);
    mesh.position.set(x, centerY + laneWobble * height, 0);
    mesh.scale.set(1, height, 1);
    mesh.rotation.set(
      tilts[index].x * revealEase + breakEase * 0.05 * sign,
      tilts[index].y * revealEase,
      tilts[index].z * revealEase + breakEase * 0.07 * (index === 1 ? sign : -sign),
    );
  }

  private createHorseBlasterMesh(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(this.playerWidth * 0.75, 0.22, 0.65),
      this.horseBlasterMaterial,
    );
    body.position.set(0, this.playerHeight * 0.52, 0.08);
    group.add(body);
    const barrelGeometry = new THREE.CylinderGeometry(0.09, 0.12, 0.75, 10);
    barrelGeometry.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const barrel = new THREE.Mesh(barrelGeometry, this.horseBlasterMaterial);
      barrel.position.set(side * this.playerWidth * 0.32, this.playerHeight * 0.52, 0.46);
      group.add(barrel);
    }
    group.visible = false;
    return group;
  }

  private createCoinMesh(): THREE.Mesh {
    const visualRadius = this.coinRadius * COIN_VISUAL_SCALE;
    const geometry = new THREE.CylinderGeometry(visualRadius, visualRadius, 0.14, 20);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.coinMaterial);
    this.coinMeshes.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private createBonusMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(
        this.coinRadius * this.rocketCfg.bonusVisualScale * 0.55,
        this.coinRadius * this.rocketCfg.bonusVisualScale * 1.35,
        12,
      ),
      this.rocketBonusMaterial,
    );
    mesh.userData.bonusKind = 'rocket';
    this.bonusMeshes.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private createHorsePortalBonus(): ModePortalInstance {
    const portal = createHorsePortal(this.coinRadius * this.horseCfg.horseBonusVisualScale);
    portal.root.visible = false;
    this.horsePortalBonuses.push(portal);
    this.scene.add(portal.root);
    return portal;
  }

  private createCarPortalBonus(): ModePortalInstance {
    const portal = createCarPortal(this.coinRadius * this.horseCfg.carBonusVisualScale);
    portal.root.visible = false;
    this.carPortalBonuses.push(portal);
    this.scene.add(portal.root);
    return portal;
  }

  private triggerPortalJelly(
    player: GameSnapshot['player'],
    kind: ModePortalKind,
  ): void {
    this.portalJellyT = 0;
    this.portalJellyKind = kind;
    this.portalJellyFlash = 1;
    this.landingPulse = Math.max(this.landingPulse, 0.72);
    this.shakeAmp = Math.max(this.shakeAmp, SHAKE_STRENGTH * 0.42);
    this.triggerLandingCamBounce(LANDING_CAM_BOUNCE_BASE * 0.72);
    const radius = this.coinRadius * (
      kind === 'car'
        ? this.horseCfg.carBonusVisualScale
        : this.horseCfg.horseBonusVisualScale
    );
    this.portalSwallow.root.position.set(
      player.laneX,
      player.y + this.playerHeight * 0.52,
      0.35,
    );
    updatePortalSwallow(this.portalSwallow, 0, kind, radius);
    this.spawnFragments(
      player.laneX,
      0.2,
      player.y + this.playerHeight * 0.55,
      1.2,
      kind === 'car' ? 0xff7eb8 : 0x45bfff,
      true,
    );
  }

  private updatePortalJelly(dt: number, player: GameSnapshot['player']): void {
    if (this.portalJellyT < 0) {
      this.portalJellyFlash = 0;
      updatePortalSwallow(this.portalSwallow, 1, this.portalJellyKind, 1);
      return;
    }
    const progress = this.portalJellyT / PORTAL_JELLY_SECONDS;
    const jelly = samplePortalJelly(progress);
    this.portalJellyFlash = jelly.flash;
    const radius = this.coinRadius * (
      this.portalJellyKind === 'car'
        ? this.horseCfg.carBonusVisualScale
        : this.horseCfg.horseBonusVisualScale
    );
    this.portalSwallow.root.position.x = player.laneX;
    this.portalSwallow.root.position.y = player.y + this.playerHeight * 0.52;
    updatePortalSwallow(this.portalSwallow, progress, this.portalJellyKind, radius);
    this.portalJellyT += dt;
    if (progress >= 1) {
      this.portalJellyT = -1;
      this.portalJellyFlash = 0;
    }
  }

  private createRampMesh(): THREE.Group {
    const group = new THREE.Group();
    const visualHeight = this.rampVisualHeight;
    const wedge = new THREE.Mesh(
      makeWedgeGeometry(this.rampWidth, this.rampDepth, visualHeight),
      this.rampMaterial.clone(),
    );
    group.add(wedge);
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.2, 4),
      this.rampMarkerMaterial.clone(),
    );
    marker.rotation.y = Math.PI / 4;
    marker.position.set(0, visualHeight * 0.62 + 0.22, -2.4);
    group.add(marker);
    group.visible = false;
    this.rampMeshes.push(group);
    this.scene.add(group);
    return group;
  }

  private createTrainMesh(): THREE.Group {
    const instance = createTrainModel(this.trainWidth, this.trainHeight, {
      body: this.trainSideMaterial,
      accent: this.trainTopMaterial,
      ...this.trainDetailMaterials,
    });
    instance.root.visible = false;
    instance.root.userData.trainModel = instance;
    this.trainMeshes.push(instance.root);
    this.scene.add(instance.root);
    return instance.root;
  }

  private addSpeedLines(): void {
    const count = this.postfxCfg.windCount;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x66ccff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 1), material);
      mesh.visible = false;
      this.speedLineMaterials.push(material);
      this.speedLineMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  private addFragments(): void {
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x44dd88,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.fragments.push({
        mesh,
        material,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        baseScale: 1,
        opacityScale: 1,
        active: false,
        vacuum: false,
        vacuumHoming: 0,
        vacuumAge: 0,
      });
    }
  }

  private spawnFragments(
    x: number,
    z: number,
    yOrHeight: number,
    power = 1,
    color = 0x44dd88,
    absoluteY = false,
    fragmentCap?: number,
  ): void {
    let spawned = 0;
    const fragmentLimit = fragmentCap ?? Math.min(
      this.fragments.length,
      FRAGMENT_MIN + Math.round(Math.min(20, power * 2)),
    );
    const baseY = absoluteY ? yOrHeight : yOrHeight / 2;
    for (const fragment of this.fragments) {
      if (spawned >= fragmentLimit) break;
      if (fragment.active) continue;
      fragment.active = true;
      fragment.vacuum = false;
      fragment.vacuumHoming = 0;
      fragment.vacuumAge = 0;
      fragment.mesh.visible = true;
      fragment.mesh.position.set(
        x + rand(-1, 1),
        baseY + rand(0, 0.5),
        z + rand(-0.6, 0.6),
      );
      const greenSmash =
        color === 0x55ff99 ||
        color === 0x88ff66 ||
        color === 0x62d477 ||
        color === 0x44dd88;
      fragment.velocity.set(
        rand(greenSmash ? -3.4 : -2.5, greenSmash ? 3.4 : 2.5) * power,
        rand(1.5, 5.5) * power,
        rand(greenSmash ? -4.2 : -3, greenSmash ? -0.35 : 1) * power,
      );
      fragment.spin.set(rand(-8, 8) * power, rand(-8, 8) * power, rand(-8, 8) * power);
      fragment.mesh.rotation.set(rand(0, Math.PI * 2), rand(0, Math.PI * 2), 0);
      fragment.baseScale =
        rand(0.5, 1) * (greenSmash ? GREEN_SMASH_FRAGMENT_SCALE_MUL : 1);
      fragment.opacityScale =
        greenSmash ? GREEN_SMASH_FRAGMENT_OPACITY_MUL : 1;
      fragment.mesh.scale.setScalar(fragment.baseScale);
      fragment.life = rand(0.4, 0.7);
      fragment.maxLife = fragment.life;
      fragment.material.opacity = 1;
      fragment.material.color.set(color);
      spawned++;
    }
  }

  private spawnVacuumEnergy(
    centerX: number,
    centerZ: number,
    centerY: number,
    spreadW: number,
    spreadH: number,
  ): void {
    let spawned = 0;
    const limit = 14;
    for (const fragment of this.fragments) {
      if (spawned >= limit) break;
      if (fragment.active) continue;
      const offsetX = rand(-spreadW * 0.44, spreadW * 0.44);
      const offsetY = rand(-spreadH * 0.18, spreadH * 0.38);
      const offsetZ = rand(0.04, spreadW * 0.14);
      const dirX = offsetX / Math.max(spreadW * 0.22, 0.01);
      const burstPower = rand(1.7, 3.1);
      fragment.active = true;
      fragment.vacuum = true;
      fragment.vacuumHoming = 0;
      fragment.vacuumAge = 0;
      fragment.mesh.visible = true;
      fragment.mesh.position.set(
        centerX + offsetX,
        centerY + offsetY,
        centerZ + offsetZ,
      );
      fragment.velocity.set(
        dirX * burstPower + rand(-0.55, 0.55),
        rand(1.1, 3.2) + Math.max(0, offsetY) * 0.35,
        rand(0.35, 1.15),
      );
      fragment.spin.set(rand(-5, 5), rand(-5, 5), rand(-5, 5));
      fragment.mesh.rotation.set(rand(0, Math.PI * 2), rand(0, Math.PI * 2), 0);
      fragment.baseScale = rand(
        GREEN_VACUUM_FRAGMENT_SCALE_MIN,
        GREEN_VACUUM_FRAGMENT_SCALE_MAX,
      );
      fragment.opacityScale = 1;
      fragment.mesh.scale.setScalar(fragment.baseScale);
      fragment.life = rand(VACUUM_LIFE_MIN, VACUUM_LIFE_MAX);
      fragment.maxLife = fragment.life;
      fragment.material.opacity = 1;
      fragment.material.color.set(0x55ff99);
      spawned++;
    }
  }

  private updateFragments(
    dt: number,
    playerX: number,
    playerY: number,
    scrollSpeed: number,
  ): void {
    for (const fragment of this.fragments) {
      if (!fragment.active) continue;
      fragment.life -= dt;
      if (fragment.life <= 0) {
        fragment.active = false;
        fragment.vacuum = false;
        fragment.mesh.visible = false;
        continue;
      }
      if (fragment.vacuum) {
        fragment.vacuumAge += dt;
        const scroll = Math.max(scrollSpeed, 8);
        const burstPhase = fragment.vacuumAge < VACUUM_BURST_SECONDS;
        const behindPlayer = fragment.mesh.position.z < VACUUM_BEHIND_Z;
        const homingActive =
          !burstPhase &&
          (behindPlayer || fragment.vacuumAge >= VACUUM_HOMING_FALLBACK);
        if (!homingActive) {
          const scrollScale = burstPhase ? 0.18 : 1;
          fragment.mesh.position.z -= scroll * dt * scrollScale;
          fragment.velocity.y -= FRAGMENT_GRAVITY * (burstPhase ? 0.12 : 0.22) * dt;
          fragment.velocity.multiplyScalar(burstPhase ? 0.985 : 0.96);
        } else {
          fragment.vacuumHoming = Math.min(1, fragment.vacuumHoming + dt / VACUUM_HOMING_RAMP);
          const homingT = smoothstep01(fragment.vacuumHoming);
          const targetZ = 0.18;
          const dx = playerX - fragment.mesh.position.x;
          const dy = playerY - fragment.mesh.position.y;
          const dz = targetZ - fragment.mesh.position.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < VACUUM_COLLECT_RADIUS) {
            fragment.active = false;
            fragment.vacuum = false;
            fragment.mesh.visible = false;
            this.smashVacuumGlow = Math.max(this.smashVacuumGlow, 0.85);
            continue;
          }
          const catchSpeed = lerp(8, 30, homingT);
          const step = Math.min(1, catchSpeed * dt);
          fragment.mesh.position.x += dx * step;
          fragment.mesh.position.y += dy * step;
          fragment.mesh.position.z += dz * step;
          fragment.velocity.set(0, 0, 0);
          fragment.material.color.setRGB(
            0.28 + homingT * 0.05,
            0.95 + homingT * 0.05,
            0.55 + homingT * 0.15,
          );
        }
      } else {
        fragment.velocity.y -= FRAGMENT_GRAVITY * dt;
      }
      if (!fragment.vacuum || fragment.vacuumHoming <= 0) {
        fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      }
      fragment.mesh.rotation.x += fragment.spin.x * dt;
      fragment.mesh.rotation.y += fragment.spin.y * dt;
      fragment.mesh.rotation.z += fragment.spin.z * dt;
      const t = fragment.life / fragment.maxLife;
      fragment.material.opacity = fragment.vacuum
        ? Math.min(0.72, 0.42 + t * 0.3 + (fragment.vacuumHoming > 0 ? 0.14 : 0))
        : t * fragment.opacityScale;
      fragment.mesh.scale.setScalar(fragment.baseScale * (0.3 + 0.7 * t));
    }
  }

  private addSideEnvironmentDecor(): void {
    const materials: SideDecorMaterials = {
      carMetal: new THREE.MeshStandardMaterial({
        color: 0x51565c,
        roughness: 0.82,
        metalness: 0.28,
      }),
      carDark: new THREE.MeshStandardMaterial({
        color: 0x30353a,
        roughness: 0.9,
      }),
      carSign: new THREE.MeshStandardMaterial({
        color: 0x465466,
        roughness: 0.86,
      }),
      lamp: new THREE.MeshStandardMaterial({
        color: 0x77715f,
        emissive: 0x302b1c,
        emissiveIntensity: 0.28,
        roughness: 0.75,
      }),
      cactus: new THREE.MeshStandardMaterial({
        color: 0x35513b,
        roughness: 1,
      }),
      earth: new THREE.MeshStandardMaterial({
        color: 0x493426,
        roughness: 1,
      }),
      rock: new THREE.MeshStandardMaterial({
        color: 0x574536,
        roughness: 1,
      }),
      wood: new THREE.MeshStandardMaterial({
        color: 0x68472d,
        roughness: 0.95,
      }),
    };
    const laneSpacing = this.lanePositions.length > 1
      ? Math.abs(this.lanePositions[1] - this.lanePositions[0])
      : 1.92;
    const roadEdge =
      Math.max(...this.lanePositions.map((position) => Math.abs(position))) +
      laneSpacing * 0.5;

    for (let index = 0; index < SIDE_DECOR_COUNT; index++) {
      for (const side of [-1, 1]) {
        const carGroup = this.createCarSideDecor(index, side, roadEdge, materials);
        carGroup.position.z = index * SIDE_DECOR_SPACING;
        this.carSideDecorGroups.push(carGroup);
        this.scene.add(carGroup);

        const horseGroup = this.createHorseSideDecor(index, side, roadEdge, materials);
        horseGroup.position.z =
          index * SIDE_DECOR_SPACING + (side > 0 ? SIDE_DECOR_SPACING * 0.5 : 0);
        this.horseSideDecorGroups.push(horseGroup);
        this.scene.add(horseGroup);
      }
    }
    this.updateSideEnvironmentDecor();
  }

  private createCarSideDecor(
    index: number,
    side: number,
    roadEdge: number,
    materials: SideDecorMaterials,
  ): THREE.Group {
    const group = new THREE.Group();
    const guardX = side * (roadEdge + 0.85);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.26, SIDE_DECOR_GUARD_LENGTH),
      materials.carMetal,
    );
    rail.position.set(guardX, 0.7, 0);
    group.add(rail);
    for (const z of [-2.7, 2.7]) {
      const support = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.72, 0.14),
        materials.carDark,
      );
      support.position.set(guardX, 0.3, z);
      group.add(support);
    }

    if (index % 2 === 0) {
      const lampX = side * (roadEdge + 2.2);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8),
        materials.carDark,
      );
      pole.position.set(lampX, 2.1, -1.1);
      group.add(pole);
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.08, 0.1),
        materials.carDark,
      );
      arm.position.set(lampX - side * 0.3, 4.16, -1.1);
      group.add(arm);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.14, 0.32),
        materials.lamp,
      );
      lamp.position.set(lampX - side * 0.62, 4.08, -1.1);
      group.add(lamp);
    }

    const billboardSide = index % 8 === 1 ? -1 : 1;
    const signSide = index % 8 === 3 ? 1 : -1;
    if (index % 4 === 1 && side === billboardSide) {
      const billboardX = side * (roadEdge + 5.4);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 1.45, 0.2),
        materials.carSign,
      );
      panel.position.set(billboardX, 2.15, 0.4);
      group.add(panel);
      for (const xOffset of [-0.92, 0.92]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 1.6, 0.12),
          materials.carDark,
        );
        post.position.set(billboardX + xOffset, 0.8, 0.4);
        group.add(post);
      }
    } else if (index % 4 === 3 && side === signSide) {
      const signX = side * (roadEdge + 3.5);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 1.75, 7),
        materials.carDark,
      );
      post.position.set(signX, 0.88, 0.8);
      group.add(post);
      const sign = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.12, 8),
        materials.carSign,
      );
      sign.rotation.x = Math.PI / 2;
      sign.position.set(signX, 1.82, 0.8);
      group.add(sign);
    }

    return group;
  }

  private createHorseSideDecor(
    index: number,
    side: number,
    roadEdge: number,
    materials: SideDecorMaterials,
  ): THREE.Group {
    const group = new THREE.Group();
    const variant = (index + (side > 0 ? 2 : 0)) % 4;

    if (variant === 0) {
      const cactusX = side * (roadEdge + 2.2);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, 2.25, 7),
        materials.cactus,
      );
      trunk.position.set(cactusX, 1.12, 0);
      group.add(trunk);
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.16, 0.18),
        materials.cactus,
      );
      arm.position.set(cactusX - side * 0.22, 1.08, 0);
      group.add(arm);
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.13, 0.72, 7),
        materials.cactus,
      );
      tip.position.set(cactusX - side * 0.5, 1.38, 0);
      group.add(tip);
    } else if (variant === 1) {
      const hillX = side * (roadEdge + 7.2);
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(3.4, 1.85, 7),
        materials.earth,
      );
      hill.scale.x = 1.45;
      hill.position.set(hillX, 0.88, 0.8);
      hill.rotation.y = index * 0.31;
      group.add(hill);
      const ridge = new THREE.Mesh(
        new THREE.ConeGeometry(2.15, 1.25, 6),
        materials.earth,
      );
      ridge.position.set(hillX - side * 2.8, 0.58, 1.2);
      ridge.rotation.y = 0.4 + index * 0.17;
      group.add(ridge);
    } else if (variant === 2) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.82, 0),
        materials.rock,
      );
      rock.scale.set(1.45, 0.82, 1);
      rock.position.set(side * (roadEdge + 3.15), 0.58, -0.5);
      rock.rotation.set(0.12, index * 0.5, side * 0.08);
      group.add(rock);
    } else {
      const crateX = side * (roadEdge + 2.0);
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9),
        materials.wood,
      );
      crate.position.set(crateX, 0.45, 0.2);
      crate.rotation.y = side * 0.12;
      group.add(crate);
      const topCrate = new THREE.Mesh(
        new THREE.BoxGeometry(0.68, 0.68, 0.68),
        materials.wood,
      );
      topCrate.position.set(crateX + side * 0.12, 1.22, 0.12);
      topCrate.rotation.y = -side * 0.18;
      group.add(topCrate);
    }

    return group;
  }

  private updateSideEnvironmentDecor(): void {
    const { carPresence, horsePresence } =
      resolveEnvironmentGroundTransition(this.sideEnvironmentBlend);
    const carY = -SIDE_DECOR_HIDE_DEPTH * (1 - carPresence);
    const horseY = -SIDE_DECOR_HIDE_DEPTH * (1 - horsePresence);
    for (const group of this.carSideDecorGroups) {
      group.position.y = carY;
      group.visible = carPresence > 0.005;
    }
    for (const group of this.horseSideDecorGroups) {
      group.position.y = horseY;
      group.visible = horsePresence > 0.005;
    }
  }

  private scrollSideEnvironment(dz: number): void {
    const threshold = -this.opts.positionZ - SIDE_DECOR_SPACING;
    for (const group of [...this.carSideDecorGroups, ...this.horseSideDecorGroups]) {
      group.position.z -= dz;
      if (group.position.z < threshold) {
        group.position.z += SIDE_DECOR_SPAN;
      }
    }
  }

  private addParallaxClouds(): void {
    const farCount = 8;
    const farX = [-13, -7, 1, 9, 14, -10, 5, 12];
    const farY = [5.4, 6.05, 5.72, 6.32, 5.55, 6.18, 5.88, 6.42];
    for (let index = 0; index < farCount; index++) {
      const group = this.createCloudMesh(this.farCloudMaterial, 1.45 + (index % 3) * 0.18);
      group.position.set(
        farX[index],
        farY[index],
        12 + index * (CLOUD_FAR_SPAN / farCount),
      );
      this.cloudLayers.push({
        group,
        speedScale: CLOUD_FAR_SPEED_SCALE,
        span: CLOUD_FAR_SPAN,
        screenYOffset: farY[index],
      });
      this.scene.add(group);
    }

    const nearCount = 7;
    const nearX = [-10, -4, 3, 10, 13, -7, 7];
    const nearY = [3.45, 4.02, 3.7, 4.25, 3.58, 4.12, 3.82];
    for (let index = 0; index < nearCount; index++) {
      const group = this.createCloudMesh(this.nearCloudMaterial, 0.9 + (index % 2) * 0.16);
      group.position.set(
        nearX[index],
        nearY[index],
        5 + index * (CLOUD_NEAR_SPAN / nearCount),
      );
      this.cloudLayers.push({
        group,
        speedScale: CLOUD_NEAR_SPEED_SCALE,
        span: CLOUD_NEAR_SPAN,
        screenYOffset: nearY[index],
      });
      this.scene.add(group);
    }
  }

  private createCloudMesh(
    material: THREE.MeshBasicMaterial,
    scale: number,
  ): THREE.Group {
    const group = new THREE.Group();
    const geometry = new THREE.SphereGeometry(1, 8, 5);
    const parts = [
      { x: -1.45, y: -0.05, z: 0.08, sx: 1.75, sy: 0.42, sz: 0.68 },
      { x: 0, y: 0.18, z: 0, sx: 2.1, sy: 0.58, sz: 0.78 },
      { x: 1.55, y: -0.08, z: -0.04, sx: 1.55, sy: 0.38, sz: 0.62 },
    ];
    for (const part of parts) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(part.x * scale, part.y * scale, part.z * scale);
      mesh.scale.set(part.sx * scale, part.sy * scale, part.sz * scale);
      group.add(mesh);
    }
    return group;
  }

  private updateParallaxCloudAppearance(): void {
    this.farCloudMaterial.color
      .copy(this.cloudCarColor)
      .lerp(this.cloudHorseColor, this.horseEnvironmentBlend)
      .lerp(this.cloudRocketColor, this.rocketEnvironmentBlend);
    this.nearCloudMaterial.color.copy(this.farCloudMaterial.color).multiplyScalar(1.07);
    const rocketDim = 1 - this.rocketEnvironmentBlend * 0.24;
    this.farCloudMaterial.opacity = 0.035 * rocketDim;
    this.nearCloudMaterial.opacity = 0.055 * rocketDim;
  }

  private scrollParallaxClouds(dz: number): void {
    const threshold = -this.opts.positionZ - 12;
    for (const cloud of this.cloudLayers) {
      cloud.group.position.y = this.camera.position.y + cloud.screenYOffset;
      cloud.group.position.z -= dz * cloud.speedScale;
      if (cloud.group.position.z < threshold) {
        cloud.group.position.z += cloud.span;
      }
    }
  }

  private addLaneStrips(): void {
    this.laneMaterial = new THREE.MeshStandardMaterial({ color: 0x33333c });
    for (let i = 0; i < this.lanePositions.length - 1; i++) {
      const boundary = (this.lanePositions[i] + this.lanePositions[i + 1]) / 2;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 400), this.laneMaterial);
      strip.position.set(boundary, 0.01, 0);
      this.scene.add(strip);
    }
  }

  private addDashes(): void {
    this.dashMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2c36, emissive: 0x2244aa });
    for (let lane = 0; lane < this.lanePositions.length; lane++) {
      for (let i = 0; i < DASH_COUNT; i++) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 1.2), this.dashMaterial);
        dash.position.set(this.lanePositions[lane], 0.005, i * DASH_SPACING);
        this.dashMeshes.push(dash);
        this.scene.add(dash);
      }
    }
  }

  private addRocketRailDashes(): void {
    for (let lane = 0; lane < this.lanePositions.length; lane++) {
      for (let i = 0; i < ROCKET_RAIL_DASH_COUNT; i++) {
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.02, 0.85),
          this.rocketRailMaterial,
        );
        dash.visible = false;
        dash.position.z = i * ROCKET_RAIL_DASH_SPACING;
        this.rocketRailDashMeshes[lane].push(dash);
        this.scene.add(dash);
      }
    }
  }

  private scrollRocketRailDashes(snapshot: GameSnapshot, dz: number): void {
    const player = snapshot.player;
    const active =
      player.mode === 'rocket' &&
      player.rocketPhase !== 'fall' &&
      player.rocketPhase !== 'none';
    const blend = active ? this.rocketCameraBlend : 0;
    const y = this.rocketCfg.peakHeight;
    this.rocketRailMaterial.opacity = 0.14 + blend * 0.18;
    for (let lane = 0; lane < this.lanePositions.length; lane++) {
      const x = this.lanePositions[lane];
      for (const dash of this.rocketRailDashMeshes[lane]) {
        dash.visible = active;
        if (!active) continue;
        dash.position.z -= dz;
        if (dash.position.z < -this.opts.positionZ - 1) {
          dash.position.z += ROCKET_RAIL_DASH_SPAN;
        }
        dash.position.x = x;
        dash.position.y = y;
      }
    }
  }

  private scrollDashes(dz: number): void {
    for (const dash of this.dashMeshes) {
      dash.position.z -= dz;
      if (dash.position.z < -this.opts.positionZ - 1) {
        dash.position.z += DASH_SPAN;
      }
    }
  }

  private viewportWidth(): number {
    return window.innerWidth;
  }

  private viewportHeight(): number {
    return window.innerHeight;
  }
}

function makeWedgeGeometry(width: number, depth: number, height: number): THREE.BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  const vertices = new Float32Array([
    -hw, 0, hd, hw, 0, hd, hw, 0, -hd, -hw, 0, hd, hw, 0, -hd, -hw, 0, -hd,
    -hw, 0, hd, hw, 0, hd, -hw, height, -hd,
    hw, 0, hd, hw, height, -hd, -hw, height, -hd,
    -hw, height, -hd, hw, height, -hd, hw, 0, -hd, -hw, height, -hd, hw, 0, -hd, -hw, 0, -hd,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildRadialBlurShader(cfg: GameConfig['postfx']): {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
} {
  const samples = cfg.samples;
  return {
    uniforms: {
      tDiffuse: { value: null },
      uIntensity: { value: 0 },
      uInner: { value: cfg.blurInner },
      uOuter: { value: cfg.blurOuter },
      uSpread: { value: cfg.blurSpread },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uIntensity;
      uniform float uInner;
      uniform float uOuter;
      uniform float uSpread;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - 0.5;
        float dist = length(dir);
        float edge = smoothstep(uInner, uOuter, dist);
        float amount = clamp(edge * uIntensity, 0.0, 1.0);
        vec2 delta = dir / max(dist, 1e-5) * amount * uSpread;
        vec4 original = texture2D(tDiffuse, vUv);
        vec4 sum = original;
        for (int i = 1; i <= ${samples}; i++) {
          float f = float(i);
          vec2 outUv = clamp(vUv + delta * f, 0.0, 1.0);
          vec2 inUv = clamp(vUv - delta * f, 0.0, 1.0);
          sum += texture2D(tDiffuse, outUv);
          sum += texture2D(tDiffuse, inUv);
        }
        vec4 blurred = sum / float(${samples} * 2 + 1);
        gl_FragColor = mix(original, blurred, amount);
      }
    `,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function topDownRocketLook(player: GameSnapshot['player']): number {
  if (player.mode !== 'rocket') return 0;
  if (
    player.rocketPhase === 'launch' ||
    player.rocketPhase === 'plateau' ||
    player.rocketPhase === 'cruise'
  ) {
    return 1;
  }
  return 0;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
