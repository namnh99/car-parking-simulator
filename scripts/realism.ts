import { DEFAULT_ENV, DEFAULT_VEHICLE, VEHICLE_PRESETS, sanitizeEnvironment, sanitizeVehicle } from "../src/config";
import { buildEnvironment } from "../src/environment";
import { clipToYBand, obbIntersectsAabb } from "../src/math";
import { Simulation } from "../src/simulation";
import { bodyCenter, integrateMotion, localWheels, maxSteeringAngle, shapeCorners, turningGeometry, updateSteering, vehicleShapes, wheelSteeringAngle } from "../src/vehicle";

type Check = (name: string, ok: boolean, detail: string) => void;
const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) < tolerance;
const idle = { forward: false, backward: false, steerLeft: false, steerRight: false };

function atBodyCenter(sim: Simulation, heading: number, x: number, y: number): void {
  sim.state.heading = heading;
  sim.state.x = 0;
  sim.state.y = 0;
  const offset = bodyCenter(sim.state, sim.vehicleConfig);
  sim.state.x = x - offset.x;
  sim.state.y = y - offset.y;
  sim.update(0, idle as never);
}

function touchingWall(sim: Simulation): boolean {
  return vehicleShapes(sim.state, sim.vehicleConfig).some((shape) => sim.env.walls.some(({ box }) =>
    obbIntersectsAabb(shape.center.x, shape.center.y, shape.halfLength, shape.halfWidth, shape.heading, box)));
}

