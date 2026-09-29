import type { EnvironmentConfig, VehicleConfig } from "./types";
import { clamp } from "./math";

/** Defaults taken from the spec examples. */
export const DEFAULT_ENV: EnvironmentConfig = {
  roadWidth: 3.72,
  houseWidth: 2.8,
  houseDepth: 10.0,
  garageDoorWidth: 2.6,
  drivewayDepth: 0.0,
};

export const DEFAULT_VEHICLE: VehicleConfig = {
  vehicleLength: 4.2,
  vehicleWidth: 1.8,
  wheelbase: 2.6,
  frontOverhang: 0.9,
  turningRadius: 5.2,
  steeringRate: 25,
  steeringReturnRate: 40,
};

export interface VehiclePreset {
  id: string;
  label: string;
  config: VehicleConfig;
}

/**
 * One-click vehicle geometries.
 *
 * Every car here is a small hatchback, so the front overhang is longer than the
 * rear one and it is what limits a garage entry. Only the Hyundai Grand i10
 * publishes its overhangs; the others are estimated at 55% of the total
 * overhang (`length - wheelbase`), which is the ratio the Grand i10 actually
 * has (715 / 1305 = 0.548). The Suzuki Swift uses the published ratio of the
 * previous-generation car (820 / 600), whose wheelbase-to-length ratio is
 * almost identical. Adjust "Front overhang" in the panel if you measure yours.
 */
