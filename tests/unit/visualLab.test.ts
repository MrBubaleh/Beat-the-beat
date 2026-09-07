import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRESET_OPTIONS,
  FIRST_PERSON_CAMERA_BLEND_SECONDS,
  FIRST_PERSON_CAMERA_FOV,
  createVisualLabSettings,
  getCameraPresetOffsets,
  isCameraPresetId,
} from '../../src/app/visualLab';

describe('visual lab camera presets', () => {
  it('keeps firstPerson as the default camera', () => {
    expect(createVisualLabSettings().cameraPresetId).toBe('firstPerson');
  });

  it('exposes the first-person preset and its transition anchors', () => {
    expect(CAMERA_PRESET_OPTIONS).toContainEqual(
      expect.objectContaining({
        id: 'firstPerson',
        label: 'от 1-го лица',
      }),
    );
    expect(isCameraPresetId('firstPerson')).toBe(true);
    expect(getCameraPresetOffsets('firstPerson')).toBeDefined();
    expect(FIRST_PERSON_CAMERA_FOV).toBe(78);
    expect(FIRST_PERSON_CAMERA_BLEND_SECONDS).toBe(0.4);
  });
});
