import type { Environment } from "./environment";
import type { Aabb, Vec2, VehicleConfig, VehicleState } from "./types";
import type { Camera } from "./camera";
import type { GarageStatus } from "./simulation";
import {
  bodyCenter,
  bodyCorners,
  headingBasis,
  localBodyRect,
  localWheels,
  turningGeometry,
  wheelSteeringAngle,
} from "./vehicle";
import { formatNumber } from "./math";

export interface RenderScene {
  env: Environment;
  vehicleConfig: VehicleConfig;
  vehicle: VehicleState;
  trail: Vec2[];
  camera: Camera;
  garage: GarageStatus;
}

/** Scene heights in metres. */
const WALL_HEIGHT = 2.8;
const DOOR_HEIGHT = 2.15;
const KERB_HEIGHT = 0.16;
const BODY_BOTTOM = 0.3;
const BODY_TOP = 0.82;
const ROOF_TOP = 1.42;

const COLORS = {
  backgroundTop: "#0a1017",
  backgroundBottom: "#18232e",
  ground: "#17212c",
  grid: "rgba(255, 255, 255, 0.045)",
  road: "#2b323b",
  roadCentre: "rgba(226, 232, 240, 0.34)",
  driveway: "#3b424b",
  houseFloor: "#2c3745",
  foundation: "#1c2631",
  trail: "rgba(255, 183, 3, 0.92)",
  trailStart: "#ffb703",
  opening: "#4fd1c5",
  danger: "#ff5c5c",
  text: "rgba(232, 238, 246, 0.92)",
  frontMark: "#ffd166",
  shadow: "rgba(3, 7, 12, 0.32)",
} as const;

interface Palette {
  top: string;
  sideA: string;
  sideB: string;
  outline?: string;
}

const WALL_PALETTE: Palette = {
  top: "#dde6f0",
  sideA: "#aebccd",
  sideB: "#8e9daf",
  outline: "rgba(15, 23, 32, 0.3)",
};
const KERB_PALETTE: Palette = {
  top: "#8794a4",
  sideA: "#657382",
  sideB: "#515d6b",
  outline: "rgba(9, 14, 20, 0.35)",
};
const BODY_PALETTE: Palette = {
  top: "#79bcff",
  sideA: "#4a9ef2",
  sideB: "#2f78c8",
  outline: "rgba(9, 19, 31, 0.45)",
};
const CABIN_PALETTE: Palette = {
  top: "#82c3fa",
  sideA: "#2b5d7d",
  sideB: "#1b435c",
  outline: "rgba(9, 19, 31, 0.45)",
};
const WHEEL_PALETTE: Palette = {
  top: "#2b333d",
  sideA: "#171d24",
  sideB: "#0d1218",
  outline: "rgba(0, 0, 0, 0.5)",
};
const MIRROR_PALETTE: Palette = {
  top: "#79bcff",
  sideA: "#3c8bdd",
  sideB: "#2a6cb4",
  outline: "rgba(9, 19, 31, 0.45)",
};

interface Renderable {
  depth: number;
  draw: () => void;
}

interface PrismFootprint {
  hx: number;
  hy: number;
}

