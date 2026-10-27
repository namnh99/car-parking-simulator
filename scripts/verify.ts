/**
 * Headless verification of the vehicle dynamics, geometry and presets.
 * Run: esbuild --bundle verify.ts --platform=node --format=esm | node
 */
import {
  DEFAULT_ENV,
  DEFAULT_VEHICLE,
  VEHICLE_PRESETS,
  sanitizeEnvironment,
  sanitizeVehicle,
} from "../src/config";
import { buildEnvironment } from "../src/environment";
import { Simulation } from "../src/simulation";
import { Camera } from "../src/camera";
import { runRealismChecks } from "./realism";
import {
  bodyCenter,
  bodyCorners,
  frontOverhang,
  integrateMotion,
  localBodyRect,
  localWheels,
  maxSteeringAngle,
  rearOverhang,
  turningGeometry,
  turningRadiusClamped,
} from "../src/vehicle";
import type { VehicleState } from "../src/types";

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

type StubInput = { forward: boolean; backward: boolean; steerLeft: boolean; steerRight: boolean };
const stub = (over: Partial<StubInput> = {}): StubInput => ({
  forward: false,
  backward: false,
  steerLeft: false,
  steerRight: false,
  ...over,
});

const CFG = DEFAULT_VEHICLE;

// ------------------------------------------------------------- 1. parameters
check(
  "config includes physical geometry and calibration parameters",
  (Object.keys(CFG) as string[]).sort().join(",") ===
    "frontOverhang,maxInnerSteeringAngle,mirrorLength,mirrorOffset,mirrorWidth,steeringRate,steeringReturnRate,trackWidth,turningRadius,turningRadiusReference,tyreDiameter,tyreWidth,vehicleLength,vehicleWidth,wheelbase",
  Object.keys(CFG).join(", "),
);

// --------------------------------------------------- 2. overhangs and body
{
  const rect = localBodyRect(CFG);
  const rear = rearOverhang(CFG);
  check(
    "front overhang configured, rear absorbs the remainder",
    near(frontOverhang(CFG), CFG.frontOverhang, 1e-9) &&
      near(rear, CFG.vehicleLength - CFG.wheelbase - CFG.frontOverhang, 1e-9),
    `front ${frontOverhang(CFG)} m, rear ${rear.toFixed(3)} m`,
  );
  check(
    "body spans exactly vehicleLength around the rear axle",
    near(rect.front, CFG.wheelbase + CFG.frontOverhang, 1e-9) &&
      near(rect.rear, -rear, 1e-9) &&
      near(rect.front - rect.rear, CFG.vehicleLength, 1e-9),
    `front ${rect.front} m, rear ${rect.rear} m`,
  );
  const state: VehicleState = { x: 0, y: 0, heading: 0, speed: 0, steeringAngle: 0 };
  const corners = bodyCorners(state, CFG);
  check(
    "corners land on the overhang extents",
    near(Math.max(...corners.map((c) => c.x)), rect.front, 1e-9) &&
      near(Math.min(...corners.map((c) => c.x)), rect.rear, 1e-9),
    `front ${Math.max(...corners.map((c) => c.x))} m, rear ${Math.min(...corners.map((c) => c.x))} m`,
  );
  check(
    "front overhang cannot exceed length - wheelbase",
    sanitizeVehicle({ ...CFG, frontOverhang: 99 }).frontOverhang ===
      CFG.vehicleLength - CFG.wheelbase,
    `clamped to ${(CFG.vehicleLength - CFG.wheelbase).toFixed(3)} m`,
  );
}

// ------------------------------------------------- 3. wheels, axles, centre
{
  const state: VehicleState = { x: 0, y: 0, heading: 0, speed: 0, steeringAngle: 0 };
  const wheels = localWheels(CFG);
  check(
    "front wheels at the front axle, rear at the rear axle",
    wheels.filter((w) => w.steered).every((w) => near(w.x, CFG.wheelbase, 1e-9)) &&
      wheels.filter((w) => !w.steered).every((w) => near(w.x, 0, 1e-9)),
    `front x ${CFG.wheelbase}, rear x 0`,
  );
  // With asymmetric overhangs the body centre is the overhang midpoint, and it
  // must agree with what the collision box assumes (length/2 around it).
  const expectedCentre = (CFG.wheelbase + CFG.frontOverhang - rearOverhang(CFG)) / 2;
  const centre = bodyCenter(state, CFG);
  const rect = localBodyRect(CFG);
  check(
    "body centre is the overhang midpoint, not wheelbase/2",
    near(centre.x, expectedCentre, 1e-9) && !near(expectedCentre, CFG.wheelbase / 2, 1e-4),
    `${expectedCentre.toFixed(3)} m (wheelbase/2 would be ${(CFG.wheelbase / 2).toFixed(3)} m)`,
  );
  check(
    "collision box (length/2 around the centre) matches the body extents",
    near(centre.x + CFG.vehicleLength / 2, rect.front, 1e-9) &&
      near(centre.x - CFG.vehicleLength / 2, rect.rear, 1e-9),
    `box front ${(centre.x + CFG.vehicleLength / 2).toFixed(4)} vs body front ${rect.front.toFixed(4)}`,
  );
}

