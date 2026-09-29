/** Small pure math helpers. No simulation state lives here. */

import type { Aabb } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Move `current` towards `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Normalise an angle to `[0, 2*PI)`. */
export function wrapTwoPi(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Format a number with up to `decimals` places, trimming trailing zeros so
 * 4.200 prints as "4.2" while 4.275 stays "4.275".
 */
export function formatNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(decimals);
  if (!fixed.includes(".")) return fixed;
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

/**
 * Separating Axis Theorem test between an oriented box (the car) and an
 * axis-aligned box (a house wall). Both are convex, so four axes suffice:
 * world X, world Y and the car's two local axes.
 */
export function obbIntersectsAabb(
  centerX: number,
  centerY: number,
  halfLength: number,
  halfWidth: number,
  angle: number,
  box: Aabb,
): boolean {
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const rightX = -Math.sin(angle);
  const rightY = Math.cos(angle);

  const boxCenterX = (box.minX + box.maxX) / 2;
  const boxCenterY = (box.minY + box.maxY) / 2;
  const boxHalfX = (box.maxX - box.minX) / 2;
  const boxHalfY = (box.maxY - box.minY) / 2;

  const deltaX = boxCenterX - centerX;
  const deltaY = boxCenterY - centerY;

  const axes: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [forwardX, forwardY],
    [rightX, rightY],
  ];

  for (const [axisX, axisY] of axes) {
    const distance = Math.abs(deltaX * axisX + deltaY * axisY);
    const obbRadius =
      Math.abs(axisX * forwardX + axisY * forwardY) * halfLength +
      Math.abs(axisX * rightX + axisY * rightY) * halfWidth;
    const boxRadius = Math.abs(axisX) * boxHalfX + Math.abs(axisY) * boxHalfY;
    if (distance > obbRadius + boxRadius) return false;
  }
  return true;
}