/**
 * Canvas 2D renderer with a fixed pseudo-3D (orthographic 3/4) projection.
 * Ground surfaces are flat polygons, while walls, kerbs, the car and the
 * garage header are extruded prisms sorted back-to-front by view depth.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: Camera;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    camera: Camera,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    this.ctx = ctx;
    this.camera = camera;
  }

  /** Resize the backing store for the given CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = Math.max(cssWidth, 1);
    this.height = Math.max(cssHeight, 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  get viewWidth(): number {
    return this.width;
  }

  get viewHeight(): number {
    return this.height;
  }

  render(scene: RenderScene): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawBackdrop(scene.env);
    this.drawGrid();
    this.drawGround(scene.env);
    this.drawShadows(scene);
    this.drawGroundOverlays(scene);
    this.drawStructures(scene);
    this.drawVignette();
    this.drawDoorTrim(scene);
    this.drawLabels(scene.env);
    this.drawWidthDimensions(scene);
    if (scene.garage.parked) this.drawParkedBanner();
  }

  // ---------------------------------------------------------------- helpers

  private project(x: number, y: number, z = 0): Vec2 {
    return this.camera.worldToScreen(x, y, this.width, this.height, z);
  }

  private beginPolygon(points: readonly Vec2[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  private fillScreenPolygon(points: readonly Vec2[], color: string): void {
    this.beginPolygon(points);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  private strokeScreenPolyline(
    points: readonly Vec2[],
    color: string,
    width: number,
    dash: number[] = [],
  ): void {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  private strokeWorldSegment(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    color: string,
    widthMeters: number,
    dash: number[] = [],
    z = 0,
  ): void {
    this.strokeScreenPolyline(
      [this.project(ax, ay, z), this.project(bx, by, z)],
      color,
      Math.max(widthMeters * this.camera.zoom, 0.6),
      dash,
    );
  }

  private fillGroundRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    z = 0,
  ): void {
    this.fillScreenPolygon(
      [
        this.project(x0, y0, z),
        this.project(x1, y0, z),
        this.project(x1, y1, z),
        this.project(x0, y1, z),
      ],
      color,
    );
  }

  private signedArea(points: readonly Vec2[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
  }

  private depthAt(x: number, y: number, z: number): number {
    const yPrime = x * Math.sin(this.camera.yaw) + y * Math.cos(this.camera.yaw);
    return yPrime * this.camera.heightScale - z * this.camera.groundTilt;
  }

  private boxDepth(box: Aabb, z0: number, z1: number): number {
    return this.depthAt(
      (box.minX + box.maxX) / 2,
      (box.minY + box.maxY) / 2,
      (z0 + z1) / 2,
    );
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.ctx;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- layers

  private drawBackdrop(env: Environment): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, COLORS.backgroundTop);
    gradient.addColorStop(0.6, COLORS.ground);
    gradient.addColorStop(1, COLORS.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    // Soft light spill from the garage opening.
    const door = this.project(env.garage.centerX, env.house.front, 1.6);
    const radius = Math.max(this.width, this.height) * 0.5;
    const glow = ctx.createRadialGradient(door.x, door.y, 0, door.x, door.y, radius);
    glow.addColorStop(0, "rgba(77, 163, 255, 0.1)");
    glow.addColorStop(1, "rgba(77, 163, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawGrid(): void {
    const corners = [
      this.camera.screenToWorld(0, 0, this.width, this.height),
      this.camera.screenToWorld(this.width, 0, this.width, this.height),
      this.camera.screenToWorld(0, this.height, this.width, this.height),
      this.camera.screenToWorld(this.width, this.height, this.width, this.height),
    ];
    const minX = Math.min(...corners.map((p) => p.x));
    const maxX = Math.max(...corners.map((p) => p.x));
    const minY = Math.min(...corners.map((p) => p.y));
    const maxY = Math.max(...corners.map((p) => p.y));
    const span = Math.max(maxX - minX, maxY - minY);
    const step = span > 160 ? 10 : span > 60 ? 5 : span > 20 ? 2 : 1;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) {
      const a = this.project(x, minY);
      const b = this.project(x, maxY);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) {
      const a = this.project(minX, y);
      const b = this.project(maxX, y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawGround(env: Environment): void {
    const { road, house, garage } = env;

    // Foundation plate under the house.
    this.fillGroundRect(
      house.left - 0.35,
      house.front - 0.25,
      house.right + 0.35,
      house.back + 0.35,
      COLORS.foundation,
      0.002,
    );

    // Carriageway.
    this.fillGroundRect(road.left, road.top, road.right, road.bottom, COLORS.road, 0.01);

    // Dashed centreline.
    const centreY = (road.top + road.bottom) / 2;
    for (let x = road.left + 1; x < road.right - 1; x += 5) {
      this.fillGroundRect(
        x,
        centreY - 0.05,
        Math.min(x + 2.4, road.right - 0.5),
        centreY + 0.05,
        COLORS.roadCentre,
        0.02,
      );
    }

    // Driveway apron.
    if (house.front > road.bottom + 0.001) {
      const left = Math.min(house.left, garage.left) - 0.6;
      const right = Math.max(house.right, garage.right) + 0.6;
      this.fillGroundRect(left, road.bottom, right, house.front, COLORS.driveway, 0.012);
      this.strokeWorldSegment(
        left,
        road.bottom + 0.001,
        right,
        road.bottom + 0.001,
        "rgba(255, 255, 255, 0.08)",
        0.06,
        [],
        0.016,
      );
    }

    // Interior floor (garage bay + house body).
    this.fillGroundRect(
      garage.left,
      house.front,
      garage.right,
      house.interiorFront,
      COLORS.houseFloor,
      0.014,
    );
    this.fillGroundRect(
      house.left,
      house.interiorFront,
      house.right,
      house.back,
      COLORS.houseFloor,
      0.014,
    );

    // Parking target just inside the door.
    const targetY = house.front + 3.0;
    this.strokeWorldSegment(
      house.left + 0.3,
      targetY,
      house.right - 0.3,
      targetY,
      "rgba(79, 209, 197, 0.35)",
      0.06,
      [0.4, 0.4],
      0.02,
    );
  }

  private drawShadows(scene: RenderScene): void {
    for (const { box, kind } of scene.env.walls) {
      if (kind !== "house") continue;
      this.fillGroundRect(
        box.minX + 0.35,
        box.minY + 0.45,
        box.maxX + 0.35,
        box.maxY + 0.45,
        "rgba(3, 7, 12, 0.18)",
        0.018,
      );
    }

    const body = bodyCorners(scene.vehicle, scene.vehicleConfig);
    const projected = body.map((point) => this.project(point.x + 0.45, point.y + 0.6, 0.024));
    this.fillScreenPolygon(projected, COLORS.shadow);
  }

  private drawGroundOverlays(scene: RenderScene): void {
    this.drawTurningCircles(scene);
    this.drawTrail(scene.trail);
    this.drawDoorGuides(scene);
  }

  private drawTrail(trail: Vec2[]): void {
    if (trail.length < 2) return;
    const points = trail.map((point) => this.project(point.x, point.y, 0.03));
    this.strokeScreenPolyline(points, "rgba(255, 183, 3, 0.18)", 7);
    this.strokeScreenPolyline(points, COLORS.trail, 2.5);

    const start = points[0];
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = COLORS.trailStart;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGroundCircle(
    centreX: number,
    centreY: number,
    radius: number,
    color: string,
    width: number,
    dash: number[] = [],
  ): void {
    const points: Vec2[] = [];
    const segments = 96;
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        this.project(
          centreX + Math.cos(angle) * radius,
          centreY + Math.sin(angle) * radius,
          0.02,
        ),
      );
    }
    this.strokeScreenPolyline(points, color, width, dash);
  }

  /**
   * Turning circles for the current steering lock, drawn around the
   * instantaneous centre of rotation:
   *   - amber: complete footprint envelope (body, tyres and enabled mirrors)
   *   - blue:  selected outer tyre / wheel-centre reference
   *   - grey:  rear axle path — the model reference point
   */
  private drawTurningCircles(scene: RenderScene): void {
    const { vehicle, vehicleConfig } = scene;
    const steering = vehicle.steeringAngle;
    if (Math.abs(steering) < (0.5 * Math.PI) / 180) return;

    const signedRadius = vehicleConfig.wheelbase / Math.tan(steering);
    const radius = Math.abs(signedRadius);
    const rightX = -Math.sin(vehicle.heading);
    const rightY = Math.cos(vehicle.heading);
    const centreX = vehicle.x + signedRadius * rightX;
    const centreY = vehicle.y + signedRadius * rightY;

    const geometry = turningGeometry(vehicleConfig, steering);

    this.drawGroundCircle(centreX, centreY, radius, "rgba(255, 255, 255, 0.12)", 1, [2, 5]);
    this.drawGroundCircle(
      centreX,
      centreY,
      geometry.referenceRadius,
      "rgba(77, 163, 255, 0.35)",
      1,
      [7, 6],
    );
    this.drawGroundCircle(
      centreX,
      centreY,
      geometry.wallToWallRadius,
      "rgba(255, 183, 3, 0.5)",
      1.5,
      [7, 6],
    );

    const marker = this.project(centreX, centreY, 0.03);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 183, 3, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marker.x - 5, marker.y);
    ctx.lineTo(marker.x + 5, marker.y);
    ctx.moveTo(marker.x, marker.y - 5);
    ctx.lineTo(marker.x, marker.y + 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawDoorGuides(scene: RenderScene): void {
    if (!scene.garage.active) return;
    const { garage, house } = scene.env;
    const color = scene.garage.fits ? "rgba(79, 209, 197, 0.5)" : COLORS.danger;

    // Approach corridor glow.
    this.fillScreenPolygon(
      [
        this.project(garage.left, house.front - 3.2, 0.026),
        this.project(garage.right, house.front - 3.2, 0.026),
        this.project(garage.right, house.front - 0.02, 0.026),
        this.project(garage.left, house.front - 0.02, 0.026),
      ],
      scene.garage.fits ? "rgba(79, 209, 197, 0.07)" : "rgba(255, 92, 92, 0.07)",
    );

    const guideTop = house.front - 3.5;
    this.strokeWorldSegment(garage.left, guideTop, garage.left, house.front, color, 0.05, [0.5, 0.5], 0.03);
    this.strokeWorldSegment(garage.right, guideTop, garage.right, house.front, color, 0.05, [0.5, 0.5], 0.03);
  }

  /** Door outline on top of the facade; only while the car is approaching. */
  private drawDoorTrim(scene: RenderScene): void {
    if (!scene.garage.active) return;
    const { garage, house } = scene.env;
    const color = scene.garage.fits ? "rgba(79, 209, 197, 0.75)" : "rgba(255, 92, 92, 0.75)";
    const y = house.front - 0.012;
    this.strokeScreenPolyline(
      [this.project(garage.left, y, 0), this.project(garage.left, y, DOOR_HEIGHT)],
      color,
      2,
    );
    this.strokeScreenPolyline(
      [this.project(garage.right, y, 0), this.project(garage.right, y, DOOR_HEIGHT)],
      color,
      2,
    );
    this.strokeScreenPolyline(
      [this.project(garage.left, y, DOOR_HEIGHT), this.project(garage.right, y, DOOR_HEIGHT)],
      color,
      2,
    );
  }

  private drawStructures(scene: RenderScene): void {
    const items: Renderable[] = [];
    for (const { box, kind } of scene.env.walls) {
      const palette = kind === "house" ? WALL_PALETTE : KERB_PALETTE;
      const top = kind === "house" ? WALL_HEIGHT : KERB_HEIGHT;
      items.push({
        depth: this.boxDepth(box, 0, top),
        draw: () => this.drawBox(box, 0, top, palette),
      });
    }

    // Header above the garage opening.
    const { house, garage } = scene.env;
    const lintel: Aabb = {
      minX: garage.left,
      maxX: garage.right,
      minY: house.front,
      maxY: house.interiorFront,
    };
    items.push({
      depth: this.boxDepth(lintel, DOOR_HEIGHT, WALL_HEIGHT),
      draw: () => this.drawBox(lintel, DOOR_HEIGHT, WALL_HEIGHT, WALL_PALETTE),
    });

    const centre = bodyCenter(scene.vehicle, scene.vehicleConfig);
    items.push({
      depth: this.depthAt(centre.x, centre.y, (BODY_BOTTOM + ROOF_TOP) / 2),
      draw: () => this.drawCar(scene.vehicleConfig, scene.vehicle),
    });

    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) item.draw();
  }

  // ---------------------------------------------------------------- 3D boxes

  private drawBox(box: Aabb, z0: number, z1: number, palette: Palette): void {
    this.drawPrism(
      (box.minX + box.maxX) / 2,
      (box.minY + box.maxY) / 2,
      { hx: (box.maxX - box.minX) / 2, hy: (box.maxY - box.minY) / 2 },
      { hx: (box.maxX - box.minX) / 2, hy: (box.maxY - box.minY) / 2 },
      0,
      z0,
      z1,
      palette,
    );
  }

  /**
   * Draw an extruded prism (top footprint optionally tapered) with back-face
   * culling and a painter order: visible sides, then the top face.
   */
  private drawPrism(
    centreX: number,
    centreY: number,
    bottom: PrismFootprint,
    top: PrismFootprint,
    heading: number,
    z0: number,
    z1: number,
    palette: Palette,
  ): void {
    const ctx = this.ctx;
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const vx = -Math.sin(heading);
    const vy = Math.cos(heading);
    const at = (lx: number, ly: number, z: number): Vec2 =>
      this.project(centreX + ux * lx + vx * ly, centreY + uy * lx + vy * ly, z);

    const topFace = [
      at(top.hx, -top.hy, z1),
      at(top.hx, top.hy, z1),
      at(-top.hx, top.hy, z1),
      at(-top.hx, -top.hy, z1),
    ];
    const referenceSign = Math.sign(this.signedArea(topFace));
    if (referenceSign === 0) return;

    const sides: Array<{ points: Vec2[]; color: string }> = [];
    const addSide = (points: Vec2[], color: string): void => {
      if (Math.sign(this.signedArea(points)) === referenceSign) {
        sides.push({ points, color });
      }
    };

    addSide(
      [
        at(bottom.hx, -bottom.hy, z0),
        at(bottom.hx, bottom.hy, z0),
        at(top.hx, top.hy, z1),
        at(top.hx, -top.hy, z1),
      ],
      palette.sideA,
    );
    addSide(
      [
        at(-bottom.hx, bottom.hy, z0),
        at(-bottom.hx, -bottom.hy, z0),
        at(-top.hx, -top.hy, z1),
        at(-top.hx, top.hy, z1),
      ],
      palette.sideA,
    );
    addSide(
      [
        at(bottom.hx, bottom.hy, z0),
        at(-bottom.hx, bottom.hy, z0),
        at(-top.hx, top.hy, z1),
        at(top.hx, top.hy, z1),
      ],
      palette.sideB,
    );
    addSide(
      [
        at(-bottom.hx, -bottom.hy, z0),
        at(bottom.hx, -bottom.hy, z0),
        at(top.hx, -top.hy, z1),
        at(-top.hx, -top.hy, z1),
      ],
      palette.sideB,
    );

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = 1;
    for (const side of sides) {
      this.fillScreenPolygon(side.points, side.color);
      if (palette.outline) {
        ctx.strokeStyle = palette.outline;
        ctx.stroke();
      }
    }
    this.fillScreenPolygon(topFace, palette.top);
    if (palette.outline) {
      ctx.strokeStyle = palette.outline;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------- car

  private drawCar(config: VehicleConfig, state: VehicleState): void {
    const centre = bodyCenter(state, config);
    const { forward, left } = headingBasis(state.heading);
    const at = (along: number, across: number): Vec2 => ({
      x: state.x + forward.x * along + left.x * across,
      y: state.y + forward.y * along + left.y * across,
    });

    // Tyres first; the body covers their upper halves.
    for (const wheel of localWheels(config)) {
      const position = at(wheel.x, wheel.y);
      const angle =
        state.heading +
        (wheel.steered ? wheelSteeringAngle(state.steeringAngle, config, wheel.y) : 0);
      this.drawPrism(
        position.x,
        position.y,
        { hx: config.tyreDiameter / 2, hy: config.tyreWidth / 2 },
        { hx: config.tyreDiameter / 2, hy: config.tyreWidth / 2 },
        angle,
        0,
        config.tyreDiameter,
        WHEEL_PALETTE,
      );
    }

    // Lower body.
    const halfLength = config.vehicleLength / 2;
    const halfWidth = config.vehicleWidth / 2;
    this.drawPrism(
      centre.x,
      centre.y,
      { hx: halfLength, hy: halfWidth },
      { hx: halfLength, hy: halfWidth },
      state.heading,
      BODY_BOTTOM,
      BODY_TOP,
      BODY_PALETTE,
    );

    // Door mirrors, when their measured width is enabled.
    if (config.mirrorWidth > config.vehicleWidth) {
      const across = (config.vehicleWidth + config.mirrorWidth) / 4;
      const halfMirror = (config.mirrorWidth - config.vehicleWidth) / 4;
      for (const side of [-1, 1]) {
        const position = at(config.mirrorOffset, side * across);
        this.drawPrism(
          position.x,
          position.y,
          { hx: config.mirrorLength / 2, hy: halfMirror },
          { hx: config.mirrorLength / 2, hy: halfMirror },
          state.heading,
          BODY_TOP,
          BODY_TOP + 0.12,
          MIRROR_PALETTE,
        );
      }
    }

    // Cabin: tapered glasshouse with a body-coloured roof.
    const cabinCentre = {
      x: centre.x - forward.x * config.vehicleLength * 0.05,
      y: centre.y - forward.y * config.vehicleLength * 0.05,
    };
    this.drawPrism(
      cabinCentre.x,
      cabinCentre.y,
      { hx: config.vehicleLength * 0.24, hy: config.vehicleWidth * 0.42 },
      { hx: config.vehicleLength * 0.17, hy: config.vehicleWidth * 0.34 },
      state.heading,
      BODY_TOP - 0.02,
      ROOF_TOP,
      CABIN_PALETTE,
    );

    // Front marker on the bonnet.
    const rect = localBodyRect(config);
    const markerZ = BODY_TOP + 0.015;
    const tip = at(rect.front - 0.35, 0);
    const backLeft = at(rect.front - 0.95, 0.3);
    const backRight = at(rect.front - 0.95, -0.3);
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = COLORS.frontMark;
    this.beginPolygon([
      this.project(tip.x, tip.y, markerZ),
      this.project(backLeft.x, backLeft.y, markerZ),
      this.project(backRight.x, backRight.y, markerZ),
    ]);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------- annotations

  /** Exact world-space spans with readable screen-space ticks and labels. */
  private drawWidthDimensions(scene: RenderScene): void {
    const { road } = scene.env;
    const x = road.left + 0.8;
    this.drawDimension(
      this.project(x, road.top),
      this.project(x, road.bottom),
      `Road ${formatNumber(road.bottom - road.top)} m`,
    );

    const centre = bodyCenter(scene.vehicle, scene.vehicleConfig);
    const centreScreen = this.project(centre.x, centre.y);
    const corners = bodyCorners(scene.vehicle, scene.vehicleConfig);
    const frontLeft = this.project(corners[0].x, corners[0].y);
    const frontRight = this.project(corners[1].x, corners[1].y);
    this.drawDimensionAlong(
      frontLeft,
      frontRight,
      centreScreen,
      16,
      `Body ${formatNumber(scene.vehicleConfig.vehicleWidth)} m`,
    );

    const { vehicle, vehicleConfig } = scene;
    if (vehicleConfig.mirrorWidth > vehicleConfig.vehicleWidth) {
      const { forward, left } = headingBasis(vehicle.heading);
      const points = [-1, 1].map((side) =>
        this.project(
          vehicle.x + forward.x * vehicleConfig.mirrorOffset + side * left.x * vehicleConfig.mirrorWidth / 2,
          vehicle.y + forward.y * vehicleConfig.mirrorOffset + side * left.y * vehicleConfig.mirrorWidth / 2,
        ),
      );
      this.drawDimensionAlong(
        points[0],
        points[1],
        centreScreen,
        32,
        `Mirrors ${formatNumber(vehicleConfig.mirrorWidth)} m`,
      );
    }
  }

  /** Offset a dimension away from the vehicle centre before drawing it. */
  private drawDimensionAlong(
    a: Vec2,
    b: Vec2,
    awayFrom: Vec2,
    offset: number,
    text: string,
  ): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    let nx = -dy / length;
    let ny = dx / length;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if ((awayFrom.x - midX) * nx + (awayFrom.y - midY) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    this.drawDimension(
      { x: a.x + nx * offset, y: a.y + ny * offset },
      { x: b.x + nx * offset, y: b.y + ny * offset },
      text,
    );
  }

  private drawDimension(a: Vec2, b: Vec2, text: string): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1) return;
    const nx = (b.y - a.y) / length;
    const ny = -(b.x - a.x) / length;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(79, 209, 197, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    for (const p of [a, b]) {
      ctx.moveTo(p.x - nx * 4, p.y - ny * 4);
      ctx.lineTo(p.x + nx * 4, p.y + ny * 4);
    }
    ctx.stroke();
    ctx.font = "600 12px system-ui, sans-serif";
    const width = ctx.measureText(text).width;
    const labelX = (a.x + b.x) / 2 + nx * (width / 2 + 10);
    const labelY = (a.y + b.y) / 2 + ny * 16;
    ctx.fillStyle = "rgba(8, 13, 20, 0.82)";
    this.roundRect(labelX - width / 2 - 5, labelY - 9, width + 10, 18, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(79, 209, 197, 0.25)";
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, labelX, labelY);
    ctx.restore();
  }

  private drawLabels(env: Environment): void {
    this.drawFloatingLabel(env.house.centerX, env.house.centerY, 3.7, "HOUSE", COLORS.text);
    this.drawFloatingLabel(
      env.garage.centerX,
      env.house.front + 0.1,
      2.95,
      "GARAGE",
      COLORS.opening,
    );
  }

  private drawFloatingLabel(
    worldX: number,
    worldY: number,
    height: number,
    text: string,
    color: string,
  ): void {
    const ctx = this.ctx;
    const anchor = this.project(worldX, worldY, height);
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    const width = ctx.measureText(text).width;
    const pillY = anchor.y - 18;

    ctx.strokeStyle = "rgba(232, 238, 246, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y - 3);
    ctx.lineTo(anchor.x, pillY + 9);
    ctx.stroke();

    ctx.fillStyle = "rgba(8, 13, 20, 0.78)";
    this.roundRect(anchor.x - width / 2 - 7, pillY - 9, width + 14, 18, 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, anchor.x, pillY);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParkedBanner(): void {
    const ctx = this.ctx;
    const text = "PARKED";
    ctx.save();
    ctx.font = "700 20px system-ui, sans-serif";
    const width = ctx.measureText(text).width;
    const x = this.width / 2;
    // Bottom centre: the top corners are occupied by the DOM HUD panels.
    const y = this.height - 46;
    ctx.shadowColor = "rgba(79, 209, 197, 0.45)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(9, 18, 24, 0.82)";
    this.roundRect(x - width / 2 - 16, y - 20, width + 32, 40, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(79, 209, 197, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.opening;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  private drawVignette(): void {
    const ctx = this.ctx;
    const centreX = this.width / 2;
    const centreY = this.height / 2;
    const radius = Math.max(this.width, this.height) * 0.72;
    const gradient = ctx.createRadialGradient(
      centreX,
      centreY,
      Math.min(this.width, this.height) * 0.25,
      centreX,
      centreY,
      radius,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}
