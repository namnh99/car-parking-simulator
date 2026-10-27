import type { Environment } from "./environment";
import type { Vec2, VehicleConfig, VehicleState } from "./types";
import type { Camera } from "./camera";
import type { GarageStatus } from "./simulation";
import { bodyCorners, headingBasis, localBodyRect, turningGeometry, vehicleShapes } from "./vehicle";
import { formatNumber } from "./math";

export interface RenderScene {
  env: Environment;
  vehicleConfig: VehicleConfig;
  vehicle: VehicleState;
  trail: Vec2[];
  camera: Camera;
  garage: GarageStatus;
}

const COLORS = {
  background: "#0e131a",
  grid: "rgba(255, 255, 255, 0.05)",
  road: "#2b323b",
  roadBorder: "rgba(160, 174, 192, 0.9)",
  driveway: "#3b424b",
  houseFloor: "#252e39",
  wall: "#cbd5e1",
  opening: "#4fd1c5",
  trail: "rgba(255, 183, 3, 0.9)",
  trailStart: "#ffb703",
  body: "#4da3ff",
  bodyOutline: "#eaf2ff",
  wheel: "#0d1117",
  wheelOutline: "rgba(234, 242, 255, 0.35)",
  frontMark: "#ffd166",
  danger: "#ff5c5c",
  text: "rgba(226, 232, 240, 0.85)",
} as const;