export function runRealismChecks(check: Check): void {
  for (const wallThickness of [0.01, 0.16, 0.4]) {
    const config = sanitizeEnvironment({ ...DEFAULT_ENV, wallThickness, garageDoorWidth: DEFAULT_ENV.houseWidth });
    const env = buildEnvironment(config);
    const [, , back, left, right] = env.walls;
    check("configured interior is clear between physical wall faces",
      near(right.box.minX - left.box.maxX, config.houseWidth) &&
      near(back.box.minY - env.house.interiorFront, config.houseDepth) &&
      near(env.house.interiorFront - env.house.front, wallThickness), `wall ${wallThickness} m`);
    check("maximum doorway is not narrowed by side walls",
      near(env.garage.left, left.box.maxX) && near(env.garage.right, right.box.minX), `door ${env.garage.width} m`);
  }

  const swift = VEHICLE_PRESETS.find((p) => p.id === "swift")!.config;
  const sim = new Simulation(DEFAULT_ENV, swift);
  atBodyCenter(sim, 0, 0, sim.env.house.front + DEFAULT_ENV.wallThickness / 2);
  check("sideways vehicle at doorway is NOT clear",
    !sim.garage.fits && touchingWall(sim) && sim.garage.clearanceMode === "at-door" &&
    sim.garage.leftClearance < 0 && sim.garage.rightClearance < 0, "3.86 m body across 2.6 m door");
  for (const heading of [Math.PI / 2, -Math.PI / 2]) {
    atBodyCenter(sim, heading, 0, sim.env.house.front);
    check("aligned forward/reverse doorway clearance matches measured body width",
      sim.garage.fits && near(sim.garage.leftClearance, 0.4325) && near(sim.garage.rightClearance, 0.4325), `heading ${heading}`);
  }
  atBodyCenter(sim, Math.PI / 3, 0, sim.env.house.front + DEFAULT_ENV.wallThickness / 2);
  // For a centred rectangle crossing a horizontal slab, half-span is W/(2 sin h)
  // plus half the slab thickness * cot h (provided end caps are outside the slab).
  const expectedSpan = swift.vehicleWidth / Math.sin(Math.PI / 3) + DEFAULT_ENV.wallThickness / Math.tan(Math.PI / 3);
  check("oblique doorway slice uses angle AND wall thickness",
    near(sim.garage.leftClearance, (2.6 - expectedSpan) / 2) &&
    near(sim.garage.rightClearance, (2.6 - expectedSpan) / 2), `span ${expectedSpan.toFixed(4)} m`);
  atBodyCenter(sim, Math.PI / 2, 0, sim.env.house.front - 3);
  check("before doorway clearance is explicitly a projection", sim.garage.clearanceMode === "projection", "not a promise of future fit");
  atBodyCenter(sim, Math.PI / 2, 0, sim.env.house.interiorFront + 4);
  check("parked requires entire footprint inside clear interior", sim.garage.parked && !touchingWall(sim), "body and tyres");
  atBodyCenter(sim, Math.PI / 2, 0, sim.env.house.back - 0.1);
  check("rear-wall overlap is not parked", !sim.garage.parked && !sim.garage.fits, "back wall checked");

  const withMirrors = sanitizeVehicle({ ...swift, mirrorWidth: 2.8, mirrorLength: 0.2, mirrorOffset: 1.7 });
  for (const heading of [Math.PI / 2, -Math.PI / 2]) {
    const mirrors = new Simulation(DEFAULT_ENV, withMirrors);
    mirrors.state.heading = heading;
    mirrors.state.x = 0;
    mirrors.state.y = mirrors.env.house.front + DEFAULT_ENV.wallThickness / 2 - Math.sin(heading) * withMirrors.mirrorOffset;
    mirrors.update(0, idle as never);
    check("mirror-only contact blocks entry in either direction",
      !mirrors.garage.fits && touchingWall(mirrors) && mirrors.garage.mirrorsEnabled &&
      near(mirrors.garage.leftClearance, -0.1) && near(mirrors.garage.rightClearance, -0.1), `heading ${heading}`);
    const polygons = vehicleShapes(mirrors.state, withMirrors).filter((s) => s.kind === "mirror").map(shapeCorners);
    check("mirrors are separate local shapes, not a widened body", polygons.length === 2 && near(mirrors.vehicleConfig.vehicleWidth, 1.735), "body still 1.735 m");
  }
  // Move a mirror toward a wall: the collision guard must prevent it crossing.
  // A vertical 3.86 m car cannot start wholly inside the default 3.72 m road.
  const guard = new Simulation({ ...DEFAULT_ENV, roadWidth: 6 }, sanitizeVehicle({ ...swift, mirrorWidth: 2.8 }));
  guard.state.heading = Math.PI / 2;
  guard.state.x = 0;
  guard.state.y = guard.env.house.front - swift.wheelbase - swift.frontOverhang - 0.1;
  for (let i = 0; i < 1200; i++) guard.update(1 / 240, { ...idle, forward: true } as never);
  check("mirror collision guard stops a body that otherwise fits", !guard.garage.parked && !touchingWall(guard) && near(guard.state.speed, 0), "2.8 m mirrors vs 2.6 m door");

  const tyreGuard = new Simulation(DEFAULT_ENV, swift);
  tyreGuard.state.y = swift.vehicleWidth / 2 + 0.005;
  let tyresClear = true;
  for (let i = 0; i < 120; i++) {
    tyreGuard.update(1 / 120, { ...idle, steerRight: true } as never);
    tyresClear &&= !touchingWall(tyreGuard);
  }
  check("stationary steering cannot rotate a tyre through a kerb",
    tyresClear && tyreGuard.state.steeringAngle < maxSteeringAngle(swift), "offending steering angle is reverted");
  const invalidGeometry = sanitizeVehicle({ ...swift, trackWidth: 10, tyreWidth: 10, mirrorOffset: 10, mirrorLength: 10 });
  check("invalid track/tyre/mirror parameters are clamped to the body",
    invalidGeometry.trackWidth + invalidGeometry.tyreWidth <= invalidGeometry.vehicleWidth + 1e-9 &&
    invalidGeometry.mirrorLength <= invalidGeometry.vehicleLength &&
    invalidGeometry.mirrorOffset + invalidGeometry.mirrorLength / 2 <= invalidGeometry.wheelbase + invalidGeometry.frontOverhang + 1e-9,
    "no inverted or unbounded local footprints");
  check("Brio preserves its wheel-centre turning-radius convention",
    VEHICLE_PRESETS.find((p) => p.id === "brio")!.config.turningRadiusReference === "wheel-centre", "existing spec annotation respected");

  for (const reference of ["wheel-centre", "outer-tyre"] as const) {
    const config = sanitizeVehicle({ ...DEFAULT_VEHICLE, wheelbase: 2.4, trackWidth: 1.4, tyreWidth: 0.2,
      turningRadius: 4, turningRadiusReference: reference });
    const centrePath = reference === "outer-tyre" ? 3.9 : 4;
    const expectedRearRadius = Math.sqrt(centrePath ** 2 - 2.4 ** 2) - 0.7;
    const steer = maxSteeringAngle(config);
    check("turn radius calibration matches independent wheel-centre geometry",
      near(2.4 / Math.tan(steer), expectedRearRadius) && near(turningGeometry(config).referenceRadius, 4), reference);
    for (const sign of [-1, 1]) {
      const signedRadius = sign * expectedRearRadius;
      for (const wheel of localWheels(config).filter((w) => w.steered)) {
        const angle = wheelSteeringAngle(sign * steer, config, wheel.y);
        // Wheel heading is tangent to a circle around (0, signedRadius) in canvas coordinates.
        const tangentDotRadius = Math.cos(angle) * wheel.x + Math.sin(angle) * (-wheel.y - signedRadius);
        check("each Ackermann road wheel is tangent to the same turning circle",
          near(tangentDotRadius, 0), `${reference}, turn ${sign}, lateral ${wheel.y}`);
      }
      const state = { x: 0, y: 0, heading: 0, speed: 1, steeringAngle: sign * steer };
      const measured = Math.max(...vehicleShapes(state, config).flatMap(shapeCorners)
        .map((p) => Math.hypot(p.x, p.y - signedRadius)));
      check("turning envelope encloses every body/tyre corner",
        near(turningGeometry(config, sign * steer).wallToWallRadius, measured), `${reference}, turn ${sign}`);
    }
  }
  const capped = sanitizeVehicle({ ...DEFAULT_VEHICLE, turningRadius: 3, maxInnerSteeringAngle: 35 });
  const inner = wheelSteeringAngle(maxSteeringAngle(capped), capped, -capped.trackWidth / 2);
  check("physical inner wheel lock is respected", near(inner, 35 * Math.PI / 180), "35 degrees");
  const rearHeavy = sanitizeVehicle({ ...DEFAULT_VEHICLE, vehicleLength: 6, wheelbase: 1, frontOverhang: 0, mirrorWidth: 4 });
  const rearHeavyState = { x: 0, y: 0, heading: 0, speed: 0, steeringAngle: maxSteeringAngle(rearHeavy) };
  const r = rearHeavy.wheelbase / Math.tan(rearHeavyState.steeringAngle);
  const maxCorner = Math.max(...vehicleShapes(rearHeavyState, rearHeavy).flatMap(shapeCorners).map((p) => Math.hypot(p.x, p.y - r)));
  check("swept envelope includes rear-heavy bodies and mirrors", near(turningGeometry(rearHeavy).wallToWallRadius, maxCorner), "not front-corner-only");

  for (const speed of [-1.5, 3.5]) {
    for (const steer of [-0.4, 0, 0.4]) {
      const large = { x: 0, y: 0, heading: 0.7, speed, steeringAngle: steer };
      const small = { ...large };
      integrateMotion(large, DEFAULT_VEHICLE, 1);
      for (let i = 0; i < 120; i++) integrateMotion(small, DEFAULT_VEHICLE, 1 / 120);
      check("exact arc integration is invariant to subdivision",
        near(large.x, small.x) && near(large.y, small.y) && near(large.heading, small.heading), `speed ${speed}, steer ${steer}`);
    }
  }
  const holding = { x: 0, y: 0, heading: 0, speed: 0, steeringAngle: 0.2 };
  updateSteering(holding, sanitizeVehicle({ ...DEFAULT_VEHICLE, steeringReturnRate: 0 }), { left: false, right: false }, 1);
  check("zero return rate holds steering", near(holding.steeringAngle, 0.2), "parking practice option");
  const clipped = clipToYBand([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], -0.1, 0.1);
  check("wall clipping finds intersections even when no corners lie in slab",
    clipped.length === 4 && clipped.every((p) => Math.abs(p.y) <= 0.100000001), "two crossing edges");
}