// --------------------------------------- 4. turning radius drives the lock
{
  const geo = turningGeometry(CFG);
  check(
    "requested turning radius reproduced exactly (kerb-to-kerb)",
    near(geo.referenceRadius, CFG.turningRadius, 1e-6),
    `requested ${CFG.turningRadius} m -> ${geo.referenceRadius.toFixed(6)} m`,
  );
  check(
    "rear-axle radius uses the selected tyre-edge convention and wheel track",
    near(geo.rearAxleRadius, Math.sqrt((CFG.turningRadius - CFG.tyreWidth / 2) ** 2 - CFG.wheelbase ** 2) - CFG.trackWidth / 2, 1e-9),
    `${geo.rearAxleRadius.toFixed(4)} m`,
  );
  check(
    "wall-to-wall envelope exceeds the reference radius",
    geo.wallToWallRadius > geo.referenceRadius,
    `wall ${geo.wallToWallRadius.toFixed(3)} m vs ref ${geo.referenceRadius.toFixed(3)} m`,
  );
  check("requested radius achievable", !turningRadiusClamped(CFG), `${((geo.steeringAngle * 180) / Math.PI).toFixed(2)}°`);
  check(
    "unreachable radius is flagged",
    turningRadiusClamped({ ...CFG, turningRadius: 1.0 }),
    "1.0 m clamps",
  );
}

// -------------------------------------------------------- 5. bicycle model arc
{
  const steer = maxSteeringAngle(CFG);
  const state: VehicleState = { x: 0, y: 0, heading: 0, speed: 2, steeringAngle: steer };
  const dt = 1 / 2000;
  const radius = CFG.wheelbase / Math.tan(steer);
  const centreX = -Math.sin(0) * radius;
  const centreY = Math.cos(0) * radius;
  let maxErr = 0;
  let envelope = 0;
  const geo = turningGeometry(CFG);
  for (let i = 0; i < 2000; i += 1) {
    integrateMotion(state, CFG, dt);
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(state.x - centreX, state.y - centreY) - radius));
    for (const c of bodyCorners(state, CFG)) {
      envelope = Math.max(envelope, Math.hypot(c.x - centreX, c.y - centreY));
    }
  }
  check("rear axle traces R = L/tan(delta)", maxErr < 0.05, `max error ${maxErr.toFixed(4)} m`);
  check(
    "swept envelope matches wall-to-wall radius",
    near(envelope, geo.wallToWallRadius, 1e-3),
    `measured ${envelope.toFixed(4)} m vs predicted ${geo.wallToWallRadius.toFixed(4)} m`,
  );
}

