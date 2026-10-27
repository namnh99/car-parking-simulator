import type { Aabb, EnvironmentConfig } from "./types";

/** A solid house wall or road kerb, expressed as an axis-aligned band. */
export interface WallBand {
  kind: "house" | "kerb";
  box: Aabb;
}

export interface Environment {
  config: EnvironmentConfig;
  road: { top: number; bottom: number; left: number; right: number };
  house: {
    left: number;
    right: number;
    front: number;
    interiorFront: number;
    back: number;
    centerX: number;
    centerY: number;
  };
  garage: {
    left: number;
    right: number;
    centerX: number;
    y: number;
    width: number;
  };
  /**
   * Gap in the south road kerb, in world x. Equals the garage door when there
   * is no driveway, and the driveway apron when there is one. The renderer uses
   * this so the drawn kerb matches the collision geometry.
   */
  kerbOpening: { left: number; right: number };
  /** Collision bands, including the house walls and the road kerbs. */
  walls: WallBand[];
  /** World area worth framing by the default camera. */
  bounds: Aabb;
  /** Convenient starting pose on the road, facing the house. */
  start: { x: number; y: number; heading: number };
}

/**
 * Build the full scene geometry from a (already sanitised) config.
 *
 * Layout, world coordinates are y-down metres:
 *   - road:            y in [0, roadWidth]
 *   - driveway:        y in [roadWidth, house.front]
 *   - clear interior: y in [house.interiorFront, house.back], centred on x = 0
 */
export function buildEnvironment(config: EnvironmentConfig): Environment {
  const halfHouse = config.houseWidth / 2;
  const houseLeft = -halfHouse;
  const houseRight = halfHouse;
  const front = config.roadWidth + config.drivewayDepth;
  const t = config.wallThickness;
  const interiorFront = front + t;
  const back = interiorFront + config.houseDepth;
  const roadTop = 0;
  const roadBottom = config.roadWidth;

  const halfDoor = config.garageDoorWidth / 2;
  const garageLeft = -halfDoor;
  const garageRight = halfDoor;

  const roadHalfLength = Math.max(config.houseWidth / 2 + 11, 11);
  const roadLeft = -roadHalfLength;
  const roadRight = roadHalfLength;

  // Road borders are solid kerbs the vehicle cannot cross. The south kerb is
  // broken across the driveway opening so the car can still drive in; with no
  // driveway that opening collapses to exactly the garage door.
  const apron = config.drivewayDepth > 0 ? 0.6 : 0;
  const openingLeft = config.drivewayDepth > 0 ? houseLeft - apron : garageLeft;
  const openingRight =
    config.drivewayDepth > 0 ? houseRight + apron : garageRight;

  const walls: WallBand[] = [
    // House.
    { kind: "house", box: band(houseLeft - t, front, garageLeft, front + t) },
    { kind: "house", box: band(garageRight, front, houseRight + t, front + t) },
    { kind: "house", box: band(houseLeft - t, back, houseRight + t, back + t) },
    { kind: "house", box: band(houseLeft - t, front, houseLeft, back + t) },
    { kind: "house", box: band(houseRight, front, houseRight + t, back + t) },
    // Kerbs sit outside the road: roadWidth is the clear drivable width.
    {
      kind: "kerb",
      box: band(roadLeft - t, roadTop - t, roadRight + t, roadTop),
    },
    { kind: "kerb", box: band(roadLeft - t, roadTop, roadLeft, roadBottom) },
    { kind: "kerb", box: band(roadRight, roadTop, roadRight + t, roadBottom) },
    // South kerb, split around the driveway / door opening.
    {
      kind: "kerb",
      box: band(roadLeft - t, roadBottom, openingLeft, roadBottom + t),
    },
    {
      kind: "kerb",
      box: band(openingRight, roadBottom, roadRight + t, roadBottom + t),
    },
  ];

  const bounds: Aabb = {
    minX: Math.min(-roadHalfLength, houseLeft - t) - 2,
    maxX: Math.max(roadHalfLength, houseRight + t) + 2,
    minY: roadTop - 2,
    maxY: back + t + 2,
  };

  const startX = Math.max(roadHalfLength - 4.5, houseRight + 7.5);
  const start = { x: startX, y: roadBottom / 2 - 0.7, heading: 0 };

  return {
    config,
    road: {
      top: roadTop,
      bottom: roadBottom,
      left: -roadHalfLength,
      right: roadHalfLength,
    },
    house: {
      left: houseLeft,
      right: houseRight,
      front,
      interiorFront,
      back,
      centerX: 0,
      centerY: (interiorFront + back) / 2,
    },
    garage: {
      left: garageLeft,
      right: garageRight,
      centerX: 0,
      y: front,
      width: config.garageDoorWidth,
    },
    kerbOpening: { left: openingLeft, right: openingRight },
    walls,
    bounds,
    start,
  };
}

function band(minX: number, minY: number, maxX: number, maxY: number): Aabb {
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}
