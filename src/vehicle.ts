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
 * Convert the chosen outer-wheel reference using wheel TRACK, not body width.
 * Outer-tyre convention is the wheel-centre path plus half the tyre width.
 * Manufacturer conventions must be confirmed for the particular model/year.
 */
export function maxSteeringAngle(config: VehicleConfig): number {
  const wheelRadius = config.turningRadius - (config.turningRadiusReference === "outer-tyre" ? config.tyreWidth / 2 : 0);
  const inner = wheelRadius * wheelRadius - config.wheelbase * config.wheelbase;
  // Limit the INNER road wheel to the physical lock, not the virtual bicycle wheel.
  const minimumRearRadius = config.trackWidth / 2 + config.wheelbase / Math.tan(config.maxInnerSteeringAngle * Math.PI / 180);
  const rearAxleRadius = Math.max(inner > 0 ? Math.sqrt(inner) - config.trackWidth / 2 : 0, minimumRearRadius);
  return Math.atan(config.wheelbase / rearAxleRadius);
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
  const half = config.trackWidth / 2;
  return [
    { x: config.wheelbase, y: half, steered: true },
    { x: config.wheelbase, y: -half, steered: true },
    { x: 0, y: half, steered: false },
    { x: 0, y: -half, steered: false },
  ];
}

/** Local +y is left; positive steering turns right in our y-down world. */
export function wheelSteeringAngle(steering: number, config: VehicleConfig, lateral: number): number {
  if (Math.abs(steering) < 1e-12) return 0;
  const signedRadius = config.wheelbase / Math.tan(steering);
  return Math.atan(config.wheelbase / (signedRadius + lateral));
}

export interface VehicleShape {
  kind: "body" | "mirror" | "tyre";
  center: Vec2;
  halfLength: number;
  halfWidth: number;
  heading: number;
}

export function shapeCorners(shape: VehicleShape): Vec2[] {
  const { forward, left } = headingBasis(shape.heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([along, across]) => ({
    x: shape.center.x + along * shape.halfLength * forward.x + across * shape.halfWidth * left.x,
    y: shape.center.y + along * shape.halfLength * forward.y + across * shape.halfWidth * left.y,
  }));
}

/** Shared physical footprint for rendering, collisions, clearance and envelopes. */
export function vehicleShapes(state: VehicleState, config: VehicleConfig): VehicleShape[] {
  const shapes: VehicleShape[] = [{ kind: "body", center: bodyCenter(state, config),
    halfLength: config.vehicleLength / 2, halfWidth: config.vehicleWidth / 2, heading: state.heading }];
  const { forward, left } = headingBasis(state.heading);
  const at = (along: number, across: number): Vec2 => ({
    x: state.x + along * forward.x + across * left.x,
    y: state.y + along * forward.y + across * left.y,
  });
  for (const wheel of localWheels(config)) {
    shapes.push({ kind: "tyre", center: at(wheel.x, wheel.y), halfLength: config.tyreDiameter / 2,
      halfWidth: config.tyreWidth / 2,
      heading: state.heading + (wheel.steered ? wheelSteeringAngle(state.steeringAngle, config, wheel.y) : 0) });
  }
  if (config.mirrorWidth > config.vehicleWidth) {
    for (const side of [-1, 1]) {
      shapes.push({ kind: "mirror", center: at(config.mirrorOffset, side * (config.vehicleWidth + config.mirrorWidth) / 4),
        halfLength: config.mirrorLength / 2, halfWidth: (config.mirrorWidth - config.vehicleWidth) / 4, heading: state.heading });
    }
  }
  return shapes;
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

export function turningGeometry(config: VehicleConfig, steeringAngle = maxSteeringAngle(config)): TurningGeometry {
  if (Math.abs(steeringAngle) < 1e-12) {
    return { steeringAngle, rearAxleRadius: Infinity, referenceRadius: Infinity, wallToWallRadius: Infinity };
  }
  const rearAxleRadius = Math.abs(config.wheelbase / Math.tan(steeringAngle));
  const state = { x: 0, y: 0, heading: 0, speed: 0, steeringAngle };
  const signedRadius = config.wheelbase / Math.tan(steeringAngle);
  const envelope = Math.max(...vehicleShapes(state, config).flatMap(shapeCorners)
    .map((p) => Math.hypot(p.x, p.y - signedRadius)));

  return {
    steeringAngle,
    rearAxleRadius,
    referenceRadius: Math.hypot(config.wheelbase, rearAxleRadius + config.trackWidth / 2)
      + (config.turningRadiusReference === "outer-tyre" ? config.tyreWidth / 2 : 0),
    wallToWallRadius: envelope,
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
  const distance = state.speed * dt;
  const yaw = distance * Math.tan(state.steeringAngle) / wheelbase;
  // Exact constant-curvature arc via midpoint/sinc, stable for straight motion.
  const halfYaw = yaw / 2;
  const chord = distance * (Math.abs(halfYaw) < 1e-8 ? 1 : Math.sin(halfYaw) / halfYaw);
  state.x += chord * Math.cos(state.heading + halfYaw);
  state.y += chord * Math.sin(state.heading + halfYaw);
  state.heading += yaw;
}
