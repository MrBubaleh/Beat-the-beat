export interface FxSwitches {
  fog: boolean;
  sky: boolean;
  vignette: boolean;
  fov: boolean;
  blur: boolean;
  shake: boolean;
  wind: boolean;
  pulse: boolean;
}

export function createFxSwitches(): FxSwitches {
  return {
    fog: true,
    sky: true,
    vignette: true,
    fov: true,
    blur: true,
    shake: true,
    wind: true,
    pulse: true,
  };
}
