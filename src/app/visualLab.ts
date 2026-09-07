export type CameraPresetId =
  | 'default'
  | 'overview'
  | 'corridor'
  | 'chase'
  | 'low'
  | 'firstPerson';

export const FIRST_PERSON_CAMERA_FOV = 78;
export const FIRST_PERSON_CAMERA_BLEND_SECONDS = 0.4;
export const FIRST_PERSON_HORSE_EXIT_BLEND_SECONDS = 0.85;
export const FIRST_PERSON_HORSE_OVERDRIVE_DIP_SECONDS = 0.3;
export const FIRST_PERSON_HORSE_OVERDRIVE_CAM_Y = 0.1;
export const FIRST_PERSON_HORSE_OVERDRIVE_MODEL_Y = -0.26;
export const FIRST_PERSON_HORSE_OVERDRIVE_MODEL_PITCH = 0.07;
export const FIRST_PERSON_HORSE_OVERDRIVE_FOV_BOOST = 5;
export const FIRST_PERSON_HORSE_OVERDRIVE_GAIT_SHAKE_MUL = 0.08;
export const FIRST_PERSON_HORSE_BLUE_GAIT_SHAKE_MUL = 0.08;
export const FIRST_PERSON_HORSE_OVERDRIVE_GAIT_RATE_BOOST = 0.55;
export const HORSE_COIN_FRAGMENT_SCALE = 0.65;

export interface CameraPresetOffsets {
  positionY: number;
  positionZ: number;
  lookY: number;
  lookZ: number;
}

export interface CameraPresetOption {
  id: CameraPresetId;
  label: string;
  offsets: CameraPresetOffsets;
}

export interface VisualLabSettings {
  cameraPresetId: CameraPresetId;
  contactShadow: boolean;
}

export const CAMERA_PRESET_OPTIONS: readonly CameraPresetOption[] = [
  {
    id: 'default',
    label: 'база',
    offsets: { positionY: 0, positionZ: 0, lookY: 0, lookZ: 0 },
  },
  {
    id: 'overview',
    label: 'обзор',
    offsets: { positionY: 0.9, positionZ: 2.8, lookY: -0.4, lookZ: 0 },
  },
  {
    id: 'corridor',
    label: 'коридор',
    offsets: { positionY: -1.5, positionZ: -3.5, lookY: -0.55, lookZ: 2.6 },
  },
  {
    id: 'chase',
    label: 'погоня',
    offsets: { positionY: -0.75, positionZ: -2.0, lookY: -0.3, lookZ: 1.5 },
  },
  {
    id: 'low',
    label: 'низко',
    offsets: { positionY: -2.1, positionZ: -4.9, lookY: -0.5, lookZ: 3.4 },
  },
  {
    id: 'firstPerson',
    label: 'от 1-го лица',
    offsets: { positionY: -2.1, positionZ: -4.9, lookY: -0.5, lookZ: 3.4 },
  },
];

export function createVisualLabSettings(): VisualLabSettings {
  return {
    cameraPresetId: 'firstPerson',
    contactShadow: true,
  };
}

export function isCameraPresetId(id: string): id is CameraPresetId {
  return CAMERA_PRESET_OPTIONS.some((preset) => preset.id === id);
}

export function getCameraPresetOffsets(id: CameraPresetId): CameraPresetOffsets {
  const preset = CAMERA_PRESET_OPTIONS.find((entry) => entry.id === id);
  return preset?.offsets ?? CAMERA_PRESET_OPTIONS[0].offsets;
}