export const VEHICLE_PRESETS: ReadonlyArray<VehiclePreset> = [
  // { id: "example", label: "Example 4.2 m", config: DEFAULT_VEHICLE },
  {
    id: "fadil",
    label: "VinFast Fadil",
    config: {
      // 3676 x 1632, wheelbase 2385, min turning radius 5.0 m (VinFast).
      vehicleLength: 3.676,
      vehicleWidth: 1.632,
      wheelbase: 2.385,
      frontOverhang: 0.71,
      turningRadius: 5.0,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
  {
    id: "i10",
    label: "Hyundai Grand i10",
    config: {
      // 3815 x 1680, wheelbase 2450, min turning radius 4.9 m.
      // Front/rear overhang 715 / 650 mm are PUBLISHED figures.
      vehicleLength: 3.815,
      vehicleWidth: 1.68,
      wheelbase: 2.45,
      frontOverhang: 0.715,
      turningRadius: 4.9,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
  {
    id: "wigo",
    label: "Toyota Wigo",
    config: {
      // 3760 x 1665, wheelbase 2525, min turning radius 4.6 m.
      vehicleLength: 3.76,
      vehicleWidth: 1.665,
      wheelbase: 2.525,
      frontOverhang: 0.679,
      turningRadius: 4.6,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
  {
    id: "brio",
    label: "Honda Brio",
    config: {
      // 3800 x 1680, wheelbase 2405, turning radius 4.6 m "at wheel centre".
      vehicleLength: 3.8,
      vehicleWidth: 1.68,
      wheelbase: 2.405,
      frontOverhang: 0.767,
      turningRadius: 4.6,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
  {
    id: "mazda2",
    label: "Mazda2 Sport",
    config: {
      // 4080 x 1695, wheelbase 2570, min turning radius 4.7 m.
      vehicleLength: 4.08,
      vehicleWidth: 1.695,
      wheelbase: 2.57,
      frontOverhang: 0.831,
      turningRadius: 4.7,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
  {
    id: "swift",
    label: "Suzuki Swift",
    config: {
      // 3860 x 1735, wheelbase 2450, kerb-to-kerb circle 9600 mm (radius 4.8).
      vehicleLength: 3.86,
      vehicleWidth: 1.735,
      wheelbase: 2.45,
      frontOverhang: 0.815,
      turningRadius: 4.8,
      steeringRate: 25,
      steeringReturnRate: 40,
    },
  },
];

/** Global tuning constants for the prototype. */
export const SIM = {
  /** Forward / reverse speed limits (m/s). Kept low so the car is easy to steer. */
  maxForwardSpeed: 3.5,
  maxReverseSpeed: 1.5,
  /** Longitudinal accelerations (m/s^2). */
  forwardAccel: 2.4,
  reverseAccel: 1.8,
  /** Braking when the opposite direction is pressed while moving (m/s^2). */
  brakeDecel: 6.0,
  /** Passive deceleration while coasting (m/s^2). */
  coastDecel: 1.6,
  /** Steering bounds. Angles/rates are in degrees. */
  minSteeringAngle: 1,
  maxSteeringAngle: 45,
  minSteeringRate: 5,
  maxSteeringRate: 720,
  /** Fixed physics timestep and frame clamp. */
  physicsDt: 1 / 120,
  maxFrameDt: 0.05,
  /** Thickness of the collision wall bands around the house (m). */
  wallThickness: 0.16,
  /** Minimum distance between recorded trajectory points (m). */
  trailMinStep: 0.06,
  /** Camera limits (pixels per metre). */
  minZoom: 4,
  maxZoom: 320,
  /** Wheel rendering size (m). */
  wheelLength: 0.62,
  wheelWidth: 0.22,
} as const;

function positive(value: number, fallback: number, min: number): number {
  return Number.isFinite(value) && value >= min ? value : fallback;
}

/** Clamp user input into a physically sensible environment configuration. */
export function sanitizeEnvironment(
  input: Partial<EnvironmentConfig>,
): EnvironmentConfig {
  const houseWidth = positive(
    input.houseWidth ?? DEFAULT_ENV.houseWidth,
    DEFAULT_ENV.houseWidth,
    0.5,
  );
  const garageDoorWidth = clamp(
    positive(
      input.garageDoorWidth ?? DEFAULT_ENV.garageDoorWidth,
      DEFAULT_ENV.garageDoorWidth,
      0.3,
    ),
    0.3,
    houseWidth,
  );
  return {
    roadWidth: positive(
      input.roadWidth ?? DEFAULT_ENV.roadWidth,
      DEFAULT_ENV.roadWidth,
      0.5,
    ),
    houseWidth,
    houseDepth: positive(
      input.houseDepth ?? DEFAULT_ENV.houseDepth,
      DEFAULT_ENV.houseDepth,
      0.5,
    ),
    garageDoorWidth,
    drivewayDepth: positive(
      input.drivewayDepth ?? DEFAULT_ENV.drivewayDepth,
      DEFAULT_ENV.drivewayDepth,
      0,
    ),
  };
}

/**
 * Clamp user input into a physically sensible vehicle configuration.
 */
export function sanitizeVehicle(input: Partial<VehicleConfig>): VehicleConfig {
  const fallback = DEFAULT_VEHICLE;
  const vehicleLength = positive(
    input.vehicleLength ?? fallback.vehicleLength,
    fallback.vehicleLength,
    0.5,
  );
  const wheelbase = clamp(
    positive(input.wheelbase ?? fallback.wheelbase, fallback.wheelbase, 0.3),
    0.3,
    Math.max(vehicleLength - 0.05, 0.3),
  );

  return {
    vehicleLength,
    wheelbase,
    vehicleWidth: positive(
      input.vehicleWidth ?? fallback.vehicleWidth,
      fallback.vehicleWidth,
      0.3,
    ),
    // Rear overhang is derived, so the front one is bounded by what is left.
    frontOverhang: clamp(
      positive(
        input.frontOverhang ?? fallback.frontOverhang,
        fallback.frontOverhang,
        0,
      ),
      0,
      Math.max(vehicleLength - wheelbase, 0),
    ),
    turningRadius: Math.max(
      positive(
        input.turningRadius ?? fallback.turningRadius,
        fallback.turningRadius,
        0.5,
      ),
      wheelbase + 0.1,
    ),
    steeringRate: clamp(
      positive(
        input.steeringRate ?? fallback.steeringRate,
        fallback.steeringRate,
        SIM.minSteeringRate,
      ),
      SIM.minSteeringRate,
      SIM.maxSteeringRate,
    ),
    steeringReturnRate: clamp(
      positive(
        input.steeringReturnRate ?? fallback.steeringReturnRate,
        fallback.steeringReturnRate,
        SIM.minSteeringRate,
      ),
      SIM.minSteeringRate,
      SIM.maxSteeringRate,
    ),
  };
}
