import { z } from 'zod';
import { SFX_IDS, SFX_BUSES } from './types';

const positive = (max: number) => z.number().finite().positive().max(max);
const range = (min: number, max: number) => z.number().finite().min(min).max(max);
const patchSchema = z.object({
  bus: z.enum(SFX_BUSES), priority: range(0, 100),
  gain: range(0, 1), attackMs: positive(500), decayMs: positive(1000),
  tailMs: positive(1000), bodyHz: range(25, 5000), endHz: range(25, 5000),
  filterHz: range(80, 16000), filterEndHz: range(80, 16000), q: range(0.1, 5),
  toneMix: range(0, 1), noiseMix: range(0, 1),
  partials: z.array(range(1, 6)).min(1).max(4),
  jitterCents: range(0, 200), cooldownMs: range(0, 5000),
  maxVoices: z.number().int().min(1).max(12),
  strengthGain: range(0, 1), speedPitch: range(0, 0.5),
});
const profileSchema = z.object({
  minSpeed: range(0, 100), maxSpeed: positive(150),
  motorGain: range(0, 0.3), windGain: range(0, 0.3),
  baseHz: range(25, 400), maxHz: range(25, 800), filterHz: range(100, 6000),
}).refine(v => v.maxSpeed > v.minSpeed && v.maxHz >= v.baseHz);
export const sfxConfigSchema = z.object({
  enabled: z.boolean(), masterGain: range(0, 1),
  queueCapacity: z.number().int().min(8).max(512),
  maxVoices: z.number().int().min(1).max(24), maxPickupVoices: z.number().int().min(1).max(12), maxRetiring: z.number().int().min(0).max(8),
  staleMs: range(20, 1000), fadeMs: range(5, 100), smoothingMs: range(10, 500),
  ladder: z.object({ steps: z.number().int().min(1).max(6), stepCents: range(0, 200), resetMs: range(100, 1500) }),
  duck: z.object({
    movementDb: range(-18, 0), pickupDb: range(-18, 0), foleyDb: range(-18, 0),
    abilityMovementDb: range(-18, 0), holdMs: range(0, 500), releaseMs: range(30, 1000),
  }),
  buses: z.object({ impact: range(0, 1), ability: range(0, 1), pickup: range(0, 1), movement: range(0, 1), foley: range(0, 1) }),
  profiles: z.object({ car: profileSchema, horse: profileSchema, rocket: profileSchema }),
  motion: z.object({
    accelerationScale: positive(100), cruiseLoad: range(0, 1), airLoad: range(0, 1),
    windMinHz: range(80, 5000), windMaxHz: range(100, 12000), thrustGain: range(0, 0.3),
    slideGain: range(0, 0.2), hoofMinHz: range(1, 12), hoofMaxHz: range(1, 14),
    tutorialPitchFloor: range(0.5, 1), panMax: range(0, 0.7),
  }).refine(v => v.hoofMaxHz >= v.hoofMinHz && v.windMaxHz >= v.windMinHz),
  rocketSample: z.object({
    gain: range(0, 4),
    fadeInMs: range(0, 3000),
    fadeOutMs: range(100, 5000),
  }).default({ gain: 1.11, fadeInMs: 0, fadeOutMs: 1290 }),
  levelSamples: z.object({
    engineStartGain: range(0, 4),
    fullRepairGain: range(0, 4),
  }).default({ engineStartGain: 1, fullRepairGain: 1 }),
  palette: z.object({
    hit: z.object({ contactHz: range(500, 8000), contactMix: range(0, 1), ringHz: range(100, 3000), ringMix: range(0, 1) }),
    canister: z.object({ valveHz: range(500, 8000), valveMix: range(0, 1), airHighpassHz: range(200, 4000), hold: range(0.1, 0.65), pressureMix: range(0, 1) }),
    smash: z.object({ crackHz: range(500, 10000), debrisMix: range(0, 1), fragments: z.number().int().min(2).max(6) }),
    coin: z.object({ fmRatio: range(1, 6), fmDepth: range(0, 3), shimmerMix: range(0, 1) }),
    hoof: z.object({ shellHz: range(200, 3000), shellMix: range(0, 1), soleMix: range(0, 1), contactGapMs: range(8, 60) }),
    motor: z.object({ exhaustMix: range(0, 1), intakeMix: range(0, 1), mechanicalMix: range(0, 1), drive: range(1, 6), roughness: range(0, 0.4), intakeQ: range(0.3, 4), idleFloor: range(0, 0.5) }),
  }),
  patches: z.object(Object.fromEntries(SFX_IDS.map(id => [id, patchSchema])) as Record<typeof SFX_IDS[number], typeof patchSchema>),
});
export type SfxConfig = z.infer<typeof sfxConfigSchema>;
export type SfxPatch = SfxConfig['patches'][typeof SFX_IDS[number]];
