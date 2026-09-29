import type { Aabb, EnvironmentConfig } from "./types";
import { SIM } from "./config";

/** A solid wall of the house, expressed as a thin axis-aligned band. */
export interface WallBand {
  box: Aabb;
}

export interface Environment {
  config: EnvironmentConfig;
  road: { top: number; bottom: number; left: number; right: number };
  house: { left: number; right: number; front: number; back: number; centerX: number; centerY: number };
  garage: { left: number; right: number; centerX: number; y: number; width: number };
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
 *   - house footprint: y in [house.front, house.back], centred on x = 0
 */
export function buildEnvironment(config: EnvironmentConfig): Environment {
  const halfHouse = config.houseWidth / 2;
  const houseLeft = -halfHouse;
  const houseRight = halfHouse;
  const front = config.roadWidth + config.drivewayDepth;
  const back = front + config.houseDepth;
  const roadTop = 0;
  const roadBottom = config.roadWidth;

  const halfDoor = config.garageDoorWidth / 2;
  const garageLeft = -halfDoor;
  const garageRight = halfDoor;

  const t = SIM.wallThickness;
  const halfT = t / 2;

  const roadHalfLength = Math.max(config.houseWidth / 2 + 11, 11);
  const roadLeft = -roadHalfLength;
  const roadRight = roadHalfLength;

  // Road borders are solid kerbs the vehicle cannot cross. The south kerb is
  // broken across the driveway opening so the car can still drive in; with no
  // driveway that opening collapses to exactly the garage door.
  const apron = config.drivewayDepth > 0 ? 0.6 : 0;
  const openingLeft = Math.min(houseLeft, garageLeft) - apron;
  const openingRight = Math.max(houseRight, garageRight) + apron;

  const walls: WallBand[] = [
    // House.
    { box: band(houseLeft - t, front - halfT, garageLeft, front + halfT) },
    { box: band(garageRight, front - halfT, houseRight + t, front + halfT) },
    { box: band(houseLeft - t, back - halfT, houseRight + t, back + halfT) },
    { box: band(houseLeft - halfT, front, houseLeft + halfT, back) },
    { box: band(houseRight - halfT, front, houseRight + halfT, back) },
    // Road kerbs: north edge plus both end caps.
    { box: band(roadLeft - t, roadTop - halfT, roadRight + t, roadTop + halfT) },
    { box: band(roadLeft - halfT, roadTop, roadLeft + halfT, roadBottom) },
    { box: band(roadRight - halfT, roadTop, roadRight + halfT, roadBottom) },
    // South kerb, split around the driveway / door opening.
    { box: band(roadLeft - t, roadBottom - halfT, openingLeft, roadBottom + halfT) },
    { box: band(openingRight, roadBottom - halfT, roadRight + t, roadBottom + halfT) },
  ];

  const bounds: Aabb = {
    minX: Math.min(-roadHalfLength, houseLeft) - 2,
    maxX: Math.max(roadHalfLength, houseRight) + 2,
    minY: roadTop - 2,
    maxY: back + 2,
  };

  const startX = Math.min(-roadHalfLength + 4.5, houseLeft - 5);
  const start = { x: startX, y: roadBottom / 2, heading: 0 };

  return {
    config,
    road: { top: roadTop, bottom: roadBottom, left: -roadHalfLength, right: roadHalfLength },
    house: {
      left: houseLeft,
      right: houseRight,
      front,
      back,
      centerX: 0,
      centerY: (front + back) / 2,
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