// ------------------------------------------------------- 6. driving dynamics
{
  const dt = 1 / 240;
  const sim = new Simulation(DEFAULT_ENV, CFG);
  check(
    "vehicle starts to the right of the house, centred on the road",
    sim.state.x > sim.env.house.right && near(sim.state.y, DEFAULT_ENV.roadWidth / 2, 1e-9),
    `x ${sim.state.x.toFixed(2)} m, heading ${sim.state.heading.toFixed(2)} rad`,
  );
  // Test westward dynamics independently of the chosen spawn heading.
  sim.state.heading = Math.PI;
  const startX = sim.state.x;
  for (let i = 0; i < 240 * 2; i += 1) sim.update(dt, stub({ forward: true }) as never);
  check(
    "W accelerates west with no lateral drift",
    sim.stats().speed > 3.0 && startX - sim.state.x > 3 && near(sim.state.y, DEFAULT_ENV.roadWidth / 2, 1e-9),
    `speed ${sim.stats().speed.toFixed(2)} m/s, travelled ${(sim.state.x - startX).toFixed(2)} m`,
  );
  for (let i = 0; i < 240; i += 1) sim.update(dt, stub({ backward: true }) as never);
  const atStop = sim.state.x;
  for (let i = 0; i < 240 * 1.5; i += 1) sim.update(dt, stub({ backward: true }) as never);
  check(
    "S brakes then reverses",
    sim.state.speed < 0 && sim.state.x > atStop,
    `x ${atStop.toFixed(2)} -> ${sim.state.x.toFixed(2)}, speed ${sim.state.speed.toFixed(2)}`,
  );

  const steerSim = new Simulation(DEFAULT_ENV, CFG);
  const samples: number[] = [];
  // Isolate steering at rest; driving into a kerb may correctly limit tyre rotation.
  for (let i = 0; i < 240 * 4; i += 1) {
    steerSim.update(dt, stub({ steerRight: true }) as never);
    samples.push(steerSim.state.steeringAngle);
  }
  const lock = maxSteeringAngle(CFG);
  check(
    "holding D ramps to the lock",
    samples.every((v, i) => i === 0 || v >= samples[i - 1] - 1e-12) && near(samples[samples.length - 1], lock, 1e-3),
    `${((samples[samples.length - 1] * 180) / Math.PI).toFixed(2)}°`,
  );
  for (let i = 0; i < 240 * 2; i += 1) steerSim.update(dt, stub() as never);
  check("release self-centres", steerSim.state.steeringAngle === 0, "0");
}

// ---------------------------------------------------- 7. barriers + clearance
{
  for (const roadWidth of [1.9, 3.72, 10]) {
    for (const drivewayDepth of [0, 0.5, 5]) {
      const env = buildEnvironment(sanitizeEnvironment({ ...DEFAULT_ENV, roadWidth, drivewayDepth }));
      check(
        "walls leave the full configured road width clear",
        env.walls.every(({ box }) =>
          box.maxX <= env.road.left || box.minX >= env.road.right ||
          box.maxY <= env.road.top || box.minY >= env.road.bottom),
        `road ${roadWidth} m, driveway ${drivewayDepth} m`,
      );
    }
  }
}
{
  const wide = sanitizeEnvironment({ ...DEFAULT_ENV, roadWidth: 10, drivewayDepth: 0 });
  const env = buildEnvironment(wide);
  const sim = new Simulation(wide, CFG);
  sim.state.x = -6;
  sim.state.y = env.road.bottom - 5;
  sim.state.heading = -Math.PI / 2;
  for (let i = 0; i < 240 * 4; i += 1) sim.update(1 / 240, stub({ forward: true }) as never);
  const nose = Math.min(...bodyCorners(sim.state, CFG).map((c) => c.y));
  check("north kerb stops the car", nose > 0 && nose < 0.6, `front bumper y ${nose.toFixed(3)}`);

  const sim2 = new Simulation(sanitizeEnvironment({ ...DEFAULT_ENV, roadWidth: 6 }), CFG);
  sim2.state.x = 0;
  sim2.state.y = sim2.env.house.front - 3;
  sim2.state.heading = Math.PI / 2;
  let parked = false;
  for (let i = 0; i < 240 * 6; i += 1) {
    sim2.update(1 / 240, stub({ forward: true }) as never);
    if (sim2.garage.parked) parked = true;
  }
  check("door reachable through the kerb opening", parked, `parked: ${parked}`);

  const sim3 = new Simulation(DEFAULT_ENV, CFG);
  sim3.state.heading = Math.PI / 2;
  sim3.state.y = sim3.env.house.front - 2;
  sim3.state.x = 0;
  sim3.update(0, stub() as never);
  const expected = (sim3.env.garage.width - CFG.vehicleWidth) / 2;
  check(
    "centred clearance = (door - width)/2",
    near(sim3.garage.leftClearance, expected, 1e-9),
    `${(sim3.garage.leftClearance * 100).toFixed(1)} cm each side`,
  );
}

