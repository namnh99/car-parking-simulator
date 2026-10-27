import type { EnvironmentConfig, Vec2, VehicleConfig, VehicleState } from "./types";
import { buildEnvironment, type Environment } from "./environment";
import { SIM, sanitizeEnvironment, sanitizeVehicle } from "./config";
import {
  bodyCenter,
  createVehicleState,
  integrateMotion,
  maxSteeringAngle,
  updateSteering,
  updateThrottle,
  vehicleShapes,
  shapeCorners,
} from "./vehicle";
import { clipToYBand, obbIntersectsAabb } from "./math";
import type { InputManager } from "./input";

export interface GarageStatus {
  /** True while the car is in the garage approach corridor (HUD is shown). */
  active: boolean;
  /** True once the whole body is inside the house footprint. */
  parked: boolean;
  vehicleWidth: number;
  doorWidth: number;
  /** Ideal gap on each side when perfectly centred: (door - car) / 2. */
  nominalGap: number;
  /** Lateral shift of the car centre from the door centre (+ = to the right). */
  offset: number;
  leftClearance: number;
  rightClearance: number;
  /** False when either clearance is negative, i.e. the door frame is hit. */
  fits: boolean;
  /** At the actual door slab, or a conservative full-footprint preview. */
  clearanceMode: "at-door" | "projection";
  mirrorsEnabled: boolean;
}

export interface SimulationStats {
  speed: number;
  /** Compass-style heading: 0 = north, 90 = east, increasing clockwise. */
  headingDeg: number;
  steeringDeg: number;
  /** Rear axle centre — the model reference point. */
  position: Vec2;
}

/**
 * Owns the world state and advances it. Input -> steering -> throttle ->
 * bicycle-model integration, with a wall-collision guard that reverts the
 * offending sub-step.
 */
export class Simulation {
  env: Environment;
  vehicleConfig: VehicleConfig;
  state: VehicleState;
  trail: Vec2[] = [];
  garage: GarageStatus;

  private accumulator = 0;

  constructor(envConfig: EnvironmentConfig, vehicleConfig: VehicleConfig) {
    this.env = buildEnvironment(sanitizeEnvironment(envConfig));
    this.vehicleConfig = sanitizeVehicle(vehicleConfig);
    this.state = createVehicleState(this.env.start);
    this.garage = this.evaluateGarage();
  }

  applyEnvironment(envConfig: EnvironmentConfig): void {
    this.env = buildEnvironment(sanitizeEnvironment(envConfig));
    if (this.collides()) this.resetVehicle();
    this.garage = this.evaluateGarage();
  }

  applyVehicleConfig(vehicleConfig: VehicleConfig): void {
    this.vehicleConfig = sanitizeVehicle(vehicleConfig);
    // A smaller steering lock must also constrain the currently held wheel angle.
    const limit = maxSteeringAngle(this.vehicleConfig);
    this.state.steeringAngle = Math.max(-limit, Math.min(limit, this.state.steeringAngle));
    if (this.collides()) this.resetVehicle();
    this.garage = this.evaluateGarage();
  }

  resetVehicle(): void {
    this.state = createVehicleState(this.env.start);
    this.trail = [];
    this.accumulator = 0;
    this.garage = this.evaluateGarage();
  }

  update(dt: number, input: InputManager): void {
    this.accumulator += Math.min(dt, SIM.maxFrameDt);
    const step = SIM.physicsDt;
    let guard = 0;
    while (this.accumulator >= step && guard < 1000) {
      this.substep(step, input);
      this.accumulator -= step;
      guard += 1;
    }
    if (guard >= 1000) this.accumulator = 0;
    this.garage = this.evaluateGarage();
  }

  stats(): SimulationStats {
    const headingDeg = ((((this.state.heading * 180) / Math.PI + 90) % 360) + 360) % 360;
    return {
      speed: this.state.speed,
      headingDeg,
      steeringDeg: (this.state.steeringAngle * 180) / Math.PI,
      position: { x: this.state.x, y: this.state.y },
    };
  }

  private substep(dt: number, input: InputManager): void {
    const previous = { ...this.state };

    updateSteering(
      this.state,
      this.vehicleConfig,
      { left: input.steerLeft, right: input.steerRight },
      dt,
    );
    updateThrottle(
      this.state,
      { forward: input.forward, backward: input.backward },
      dt,
    );
    integrateMotion(this.state, this.vehicleConfig, dt);

    if (this.collides()) {
      this.state.x = previous.x;
      this.state.y = previous.y;
      this.state.heading = previous.heading;
      this.state.steeringAngle = previous.steeringAngle;
      this.state.speed = 0;
      return;
    }

    this.recordTrail();
  }

  private recordTrail(): void {
    // The trail follows the rear axle, which is the model's reference point.
    const last = this.trail[this.trail.length - 1];
    if (last) {
      const dx = this.state.x - last.x;
      const dy = this.state.y - last.y;
      if (dx * dx + dy * dy < SIM.trailMinStep * SIM.trailMinStep) return;
    }
    this.trail.push({ x: this.state.x, y: this.state.y });
  }

  private collides(): boolean {
    for (const shape of vehicleShapes(this.state, this.vehicleConfig)) {
      for (const wall of this.env.walls) {
        if (
          obbIntersectsAabb(
            shape.center.x,
            shape.center.y,
            shape.halfLength,
            shape.halfWidth,
            shape.heading,
            wall.box,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private evaluateGarage(): GarageStatus {
    const center = bodyCenter(this.state, this.vehicleConfig);
    const { garage, house } = this.env;

    const nominalGap = (garage.width - this.vehicleConfig.vehicleWidth) / 2;
    const offset = center.x - garage.centerX;
    const polygons = vehicleShapes(this.state, this.vehicleConfig).map(shapeCorners);
    const corners = polygons.flat();
    const atDoor = polygons.flatMap((polygon) => clipToYBand(polygon, house.front, house.interiorFront));
    const span = atDoor.length > 0 ? atDoor : corners;
    const leftClearance = Math.min(...span.map((p) => p.x)) - garage.left;
    const rightClearance = garage.right - Math.max(...span.map((p) => p.x));
    const parked = corners.every(
      (corner) =>
        corner.x > house.left &&
        corner.x < house.right &&
        corner.y > house.interiorFront &&
        corner.y < house.back,
    );

    // Show the readout only when the car is in front of the opening and roughly
    // on the door centreline — otherwise the clearances are not meaningful.
    const corridorHalfWidth = Math.max(garage.width / 2, 0.8);
    const inCorridor =
      Math.abs(offset) < corridorHalfWidth &&
      center.y > house.front - 4 &&
      center.y < house.back + 1.5;

    return {
      active: inCorridor || parked,
      parked,
      vehicleWidth: this.vehicleConfig.vehicleWidth,
      doorWidth: garage.width,
      nominalGap,
      offset,
      leftClearance,
      rightClearance,
      fits: leftClearance > 0 && rightClearance > 0 && !this.collides(),
      clearanceMode: atDoor.length > 0 ? "at-door" : "projection",
      mirrorsEnabled: this.vehicleConfig.mirrorWidth > this.vehicleConfig.vehicleWidth,
    };
  }
}