/** Stateless Canvas 2D renderer for one simulation frame. */
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

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawGrid();
    this.drawRoad(scene.env);
    this.drawDriveway(scene.env);
    this.drawHouse(scene.env);
    this.drawDoorGuides(scene);
    this.drawTurningCircles(scene);
    this.drawTrail(scene.trail);
    this.drawVehicle(scene.vehicleConfig, scene.vehicle);
    this.drawLabels(scene.env);
    this.drawWidthDimensions(scene);
    if (scene.garage.parked) this.drawParkedBanner();
  }

  // ---------------------------------------------------------------- helpers

  private worldToScreen(x: number, y: number): Vec2 {
    return this.camera.worldToScreen(x, y, this.width, this.height);
  }

  private fillWorldRect(x: number, y: number, width: number, height: number, color: string): void {
    const topLeft = this.worldToScreen(x, y);
    const scale = this.camera.zoom;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(topLeft.x, topLeft.y, width * scale, height * scale);
  }

  private strokeWorldLine(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    color: string,
    widthMeters: number,
    dash: number[] = [],
  ): void {
    const a = this.worldToScreen(ax, ay);
    const b = this.worldToScreen(bx, by);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(widthMeters * this.camera.zoom, 0.5);
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- layers

  private drawGrid(): void {
    const ctx = this.ctx;
    const topLeft = this.camera.screenToWorld(0, 0, this.width, this.height);
    const bottomRight = this.camera.screenToWorld(this.width, this.height, this.width, this.height);
    const span = Math.max(bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    const step = span > 160 ? 10 : span > 70 ? 5 : 1;

    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      const p = this.worldToScreen(x, topLeft.y);
      const q = this.worldToScreen(x, bottomRight.y);
      ctx.moveTo(Math.round(p.x) + 0.5, p.y);
      ctx.lineTo(Math.round(q.x) + 0.5, q.y);
    }
    for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
      const p = this.worldToScreen(topLeft.x, y);
      const q = this.worldToScreen(bottomRight.x, y);
      ctx.moveTo(p.x, Math.round(p.y) + 0.5);
      ctx.lineTo(q.x, Math.round(q.y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawRoad(env: Environment): void {
    const { road } = env;
    this.fillWorldRect(road.left, road.top, road.right - road.left, road.bottom - road.top, COLORS.road);

    // Kerb border around the carriageway. The south edge is split at the
    // driveway/door opening so the drawing matches the collision geometry.
    const opening = env.kerbOpening;
    // Render the actual collision rectangles, not separately approximated strokes.
    for (const { box } of env.walls.filter((wall) => wall.kind === "kerb")) {
      this.fillWorldRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, COLORS.roadBorder);
    }
    // Dropped kerb across the opening: drivable, so drawn as a faint threshold.
    this.strokeWorldLine(
      opening.left,
      road.bottom,
      opening.right,
      road.bottom,
      "rgba(160, 174, 192, 0.35)",
      0.08,
      [0.5, 0.5],
    );

    const centerY = (road.top + road.bottom) / 2;
    this.strokeWorldLine(
      road.left,
      centerY,
      road.right,
      centerY,
      "rgba(235, 240, 246, 0.4)",
      0.1,
      [1.2, 1.2],
    );
  }

  private drawDriveway(env: Environment): void {
    const { road, house, garage } = env;
    const left = Math.min(house.left, garage.left) - 0.6;
    const right = Math.max(house.right, garage.right) + 0.6;
    this.fillWorldRect(left, road.bottom, right - left, house.front - road.bottom, COLORS.driveway);
  }

  private drawHouse(env: Environment): void {
    const { house } = env;
    this.fillWorldRect(env.garage.left, house.front, env.garage.width,
      house.interiorFront - house.front, COLORS.houseFloor);
    this.fillWorldRect(
      house.left,
      house.interiorFront,
      house.right - house.left,
      house.back - house.interiorFront,
      COLORS.houseFloor,
    );

    // Parking target: the space reachable just inside the door.
    this.strokeWorldLine(
      house.left + 0.3,
      house.front + 3.0,
      house.right - 0.3,
      house.front + 3.0,
      "rgba(79, 209, 197, 0.35)",
      0.06,
      [0.4, 0.4],
    );

    for (const { box } of env.walls.filter((wall) => wall.kind === "house")) {
      this.fillWorldRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, COLORS.wall);
    }

    // Garage opening marker.
    this.strokeWorldLine(
      env.garage.left,
      house.front,
      env.garage.right,
      house.front,
      COLORS.opening,
      0.1,
      [0.6, 0.4],
    );
  }

  private drawDoorGuides(scene: RenderScene): void {
    if (!scene.garage.active) return;
    const { garage, house } = scene.env;
    const color = scene.garage.fits ? "rgba(79, 209, 197, 0.5)" : COLORS.danger;
    const guideTop = house.front - 3.5;
    this.strokeWorldLine(garage.left, guideTop, garage.left, house.front, color, 0.05, [0.5, 0.5]);
    this.strokeWorldLine(garage.right, guideTop, garage.right, house.front, color, 0.05, [0.5, 0.5]);
  }

  private strokeWorldCircle(
    centerWorldX: number,
    centerWorldY: number,
    radiusMetres: number,
    color: string,
    width: number,
    dash: number[] = [],
  ): void {
    const ctx = this.ctx;
    const center = this.worldToScreen(centerWorldX, centerWorldY);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusMetres * this.camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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

    this.strokeWorldCircle(centreX, centreY, radius, "rgba(255, 255, 255, 0.12)", 1, [2, 5]);
    this.strokeWorldCircle(centreX, centreY, geometry.referenceRadius, "rgba(77, 163, 255, 0.35)", 1, [7, 6]);
    this.strokeWorldCircle(centreX, centreY, geometry.wallToWallRadius, "rgba(255, 183, 3, 0.5)", 1.5, [7, 6]);

    // Instantaneous centre marker.
    const ctx = this.ctx;
    const marker = this.worldToScreen(centreX, centreY);
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


  private drawTrail(trail: Vec2[]): void {
    if (trail.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.trail;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const first = this.worldToScreen(trail[0].x, trail[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < trail.length; i += 1) {
      const p = this.worldToScreen(trail[i].x, trail[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    ctx.fillStyle = COLORS.trailStart;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw the car in the **rear-axle frame**: canvas `+x` is forward along the
   * heading, canvas `+y` is the vehicle's right.
   */
  private drawVehicle(config: VehicleConfig, state: VehicleState): void {
    const ctx = this.ctx;
    const camera = this.camera;
    const zoom = camera.zoom;
    const rect = localBodyRect(config);
    const rear = this.worldToScreen(state.x, state.y);

    const halfWidthPx = rect.halfWidth * zoom;
    const frontPx = rect.front * zoom;
    const rearPx = rect.rear * zoom;

    for (const shape of vehicleShapes(state, config)) {
      const center = this.worldToScreen(shape.center.x, shape.center.y);
      const halfLength = shape.halfLength * zoom;
      const halfWidth = shape.halfWidth * zoom;
      const outline = Math.min(1.5, halfLength, halfWidth);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(shape.heading);
      ctx.fillStyle = shape.kind === "tyre" ? COLORS.wheel : COLORS.body;
      ctx.fillRect(-halfLength, -halfWidth, halfLength * 2, halfWidth * 2);
      ctx.strokeStyle = shape.kind === "tyre" ? COLORS.wheelOutline : COLORS.bodyOutline;
      ctx.lineWidth = outline;
      ctx.strokeRect(-halfLength + outline / 2, -halfWidth + outline / 2,
        halfLength * 2 - outline, halfWidth * 2 - outline);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(rear.x, rear.y);
    ctx.rotate(state.heading);

    // Decorative details are clipped inside the physical body footprint.
    ctx.beginPath();
    ctx.rect(rearPx, -halfWidthPx, frontPx - rearPx, halfWidthPx * 2);
    ctx.clip();

    // Axle reference lines: rear axle at x = 0, front axle at x = wheelbase.
    const frontAxlePx = config.wheelbase * zoom;
    ctx.strokeStyle = "rgba(234, 242, 255, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -halfWidthPx);
    ctx.lineTo(0, halfWidthPx);
    ctx.moveTo(frontAxlePx, -halfWidthPx);
    ctx.lineTo(frontAxlePx, halfWidthPx);
    ctx.stroke();

    // Heading arrow from the rear axle along the centreline.
    ctx.strokeStyle = "rgba(255, 209, 102, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(frontPx - 6, 0);
    ctx.stroke();

    // Front indicator triangle.
    ctx.fillStyle = COLORS.frontMark;
    ctx.beginPath();
    ctx.moveTo(frontPx - 9, -7);
    ctx.lineTo(frontPx - 9, 7);
    ctx.lineTo(frontPx - 2, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Rear axle reference dot (the model reference point).
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(rear.x, rear.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Exact world-space spans with readable screen-space ticks and labels. */
  private drawWidthDimensions(scene: RenderScene): void {
    const { road } = scene.env;
    const x = road.left + 0.8;
    this.drawDimension(
      this.worldToScreen(x, road.top), this.worldToScreen(x, road.bottom),
      `Road ${formatNumber(road.bottom - road.top)} m`,
    );
    const corners = bodyCorners(scene.vehicle, scene.vehicleConfig);
    const offsetX = Math.cos(scene.vehicle.heading) * 14;
    const offsetY = Math.sin(scene.vehicle.heading) * 14;
    const ends = corners.slice(0, 2).map((corner) => {
      const p = this.worldToScreen(corner.x, corner.y);
      return { x: p.x + offsetX, y: p.y + offsetY };
    });
    this.drawDimension(ends[0], ends[1], `Body ${formatNumber(scene.vehicleConfig.vehicleWidth)} m`);
    const { vehicle, vehicleConfig } = scene;
    if (vehicleConfig.mirrorWidth > vehicleConfig.vehicleWidth) {
      const { forward, left } = headingBasis(vehicle.heading);
      const points = [-1, 1].map((side) => this.worldToScreen(
        vehicle.x + forward.x * vehicleConfig.mirrorOffset + side * left.x * vehicleConfig.mirrorWidth / 2,
        vehicle.y + forward.y * vehicleConfig.mirrorOffset + side * left.y * vehicleConfig.mirrorWidth / 2,
      ));
      this.drawDimension(points[0], points[1], `Mirrors ${formatNumber(vehicleConfig.mirrorWidth)} m`);
    }
  }

  private drawDimension(a: Vec2, b: Vec2, text: string): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1) return;
    const nx = (b.y - a.y) / length;
    const ny = -(b.x - a.x) / length;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.opening;
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
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(labelX - width / 2 - 4, labelY - 9, width + 8, 18);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, labelX, labelY);
    ctx.restore();
  }

  private drawLabels(env: Environment): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = COLORS.text;

    this.label(
      env.house.centerX,
      (env.house.front + env.house.back) / 2 + 1,
      "HOUSE",
      "center",
    );
    this.label(env.house.centerX, env.garage.y + 1.4, "GARAGE", "center", COLORS.opening);
    ctx.restore();
  }

  private label(
    worldX: number,
    worldY: number,
    text: string,
    align: CanvasTextAlign,
    color: string = COLORS.text,
  ): void {
    const ctx = this.ctx;
    const p = this.worldToScreen(worldX, worldY);
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
  }

  private drawParkedBanner(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "700 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(79, 209, 197, 0.95)";
    ctx.fillText("PARKED", this.width / 2, 34);
    ctx.restore();
  }
}