// -------------------------------------------------------------- 8. presets
{
  check("eight vehicle presets", VEHICLE_PRESETS.length === 8, `${VEHICLE_PRESETS.length} presets`);
  const expectedIds = ["fadil", "i10", "wigo", "brio", "mazda2", "swift", "morning", "fronx"];
  check(
    "preset ids",
    VEHICLE_PRESETS.map((p) => p.id).join(",") === expectedIds.join(","),
    VEHICLE_PRESETS.map((p) => p.id).join(", "),
  );

  for (const preset of VEHICLE_PRESETS) {
    const c = preset.config;
    const rect = localBodyRect(c);
    const geo = turningGeometry(c);
    const ok =
      c.wheelbase < c.vehicleLength &&
      c.frontOverhang > 0 &&
      c.frontOverhang < c.vehicleLength - c.wheelbase &&
      near(rect.front - rect.rear, c.vehicleLength, 1e-9) &&
      near(geo.referenceRadius, c.turningRadius, 1e-3) &&
      !turningRadiusClamped(c);
    check(
      `${preset.label}: consistent geometry`,
      ok,
      `L ${c.vehicleLength} W ${c.vehicleWidth} WB ${c.wheelbase} FO ${c.frontOverhang} `
        + `RO ${rearOverhang(c).toFixed(3)} R ${geo.referenceRadius.toFixed(3)} `
        + `lock ${((geo.steeringAngle * 180) / Math.PI).toFixed(1)}° wall ${geo.wallToWallRadius.toFixed(2)}`,
    );
  }

  // Current presets use front-biased overhangs; most are estimates.
  const biased = VEHICLE_PRESETS.filter((p) => p.id !== "example").every(
    (p) => frontOverhang(p.config) > rearOverhang(p.config),
  );
  check("every preset has a front-biased overhang", biased, "front > rear on all current presets");
  const fronx = VEHICLE_PRESETS.find((p) => p.id === "fronx")!.config;
  check(
    "Fronx matches Suzuki Vietnam dimensions and nominal tyre size",
    near(fronx.vehicleLength, 3.995, 1e-9) && near(fronx.vehicleWidth, 1.765, 1e-9) &&
      near(fronx.wheelbase, 2.52, 1e-9) && near(fronx.turningRadius, 4.8, 1e-9) &&
      near(fronx.tyreWidth, 0.195, 1e-9) && near(fronx.tyreDiameter, 0.6404, 1e-9),
    "3995 x 1765 mm, wheelbase 2520 mm, radius 4.8 m, 195/60 R16",
  );
  const i10 = VEHICLE_PRESETS.find((p) => p.id === "i10")!.config;
  check(
    "Grand i10 uses its published 715/650 mm overhangs",
    near(frontOverhang(i10), 0.715, 1e-9) && near(rearOverhang(i10), 0.65, 1e-9),
    `front ${frontOverhang(i10)} m, rear ${rearOverhang(i10)} m`,
  );
  const swift = VEHICLE_PRESETS.find((p) => p.id === "swift")!.config;
  const camera = new Camera();
  for (const zoom of [4, 32, 100, 320]) {
    camera.zoom = zoom;
    for (const heading of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const corners = bodyCorners({ x: 0, y: 0, heading, speed: 0, steeringAngle: 0 }, swift)
        .map((p) => camera.worldToScreen(p.x, p.y, 800, 600));
      const widthPx = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
      const lengthPx = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
      check(
        "camera preserves vehicle dimensions and road-width ratio",
        near(widthPx, swift.vehicleWidth * zoom, 1e-9) &&
          near(lengthPx, swift.vehicleLength * zoom, 1e-9) &&
          near(widthPx / (DEFAULT_ENV.roadWidth * zoom), 1.735 / 3.72, 1e-9),
        `zoom ${zoom}, heading ${heading.toFixed(2)}`,
      );
    }
  }
  check(
    "two Swifts leave 25 cm across a 3.72 m road",
    near(DEFAULT_ENV.roadWidth - 2 * swift.vehicleWidth, 0.25, 1e-9),
    `${(DEFAULT_ENV.roadWidth - 2 * swift.vehicleWidth).toFixed(2)} m`,
  );
  check(
    "Swift reproduces the published 9.6 m turning circle",
    near(turningGeometry(swift).referenceRadius * 2, 9.6, 0.01),
    `${(turningGeometry(swift).referenceRadius * 2).toFixed(3)} m diameter`,
  );
}

// ------------------------------------------------------------------ 9. reset
{
  const sim = new Simulation(DEFAULT_ENV, CFG);
  sim.update(0.5, stub({ forward: true }) as never);
  const before = sim.trail.length;
  sim.resetVehicle();
  check(
    "reset restores the spawn pose and clears the trail",
    near(sim.state.x, sim.env.start.x, 1e-9) && sim.trail.length === 0 && sim.state.speed === 0,
    `trail ${before} -> ${sim.trail.length}`,
  );
}

runRealismChecks(check);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
