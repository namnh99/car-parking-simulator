/** Shared type definitions for the car garage simulator. */

/** Geometry of the static scene, all values in metres. */
export interface EnvironmentConfig {
  /** Clear width of the horizontal road band, between the inner kerb faces. */
  roadWidth: number;
  /** Clear interior width between the side walls. */
  houseWidth: number;
  /** Clear interior depth behind the front wall. */
  houseDepth: number;
  /** Width of the garage door opening on the road-facing wall. */
  garageDoorWidth: number;
  /** Distance between the road edge and the house front wall. */
  drivewayDepth: number;
  wallThickness: number;
}

/** Physical parameters of the car, all values in metres unless noted. */
export interface VehicleConfig {
  /** Overall body length. */
  vehicleLength: number;
  /** Overall body width. */
  vehicleWidth: number;
  /** Distance between wheel centres; front/rear assumed equal in this model. */
  trackWidth: number;
  tyreWidth: number;
  tyreDiameter: number;
  /** Overall width with mirrors; zero disables the unmeasured mirror model. */
  mirrorWidth: number;
  /** Mirror centre ahead of the rear axle. */
  mirrorOffset: number;
  mirrorLength: number;
  /** Distance between the front and rear axle centres. */
  wheelbase: number;
  /**
   * Body ahead of the front axle. The rear overhang is derived from this:
   * `rearOverhang = vehicleLength - wheelbase - frontOverhang`, so the body
   * always spans exactly `vehicleLength` and there is nothing to reconcile.
   */
  frontOverhang: number;
  /**
   * Minimum turning radius in metres, as quoted by manufacturers
   * (kerb-to-kerb, to the outer front wheel). Derives the steering lock.
   */
  turningRadius: number;
  turningRadiusReference: "outer-tyre" | "wheel-centre";
  /** Physical inner road-wheel lock in degrees; generic default is only a cap. */
  maxInnerSteeringAngle: number;
  /** How fast the steering turns while a key is held, in degrees per second. */
  steeringRate: number;
  /** How fast the steering self-centres when released, in degrees per second. */
  steeringReturnRate: number;
}

/**
 * Mutable vehicle state.
 *
 * The reference point `(x, y)` is the **rear axle** (kinematic bicycle model).
 * `heading` is in radians, `0` points along `+x` (east) and increases
 * clockwise on screen because the world uses a y-down coordinate system.
 * `steeringAngle` is in radians, positive = steering right.
 */
export interface VehicleState {
  x: number;
  y: number;
  heading: number;
  speed: number;
  steeringAngle: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Aabb {
  minX: number;
  minY: number;
  maxY: number;
  maxX: number;
}

/** Keyboard actions that are edge-triggered (one shot per key press). */
export type InputAction =
  | "reset"
  | "resetCamera"
  | "toggleFollow"
  | "zoomIn"
  | "zoomOut";
