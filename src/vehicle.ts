import type { Vec2, VehicleConfig, VehicleState } from "./types";
import { SIM } from "./config";
import { clamp, moveToward } from "./math";

/**
 * Front and rear overhang. The front is configured; the rear absorbs the
 * remainder of the length so the body always spans exactly `vehicleLength`
 * around the wheelbase.
 */
export function frontOverhang(config: VehicleConfig): number {
  return Math.max(config.frontOverhang, 0);
}

export function rearOverhang(config: VehicleConfig): number {
  return Math.max(config.vehicleLength - config.wheelbase - frontOverhang(config), 0);
}

/**
 * Steering lock in radians.
 *
 * The manufacturer `turningRadius` is kerb-to-kerb — measured to the outer
 * front wheel, not to the rear axle — so the rear-axle radius is
 *
 *   R_rear = sqrt(turningRadius^2 - wheelbase^2) - vehicleWidth / 2
 *
 * and the lock is `atan(wheelbase / R_rear)`. This reproduces the requested
 * radius exactly (see `turningGeometry().referenceRadius`).
 */
export function maxSteeringAngle(config: VehicleConfig): number {
  const halfWidth = config.vehicleWidth / 2;
  const inner = config.turningRadius * config.turningRadius - config.wheelbase * config.wheelbase;
  const rearAxleRadius = inner > 1e-6 ? Math.max(Math.sqrt(inner) - halfWidth, 0.05) : 0.05;
  const degrees = (Math.atan(config.wheelbase / rearAxleRadius) * 180) / Math.PI;
  return (clamp(degrees, SIM.minSteeringAngle, SIM.maxSteeringAngle) * Math.PI) / 180;
}

// ---------------------------------------------------------------- body frame
//
// Local coordinates are relative to the **rear axle centre**, with `+x`
// forward along the heading and `+y` to the vehicle's left.

export interface BodyRect {
  /** Forward offset of the front bumper. */
  front: number;
  /** Rearward offset of the rear bumper (negative). */
  rear: number;
  /** Half of `vehicleWidth`. */
  halfWidth: number;
}

export function localBodyRect(config: VehicleConfig): BodyRect {
  return {
    front: config.wheelbase + frontOverhang(config),
    rear: -rearOverhang(config),
    halfWidth: config.vehicleWidth / 2,
  };
}

export interface LocalWheel {
  /** Longitudinal offset from the rear axle. */
  x: number;
  /** Lateral offset, positive to the vehicle's left. */
  y: number;
  /** Front wheels steer. */
  steered: boolean;
}

export function localWheels(config: VehicleConfig): LocalWheel[] {
  const half = Math.max(config.vehicleWidth / 2 - SIM.wheelWidth / 2, 0.05);
  return [
    { x: config.wheelbase, y: half, steered: true },
    { x: config.wheelbase, y: -half, steered: true },
    { x: 0, y: half, steered: false },
    { x: 0, y: -half, steered: false },
  ];
}

/** Heading unit vectors in world space. */
export function headingBasis(heading: number): { forward: Vec2; left: Vec2 } {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return { forward: { x: cos, y: sin }, left: { x: sin, y: -cos } };
}

// ---------------------------------------------------------------- state ↔ world

export function createVehicleState(start: Vec2 & { heading: number }): VehicleState {
  return { x: start.x, y: start.y, heading: start.heading, speed: 0, steeringAngle: 0 };
}

/**
 * Centre of the body rectangle. With asymmetric overhangs this is **not** half a
 * wheelbase ahead of the rear axle — it is the midpoint of the two overhang
 * extents, which keeps the collision box aligned with `localBodyRect`.
 */
export function bodyCenter(state: VehicleState, config: VehicleConfig): Vec2 {
  const offset = (config.wheelbase + frontOverhang(config) - rearOverhang(config)) / 2;
  const { forward } = headingBasis(state.heading);
  return { x: state.x + forward.x * offset, y: state.y + forward.y * offset };
}

export function bodyCorners(state: VehicleState, config: VehicleConfig): Vec2[] {
  const rect = localBodyRect(config);
  const { forward, left } = headingBasis(state.heading);
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [rect.front, rect.halfWidth],
    [rect.front, -rect.halfWidth],
    [rect.rear, -rect.halfWidth],
    [rect.rear, rect.halfWidth],
  ];
  return offsets.map(([along, across]) => ({
    x: state.x + forward.x * along + left.x * across,
    y: state.y + forward.y * along + left.y * across,
  }));
}

// ------------------------------------------------------------- turning circles

export interface TurningGeometry {
  /** Steering lock used (rad). */
  steeringAngle: number;
  /** Radius traced by the rear axle — the model reference point. */
  rearAxleRadius: number;
  /** Radius traced by the outer front wheel (= the requested turning radius). */
  referenceRadius: number;
  /** Radius traced by the outermost body corner — the swept envelope. */
  wallToWallRadius: number;
}

export function turningGeometry(config: VehicleConfig): TurningGeometry {
  const steeringAngle = maxSteeringAngle(config);
  const rearAxleRadius = Math.abs(config.wheelbase / Math.tan(steeringAngle));
  const radiusAt = (x: number, y: number): number => Math.hypot(x, y + rearAxleRadius);
  const halfWidth = config.vehicleWidth / 2;

  return {
    steeringAngle,
    rearAxleRadius,
    referenceRadius: radiusAt(config.wheelbase, halfWidth),
    wallToWallRadius: radiusAt(config.wheelbase + frontOverhang(config), halfWidth),
  };
}

/** True when the requested turning radius needed a steering clamp. */
export function turningRadiusClamped(config: VehicleConfig): boolean {
  return Math.abs(turningGeometry(config).referenceRadius - config.turningRadius) > 1e-3;
}

// ---------------------------------------------------------------- dynamics

export interface SteeringInput {
  left: boolean;
  right: boolean;
}

/**
 * Continuous steering: ramps towards the lock while a key is held at
 * `steeringRate`, and self-centres at `steeringReturnRate` when released.
 */
export function updateSteering(
  state: VehicleState,
  config: VehicleConfig,
  steering: SteeringInput,
  dt: number,
): void {
  const direction = (steering.right ? 1 : 0) - (steering.left ? 1 : 0);
  const target = direction * maxSteeringAngle(config);
  const rateDeg = direction === 0 ? config.steeringReturnRate : config.steeringRate;
  const rateRad = (rateDeg * Math.PI) / 180;
  state.steeringAngle = moveToward(state.steeringAngle, target, rateRad * dt);
}

export interface ThrottleInput {
  forward: boolean;
  backward: boolean;
}

/**
 * Longitudinal dynamics. `W` accelerates forward, `S` accelerates in reverse
 * and pressing the opposite direction while moving acts as a brake. Releasing
 * both pedals coasts down to a stop through rolling resistance.
 */
export function updateThrottle(state: VehicleState, throttle: ThrottleInput, dt: number): void {
  if (throttle.forward && !throttle.backward) {
    if (state.speed < -0.02) {
      state.speed = moveToward(state.speed, 0, SIM.brakeDecel * dt);
    } else {
      state.speed += SIM.forwardAccel * dt;
    }
  } else if (throttle.backward && !throttle.forward) {
    if (state.speed > 0.02) {
      state.speed = moveToward(state.speed, 0, SIM.brakeDecel * dt);
    } else {
      state.speed -= SIM.reverseAccel * dt;
    }
  } else {
    state.speed = moveToward(state.speed, 0, SIM.coastDecel * dt);
  }

  state.speed = clamp(state.speed, -SIM.maxReverseSpeed, SIM.maxForwardSpeed);
}

/**
 * Kinematic bicycle model, rear-axle reference (Ackermann single-track):
 *
 *   theta' = v / wheelbase * tan(delta)
 *   x'     = v * cos(theta)
 *   y'     = v * sin(theta)
 *
 * Reverse (`v < 0`) naturally flips the yaw direction.
 */
export function integrateMotion(state: VehicleState, config: VehicleConfig, dt: number): void {
  const wheelbase = Math.max(config.wheelbase, 0.01);
  state.heading += (state.speed / wheelbase) * Math.tan(state.steeringAngle) * dt;
  state.x += state.speed * Math.cos(state.heading) * dt;
  state.y += state.speed * Math.sin(state.heading) * dt;
}
